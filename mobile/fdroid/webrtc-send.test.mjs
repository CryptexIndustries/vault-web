import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";

const require = createRequire(new URL("../package.json", import.meta.url));
const bridge = dirname(require.resolve("react-native-webrtc/package.json"));
const bridgeRequire = createRequire(join(bridge, "package.json"));
const typescript = require("typescript");

function sender(platform) {
    const calls = [];
    const modules = {
        "base64-js": bridgeRequire("base64-js"),
        "react-native": {
            NativeModules: { WebRTCModule: { dataChannelSend: (...args) => calls.push(args) } },
            Platform: { OS: platform },
        },
        "./EventEmitter": { addListener() {}, removeListener() {} },
        "./MessageEvent": { default: class {} },
        "./RTCDataChannelEvent": { default: class {} },
        "./vendor/event-target-shim": { EventTarget: class {} },
    };
    const filename = join(bridge, "src/RTCDataChannel.ts");
    const compiled = typescript.transpileModule(readFileSync(filename, "utf8"), {
        fileName: filename,
        compilerOptions: { module: typescript.ModuleKind.CommonJS, target: typescript.ScriptTarget.ES2022 },
    }).outputText;
    const exports = {};
    runInNewContext(compiled, {
        exports,
        require: name => {
            assert.ok(Object.hasOwn(modules, name), `Unexpected sender import: ${name}`);
            return modules[name];
        },
        ArrayBuffer, Uint8Array, TextEncoder,
    }, { filename, timeout: 5_000 });
    const channel = new exports.default({ peerConnectionId: 7, reactTag: "channel", readyState: "open" });
    return data => {
        const count = calls.length;
        channel.send(data);
        assert.equal(calls.length, count + 1, "send must invoke native exactly once");
        const [peerId, reactTag, payload, type] = calls.at(-1);
        assert.equal(peerId, 7);
        assert.equal(reactTag, "channel");
        return { payload, type };
    };
}

function sendMethod(source) {
    const start = source.indexOf("void dataChannelSend(String reactTag, String data, String type)");
    assert.ok(start >= 0, "Installed native send method missing");
    let depth = 1;
    let end = source.indexOf("{", start) + 1;
    while (depth && end < source.length) {
        if (source[end] === "{") depth++;
        else if (source[end] === "}") depth--;
        end++;
    }
    assert.equal(depth, 0, "Unbalanced native send method");
    return source.slice(start, end);
}

test("installed sender preserves Android UTF-8 and NUL text, binary slices and non-Android behavior", { timeout: 60_000 }, () => {
    // Execute installed code only. No patch fallback, Gradle, Android SDK or network.
    const strings = ["", "plain text", "UTF-8: č ✓ 🔐", "NUL-before\0NUL-after", "\0leading", "trailing\0"];
    const storage = new Uint8Array([99, 98, 0, 1, 127, 128, 255, 97]);
    const binary = [
        new Uint8Array(0),
        storage.subarray(2, 7),
        new DataView(storage.buffer, 3, 3),
        new Uint8Array([0, 255, 42]).buffer,
    ];
    const nativeCases = [];
    for (const platform of ["android", "ios", "web"]) {
        const send = sender(platform);
        for (const text of strings) {
            const actual = send(text);
            const expected = Buffer.from(text, "utf8").toString("base64");
            if (platform === "android") {
                assert.equal(actual.type, "text-base64");
                assert.equal(actual.payload, expected);
                assert.match(actual.payload, /^[A-Za-z0-9+/=]*$/, "JNI transport must be ASCII without NUL");
                nativeCases.push(actual.type, actual.payload, expected, "false");
            } else {
                assert.equal(actual.type, "text");
                assert.equal(actual.payload, text, `${platform} must keep its original text argument`);
            }
        }
        for (const data of binary) {
            const actual = send(data);
            const bytes = ArrayBuffer.isView(data)
                ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : new Uint8Array(data);
            const expected = Buffer.from(bytes).toString("base64");
            assert.equal(actual.type, "binary");
            assert.equal(actual.payload, expected, `${platform} binary bytes must respect the view bounds`);
            if (platform === "android") nativeCases.push(actual.type, actual.payload, expected, "true");
        }
    }

    // Compile the actual installed Java method and feed it the actual JS calls.
    // Java 17+ is mandatory; missing Java tools fail this test.
    const source = readFileSync(join(bridge, "android/src/main/java/com/oney/WebRTCModule/PeerConnectionObserver.java"), "utf8");
    const fixture = readFileSync(new URL("./fixtures/WebRtcSendRegression.java", import.meta.url), "utf8")
        .replace("/* SEND_METHOD */", sendMethod(source));
    const temporary = mkdtempSync(join(tmpdir(), "cryptex-webrtc-send-"));
    try {
        const target = join(temporary, "WebRtcSendRegression.java");
        writeFileSync(target, fixture);
        execFileSync("javac", ["--release", "17", "-d", temporary, target], { stdio: "inherit", timeout: 30_000 });
        execFileSync("java", ["-cp", temporary, "WebRtcSendRegression", ...nativeCases], { stdio: "inherit", timeout: 30_000 });
    } finally {
        rmSync(temporary, { recursive: true, force: true });
    }
});
