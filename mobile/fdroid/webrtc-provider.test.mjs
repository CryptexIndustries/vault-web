import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const require = createRequire(new URL("../package.json", import.meta.url));
const bridge = dirname(require.resolve("react-native-webrtc/package.json"));
const patch = readFileSync(new URL("../../patches/react-native-webrtc@124.0.8.patch", import.meta.url), "utf8");
const metadata = readFileSync(new URL("./verification-metadata.xml", import.meta.url), "utf8");

test("Android uses the exact unprefixed maintained provider and no old provider", () => {
    const gradle = readFileSync(join(bridge, "android/build.gradle"), "utf8");
    assert.equal(require("react-native-webrtc/package.json").version, "124.0.8");
    assert.match(gradle, /api 'io\.github\.webrtc-sdk:android:150\.7871\.01'/);
    assert.doesNotMatch(gradle, /org\.jitsi:webrtc|android-prefixed/);
    assert.match(patch, /^\+    api 'io\.github\.webrtc-sdk:android:150\.7871\.01'$/m);
});

test("provider artifact and POM have only the reviewed Maven Central SHA-256 values", () => {
    const component = metadata.match(/<component group="io\.github\.webrtc-sdk" name="android" version="150\.7871\.01">([\s\S]*?)<\/component>/)?.[1];
    assert.ok(component);
    assert.equal((component.match(/<artifact /g) ?? []).length, 2);
    assert.match(component, /name="android-150\.7871\.01\.aar">\s*<sha256 value="0a1627b1a48c2bc17d9a40d62fc47bd45166f44a311e95917f147c402de379b0"/);
    assert.match(component, /name="android-150\.7871\.01\.pom">\s*<sha256 value="b740a6bec98f078892a70ee502404eb7b437feb0ef4a7fa74b4561ae25db553c"/);
    assert.doesNotMatch(metadata, /<component group="org\.jitsi" name="webrtc"/);
});

test("remote data channels still register inline and emit their opening event", () => {
    const source = readFileSync(join(bridge, "android/src/main/java/com/oney/WebRTCModule/PeerConnectionObserver.java"), "utf8");
    const callback = source.match(/public void onDataChannel\(DataChannel dataChannel\) \{([\s\S]*?)\n    \}\n/)?.[1];
    assert.ok(callback);
    assert.doesNotMatch(callback, /runOnExecutor/);
    const store = callback.indexOf("dataChannels.put(reactTag, dcw)");
    const register = callback.indexOf("dataChannel.registerObserver(dcw)");
    const opened = callback.indexOf('sendEvent("peerConnectionDidOpenDataChannel", params)');
    assert.ok(store >= 0 && register > store && opened > register);
    assert.match(callback, /info\.putString\("reactTag", reactTag\)/);
    assert.match(callback, /params\.putInt\("pcId", id\)/);
});

test("prebuild includes the exact upstream redistribution notices in APK assets", async () => {
    const projectRoot = fileURLToPath(new URL("..", import.meta.url));
    const platformProjectRoot = mkdtempSync(join(tmpdir(), "cryptex-webrtc-notices-"));
    try {
        const plugin = require("./plugins/with-android-dependency-verification");
        const config = plugin({ name: "fixture", slug: "fixture" });
        const mod = { modRequest: { projectRoot, platformProjectRoot }, modResults: {} };
        await config.mods.android.dangerous(mod);
        await config.mods.android.dangerous(mod);
        const notice = readFileSync(join(platformProjectRoot, "app/src/main/assets/licenses/webrtc-150.7871.01.txt"));
        assert.equal(createHash("sha256").update(notice).digest("hex"),
            "d1f9382c6878ac024155fd6d44a5977329108bb8b0a01cea40e4a2f1d7de252e");
        assert.equal(readFileSync(join(platformProjectRoot, "gradle/verification-metadata.xml"), "utf8"), metadata);
    } finally {
        rmSync(platformProjectRoot, { recursive: true, force: true });
    }
});
