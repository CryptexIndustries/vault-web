import assert from "node:assert/strict";
import { test } from "node:test";
import { fixtureTotpAccepted, totpCode } from "../e2e/fixtures/totp-verifier.mjs";

test("SHA1 TOTP matches the RFC6238 reference code at 59 seconds", () => {
    assert.equal(totpCode(1, Buffer.from("12345678901234567890")), "287082");
    assert.equal(totpCode(0), "282760");
});

test("fixture accepts only the known secret's code within one clock step", () => {
    const now = 300000;
    for (const step of [9, 10, 11]) assert.equal(fixtureTotpAccepted(totpCode(step), now), true);
    assert.equal(fixtureTotpAccepted(totpCode(8), now), false);
    assert.equal(fixtureTotpAccepted(totpCode(12), now), false);
    assert.equal(fixtureTotpAccepted(totpCode(10, Buffer.from("wrong-secret")), now), false);
    for (const code of ["", "12345", "1234567", "not-code"]) assert.equal(fixtureTotpAccepted(code, now), false);
});
