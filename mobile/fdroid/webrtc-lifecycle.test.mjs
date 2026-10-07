import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";

const java = "android/src/main/java/com/oney/WebRTCModule/";

function method(contents, signature) {
    const start = contents.indexOf(signature);
    assert.ok(start >= 0, `Bridge method missing: ${signature}`);
    const open = contents.indexOf("{", start);
    let depth = 1;
    let end = open + 1;
    while (depth && end < contents.length) {
        if (contents[end] === "{") depth++;
        else if (contents[end] === "}") depth--;
        end++;
    }
    assert.equal(depth, 0, `Unbalanced bridge method: ${signature}`);
    return contents.slice(start, end);
}

function channels(bridge, require) {
    const emitters = [];
    class Emitter {
        subscriptions = new Map();
        constructor() { emitters.push(this); }
        addListener(name, handler) {
            if (!this.subscriptions.has(name)) this.subscriptions.set(name, new Set());
            const handlers = this.subscriptions.get(name);
            handlers.add(handler);
            return { remove: () => handlers.delete(handler) };
        }
        emit(name, event) { for (const handler of this.subscriptions.get(name) ?? []) handler(event); }
        count() { return [...this.subscriptions.values()].reduce((count, handlers) => count + handlers.size, 0); }
    }
    const disposals = [];
    const closes = [];
    const bridgeRequire = createRequire(join(bridge, "package.json"));
    const modules = {
        "base64-js": bridgeRequire("base64-js"),
        "react-native": {
            NativeModules: { WebRTCModule: {
                dataChannelDispose: (id, tag) => disposals.push({ id, tag }),
                dataChannelClose: (id, tag) => closes.push({ id, tag }),
            } },
            Platform: { OS: "android" },
            NativeEventEmitter: class extends Emitter {},
        },
        "react-native/Libraries/vendor/emitter/EventEmitter": { __esModule: true, default: Emitter },
        "./vendor/event-target-shim": bridgeRequire("./src/vendor/event-target-shim"),
    };
    const typescript = require("typescript");
    function installed(name) {
        if (Object.hasOwn(modules, name)) return modules[name];
        assert.ok(["./EventEmitter", "./RTCDataChannel", "./RTCDataChannelEvent", "./MessageEvent"].includes(name),
            `Unexpected installed listener import: ${name}`);
        const filename = join(bridge, "src", `${name.slice(2)}.ts`);
        const compiled = typescript.transpileModule(readFileSync(filename, "utf8"), {
            fileName: filename,
            compilerOptions: { module: typescript.ModuleKind.CommonJS, target: typescript.ScriptTarget.ES2022 },
        }).outputText;
        const exports = {};
        modules[name] = exports;
        runInNewContext(compiled, { exports, require: installed, ArrayBuffer, Uint8Array, TextEncoder },
            { filename, timeout: 5_000 });
        return exports;
    }
    const RTCDataChannel = installed("./RTCDataChannel").default;
    installed("./EventEmitter").setupNativeEvents();
    const [nativeEmitter, listenerEmitter] = emitters;
    return round => {
        const start = disposals.length;
        let messages = 0;
        const listeners = ["local", "remote"].map(tag => {
            const channel = new RTCDataChannel({ peerConnectionId: 1, reactTag: tag, id: -1, readyState: "open" });
            let closed = 0;
            channel.onclose = () => { closed++; };
            channel.onmessage = () => { messages++; };
            return { channel, count: () => closed };
        });
        assert.equal(listenerEmitter.count(), 6, "Two channels must install their three real bridge listeners");
        for (const event of round.events) nativeEmitter.emit("dataChannelStateChanged", event);
        for (const { channel, count } of listeners) {
            assert.equal(channel.readyState, "closed", `Native ${round.peerFirst ? "peer" : "channel"}-first teardown must close JS`);
            assert.equal(count(), 1, "The real JS close handler must fire exactly once");
            channel.close();
            // Feed duplicate/late native traffic after the real terminal event.
            for (const state of ["closed", "open"]) {
                nativeEmitter.emit("dataChannelStateChanged", { reactTag: channel._reactTag, id: 7, state });
            }
            nativeEmitter.emit("dataChannelReceiveMessage", { reactTag: channel._reactTag, type: "text", data: "late" });
            assert.equal(channel.readyState, "closed", "Late state callbacks must not reopen JS");
            assert.equal(count(), 1, "Late native events must not duplicate close callbacks");
        }
        assert.equal(listenerEmitter.count(), 0, "The installed EventEmitter must remove every channel subscription");
        assert.equal(messages, 0, "Released channels must not receive late messages");
        assert.equal(closes.length, 0, "Calling close after the terminal event must not use a released native channel");
        assert.deepEqual(disposals.slice(start).sort((a, b) => a.tag.localeCompare(b.tag)),
            [{ id: 1, tag: "local" }, { id: 1, tag: "remote" }]);
    };
}

test("installed native teardown closes JS channels once and releases ownership for either queue order", { timeout: 60_000 }, () => {
    // Java 17+ is required. No Gradle, Android SDK, network or source patching.
    const require = createRequire(new URL("../package.json", import.meta.url));
    const bridge = dirname(require.resolve("react-native-webrtc/package.json"));
    const source = readFileSync(join(bridge, java, "PeerConnectionObserver.java"), "utf8");
    const moduleSource = readFileSync(join(bridge, java, "WebRTCModule.java"), "utf8");
    const wrapperSource = readFileSync(join(bridge, java, "DataChannelWrapper.java"), "utf8");
    const wrapperStart = wrapperSource.indexOf("class DataChannelWrapper implements DataChannel.Observer");
    assert.ok(wrapperStart >= 0, "Installed channel wrapper class missing");
    let fixture = readFileSync(new URL("./fixtures/WebRtcLifecycleRegression.java", import.meta.url), "utf8");
    fixture = fixture.replace("/* CHANNEL_WRAPPER */", `static final ${wrapperSource.slice(wrapperStart)}`);
    for (const [marker, body] of [
        ["PEER_DISPOSE", method(source, "void dispose()")],
        ["CHANNEL_DISPOSE", method(source, "void dataChannelDispose(String reactTag)")],
        ["QUEUE_PEER_DISPOSE", method(moduleSource, "public void peerConnectionDispose(int id)")],
        ["QUEUE_CHANNEL_DISPOSE", method(moduleSource, "public void dataChannelDispose(int peerConnectionId, String reactTag)")],
    ]) fixture = fixture.replace(`/* ${marker} */`, body);

    const temporary = mkdtempSync(join(tmpdir(), "cryptex-webrtc-lifecycle-"));
    try {
        const target = join(temporary, "WebRtcLifecycleRegression.java");
        writeFileSync(target, fixture);
        execFileSync("javac", ["--release", "17", "-d", temporary, target], { stdio: "inherit", timeout: 30_000 });
        const output = execFileSync("java", ["-cp", temporary, "WebRtcLifecycleRegression"], {
            stdio: ["ignore", "pipe", "inherit"], encoding: "utf8", timeout: 30_000,
        });
        const rounds = output.trim().split("\n").map(line => JSON.parse(line));
        assert.equal(rounds.length, 200);
        const checkChannels = channels(bridge, require);
        for (const round of rounds) checkChannels(round);
        console.info("Native/JS teardown passed: 200 rounds, callback race, exact-once releases and closed events, no listener leaks");
    } finally {
        rmSync(temporary, { recursive: true, force: true });
    }
});
