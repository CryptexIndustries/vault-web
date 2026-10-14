import assert from "node:assert/strict";
import { test } from "node:test";
import { frameFieldStates, frameValuesResult } from "../e2e/fixtures/frame-verifier.mjs";

const matched = () => frameFieldStates("fixture@example.test", "fixture-password");
const empty = () => frameFieldStates("", "");

test("confirmed frame fill requires exact page and visible values while hidden snapshot may omit either field", () => {
    assert.equal(frameValuesResult({ page: empty(), visible: empty(), offscreen: empty() }), "empty");
    for (const hidden of [empty(), matched(), frameFieldStates("fixture@example.test", ""), frameFieldStates("", "fixture-password")]) {
        assert.equal(frameValuesResult({ page: matched(), visible: matched(), offscreen: hidden }), "matched");
    }
    assert.equal(frameValuesResult({ page: matched(), visible: empty(), offscreen: empty() }), "incomplete");
    assert.equal(frameValuesResult({ page: matched(), visible: matched() }), "loading");
});

test("any incorrect username or masked password fails the frame oracle, including a partially filled hidden frame", () => {
    for (const target of ["page", "visible", "offscreen"]) {
        for (const wrong of [frameFieldStates("wrong@example.test", "fixture-password"), frameFieldStates("fixture@example.test", "wrong-password"), frameFieldStates("wrong@example.test", "")]) {
            const frames = { page: matched(), visible: matched(), offscreen: empty(), [target]: wrong };
            assert.equal(frameValuesResult(frames), "mismatch");
        }
    }
});
