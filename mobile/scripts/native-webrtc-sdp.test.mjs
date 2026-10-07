import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { runInNewContext } from "node:vm";

const require = createRequire(new URL("../package.json", import.meta.url));
const typescript = require("typescript");
const filename = new URL("../tests/native-webrtc-sdp.ts", import.meta.url);
const compiled = typescript.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: typescript.ModuleKind.CommonJS, target: typescript.ScriptTarget.ES2022 },
}).outputText;
const exports = {};
runInNewContext(compiled, { exports }, { filename: filename.pathname, timeout: 5_000 });
const { completedLocalDescription } = exports;
const empty = { type: "offer", sdp: "v=0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n" };
const candidate = { ...empty, sdp: `${empty.sdp}a=candidate:1 1 UDP 2122260223 127.0.0.1 12345 typ host\r\n` };
const newer = { ...candidate, sdp: `${candidate.sdp}a=candidate:2 1 UDP 2122260223 127.0.0.1 23456 typ host\r\n` };

test("completed SDP selection waits for both gathering completion and a candidate", () => {
    for (const state of ["new", "gathering"]) {
        assert.equal(completedLocalDescription(state, candidate, newer), undefined);
    }
    assert.equal(completedLocalDescription("complete", null), undefined);
    assert.equal(completedLocalDescription("complete", empty, empty), undefined);
    assert.equal(completedLocalDescription("complete", { sdp: "a=note:contains a=candidate: but is not a candidate\r\n" }), undefined);
    assert.equal(completedLocalDescription("complete", { sdp: candidate.sdp.replaceAll("\r\n", "\n") }).sdp,
        candidate.sdp.replaceAll("\r\n", "\n"));
});

test("a late ICE candidate supersedes an empty completed snapshot without retrying negotiation", () => {
    let current = empty;
    let retained = empty;
    assert.equal(completedLocalDescription("complete", current, retained), undefined);
    current = candidate;
    assert.equal(completedLocalDescription("complete", current, retained), candidate);
    retained = completedLocalDescription("complete", current, retained);
    current = empty; // Older setLocalDescription promise result arrives after the ICE callback.
    assert.equal(completedLocalDescription("complete", current, retained), candidate);
});

test("current candidate-bearing SDP is preferred while a completed snapshot survives a stale promise", () => {
    assert.equal(completedLocalDescription("complete", empty, candidate), candidate);
    assert.equal(completedLocalDescription("complete", null, candidate), candidate);
    assert.equal(completedLocalDescription("complete", newer, candidate), newer);
    assert.equal(completedLocalDescription("complete", candidate, empty), candidate);
});
