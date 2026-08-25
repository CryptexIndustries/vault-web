/** @jest-environment node */
import { describe, expect, it } from "@jest/globals";
import { webcrypto } from "node:crypto";

Object.defineProperty(globalThis, "crypto", { value: webcrypto });
Object.defineProperty(globalThis, "btoa", {
    value: (value: string) => Buffer.from(value, "binary").toString("base64"),
});
Object.defineProperty(globalThis, "atob", {
    value: (value: string) => Buffer.from(value, "base64").toString("binary"),
});

import type { PasskeyData } from "@cryptex-industries/vault-core/proto";
import {
    decodeBase64Url,
    es256RawSignatureToDer,
    generatePasskeyAssertion,
} from "../src/content/passkey-assertion";

function derToRaw(der: Uint8Array): Uint8Array {
    if (der[0] !== 0x30) throw new Error("Expected DER sequence");
    let offset = 2;
    const readInteger = () => {
        if (der[offset++] !== 0x02) throw new Error("Expected DER integer");
        const length = der[offset++]!;
        let value = der.slice(offset, offset + length);
        offset += length;
        if (value[0] === 0) value = value.slice(1);
        const padded = new Uint8Array(32);
        padded.set(value, 32 - value.length);
        return padded;
    };
    const r = readInteger();
    const s = readInteger();
    return new Uint8Array([...r, ...s]);
}

describe("passkey assertion generation", () => {
    it("DER-encodes positive ES256 integers", () => {
        const raw = new Uint8Array(64);
        raw[0] = 0x80;
        raw[32] = 0x01;
        const der = es256RawSignatureToDer(raw);
        expect(der[0]).toBe(0x30);
        expect(der[2]).toBe(0x02);
        expect(der[3]).toBe(33);
        expect(der[4]).toBe(0);
        expect(derToRaw(der)).toEqual(raw);
    });

    it("generates an assertion verifiable by the registered public key", async () => {
        const keyPair = (await crypto.subtle.generateKey(
            { name: "ECDSA", namedCurve: "P-256" },
            true,
            ["sign", "verify"],
        )) as CryptoKeyPair;
        const [privateJwk, publicJwk] = await Promise.all([
            crypto.subtle.exportKey("jwk", keyPair.privateKey),
            crypto.subtle.exportKey("jwk", keyPair.publicKey),
        ]);
        const passkey: PasskeyData = {
            CredentialID: Buffer.from("credential-id").toString("base64url"),
            RPID: "example.com",
            RPName: "Example",
            UserHandle: Buffer.from("user-id").toString("base64url"),
            UserName: "person@example.com",
            UserDisplayName: "Person",
            PublicKey: JSON.stringify(publicJwk),
            PrivateKey: JSON.stringify(privateJwk),
            Algorithm: -7,
            SignCount: 0,
            Discoverable: true,
        };
        const challenge = Buffer.from("challenge").toString("base64url");
        const assertion = await generatePasskeyAssertion({
            passkey,
            challenge,
            rpId: "example.com",
            origin: "https://example.com",
            userVerified: true,
        });

        const clientData = decodeBase64Url(assertion.clientDataJSON);
        expect(JSON.parse(new TextDecoder().decode(clientData))).toEqual({
            type: "webauthn.get",
            challenge,
            origin: "https://example.com",
            crossOrigin: false,
        });
        const authenticatorData = decodeBase64Url(assertion.authenticatorData);
        const clientHash = new Uint8Array(
            await crypto.subtle.digest("SHA-256", clientData),
        );
        const signedData = new Uint8Array([
            ...authenticatorData,
            ...clientHash,
        ]);
        const verified = await crypto.subtle.verify(
            { name: "ECDSA", hash: "SHA-256" },
            keyPair.publicKey,
            derToRaw(decodeBase64Url(assertion.signature)),
            signedData,
        );
        expect(verified).toBe(true);
    });
});
