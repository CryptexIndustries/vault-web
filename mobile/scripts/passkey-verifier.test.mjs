import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyRegistration, verifyAssertion, encode, derSignatureToRaw } from "../e2e/fixtures/passkey-verifier.mjs";

const utf8 = value => new TextEncoder().encode(value);
const rawToDer = signature => {
    const integers = [signature.slice(0, 32), signature.slice(32)].map(value => {
        while (value.length > 1 && value[0] === 0) value = value.slice(1);
        if (value[0] & 0x80) value = Uint8Array.of(0, ...value);
        return Uint8Array.of(2, value.length, ...value);
    });
    return Uint8Array.of(0x30, integers[0].length + integers[1].length, ...integers[0], ...integers[1]);
};
const fixture = async () => {
    const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const publicKey = await crypto.subtle.exportKey("spki", keys.publicKey);
    const options = { rpId: "localhost", origin: "http://localhost:43110", challenge: utf8("test challenge"), userHandle: encode(utf8("account-a")) };
    const rawId = utf8("credential-a");
    const auth = new Uint8Array(55 + rawId.length + 1);
    auth.set(new Uint8Array(await crypto.subtle.digest("SHA-256", utf8(options.rpId))));
    auth[32] = 0x45;
    new DataView(auth.buffer).setUint16(53, rawId.length);
    auth.set(rawId, 55);
    const creation = { type: "public-key", rawId, response: {
        clientDataJSON: utf8(JSON.stringify({ type: "webauthn.create", challenge: encode(options.challenge), origin: options.origin })),
        getAuthenticatorData: () => auth, getPublicKeyAlgorithm: () => -7, getPublicKey: () => publicKey,
    } };
    const registration = await verifyRegistration(creation, options);
    const data = auth.slice(0, 37);
    data[32] = 0x05;
    new DataView(data.buffer).setUint32(33, 1);
    const clientDataJSON = utf8(JSON.stringify({ type: "webauthn.get", challenge: encode(options.challenge), origin: options.origin }));
    const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", clientDataJSON));
    const rawSignature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keys.privateKey,
        Uint8Array.of(...data, ...hash)));
    const assertion = { type: "public-key", rawId, response: {
        authenticatorData: data, clientDataJSON, signature: rawToDer(rawSignature), userHandle: utf8("account-a"),
    } };
    return { options, registration, creation, assertion, rawSignature };
};

test("registration and assertion verify an actual ES256 signature and advance the counter", async () => {
    const { options, registration, assertion, rawSignature } = await fixture();
    assert.deepEqual(derSignatureToRaw(assertion.response.signature), rawSignature);
    assert.equal((await verifyAssertion(assertion, registration, options)).counter, 1);
});

test("assertions reject incorrect challenge, origin, RP, identity, and a reused counter", async () => {
    const { options, registration, assertion } = await fixture();
    for (const changed of [{ challenge: utf8("wrong challenge") }, { origin: "https://evil.example" }, { rpId: "evil.example" }]) {
        await assert.rejects(verifyAssertion(assertion, registration, { ...options, ...changed }));
    }
    await assert.rejects(verifyAssertion(assertion, { ...registration, id: "wrong-id" }, options), /Unknown assertion credential/);
    await assert.rejects(verifyAssertion(assertion, { ...registration, userHandle: "wrong-user" }, options), /user handle/);
    await assert.rejects(verifyAssertion(assertion, { ...registration, counter: 1 }, options), /counter/);
});

test("assertions reject signature tampering and absent user verification", async () => {
    const { options, registration, assertion } = await fixture();
    assertion.response.signature[assertion.response.signature.length - 1] ^= 1;
    await assert.rejects(verifyAssertion(assertion, registration, options), /signature/);
    assertion.response.authenticatorData[32] = 1;
    await assert.rejects(verifyAssertion(assertion, registration, options), /presence and verification/);
});

test("registrations reject a mismatched credential ID and RP hash", async () => {
    const { options, creation } = await fixture();
    await assert.rejects(verifyRegistration({ ...creation, rawId: utf8("different-id") }, options), /credential ID/);
    await assert.rejects(verifyRegistration(creation, { ...options, rpId: "evil.example" }), /relying-party hash/);
});

test("DER conversion rejects truncated, negative, and trailing signature data", () => {
    for (const value of [Uint8Array.of(0x30, 6, 2), Uint8Array.of(0x30, 6, 2, 1, 0x80, 2, 1, 1),
        Uint8Array.of(0x30, 7, 2, 1, 1, 2, 1, 1, 0)]) {
        assert.throws(() => derSignatureToRaw(value));
    }
});
