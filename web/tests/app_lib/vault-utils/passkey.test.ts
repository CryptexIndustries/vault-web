/**
 * @jest-environment node
 */
import { describe, it, expect, beforeAll, jest } from "@jest/globals";
import { webcrypto } from "crypto";

jest.mock("../../../src/server/cache/redis", () => ({
    getRedis: () => ({
        setex: jest.fn(),
        eval: jest.fn(),
    }),
}));

import { verifyPasskeySignature } from "../../../src/server/auth/challenge";
import {
    base64UrlToUint8Array,
    generateKeyPair,
    parseJwkFromString,
    privateKeyJwkToString,
    publicKeyJwkToString,
    signChallenge,
} from "../../../src/app_lib/vault-utils/passkey";

beforeAll(() => {
    if (!globalThis.crypto?.subtle) {
        Object.defineProperty(globalThis, "crypto", {
            value: webcrypto,
            configurable: true,
        });
    }
});

describe("passkey.ts", () => {
    it("generateKeyPair produces P-256 ECDSA JWKs with sign/verify material", async () => {
        const { publicKey, privateKey } = await generateKeyPair();
        expect(publicKey.kty).toBe("EC");
        expect(publicKey.crv).toBe("P-256");
        expect(publicKey.x).toBeTruthy();
        expect(publicKey.y).toBeTruthy();
        expect(privateKey.d).toBeTruthy();
    });

    it("publicKeyJwkToString / parseJwkFromString round-trips", async () => {
        const { publicKey } = await generateKeyPair();
        const s = publicKeyJwkToString(publicKey);
        const parsed = parseJwkFromString(s);
        expect(parsed.x).toBe(publicKey.x);
        expect(parsed.y).toBe(publicKey.y);
    });

    it("privateKeyJwkToString imports for signing; ECDSA signatures are non-deterministic between calls", async () => {
        const { publicKey, privateKey } = await generateKeyPair();
        const s = privateKeyJwkToString(privateKey);
        const challenge = crypto.getRandomValues(new Uint8Array(32));
        const sig1 = await signChallenge(privateKey, challenge);
        const sig2 = await signChallenge(s, challenge);
        expect(sig1).not.toBe(sig2);
        const buf = Buffer.from(challenge);
        expect(
            verifyPasskeySignature(publicKeyJwkToString(publicKey), buf, sig1),
        ).toBe(true);
        expect(
            verifyPasskeySignature(publicKeyJwkToString(publicKey), buf, sig2),
        ).toBe(true);
    });

    it("base64UrlToUint8Array round-trips arbitrary bytes", () => {
        const bytes = new Uint8Array([1, 2, 3, 4, 5, 255, 0, 128]);
        const b64url = Buffer.from(bytes)
            .toString("base64")
            .replace(/\+/g, "-")
            .replace(/\//g, "_")
            .replace(/=+$/, "");
        expect(Array.from(base64UrlToUint8Array(b64url))).toEqual(
            Array.from(bytes),
        );
    });

    it("base64UrlToUint8Array decodes Web Crypto–style base64url signatures", async () => {
        const { privateKey } = await generateKeyPair();
        const challenge = new Uint8Array([1, 2, 3, 4, 5]);
        const b64url = await signChallenge(privateKey, challenge);
        const decoded = base64UrlToUint8Array(b64url);
        expect(decoded).toBeInstanceOf(Uint8Array);
        expect(decoded.length).toBe(64);
    });

    it("parseJwkFromString throws SyntaxError on invalid JSON", () => {
        // Source: `return JSON.parse(s) as JsonWebKey;` — no try/catch.
        expect(() => parseJwkFromString("not-json")).toThrow(SyntaxError);
        expect(() => parseJwkFromString("{ key: 'no quotes' }")).toThrow();
    });

    it("signChallenge propagates errors from crypto.subtle.importKey", async () => {
        const importKeySpy = jest
            .spyOn(crypto.subtle, "importKey")
            .mockRejectedValueOnce(new Error("importKey boom"));
        try {
            const fakeJwk = {
                kty: "EC",
                crv: "P-256",
                d: "AA",
                x: "BB",
                y: "CC",
            };
            await expect(
                signChallenge(fakeJwk as never, new Uint8Array([1, 2, 3])),
            ).rejects.toThrow("importKey boom");
        } finally {
            importKeySpy.mockRestore();
        }
    });

    it("signChallenge propagates errors from crypto.subtle.sign", async () => {
        const { privateKey } = await generateKeyPair();
        const signSpy = jest
            .spyOn(crypto.subtle, "sign")
            .mockRejectedValueOnce(new Error("sign boom"));
        try {
            await expect(
                signChallenge(privateKey, new Uint8Array([1, 2, 3])),
            ).rejects.toThrow("sign boom");
        } finally {
            signSpy.mockRestore();
        }
    });

    describe("integration with server verifyPasskeySignature", () => {
        it("signChallenge output verifies with verifyPasskeySignature on same challenge bytes", async () => {
            const { publicKey, privateKey } = await generateKeyPair();
            const challengeBytes = Buffer.from(
                crypto.getRandomValues(new Uint8Array(32)),
            );
            const challengeUint = new Uint8Array(challengeBytes);

            const signatureB64Url = await signChallenge(
                privateKey,
                challengeUint,
            );

            const ok = verifyPasskeySignature(
                publicKeyJwkToString(publicKey),
                challengeBytes,
                signatureB64Url,
            );
            expect(ok).toBe(true);
        });

        it("fails when challenge bytes differ", async () => {
            const { publicKey, privateKey } = await generateKeyPair();
            const a = Buffer.from(crypto.getRandomValues(new Uint8Array(32)));
            const b = Buffer.from(crypto.getRandomValues(new Uint8Array(32)));

            const signatureB64Url = await signChallenge(
                privateKey,
                new Uint8Array(a),
            );

            expect(
                verifyPasskeySignature(
                    publicKeyJwkToString(publicKey),
                    b,
                    signatureB64Url,
                ),
            ).toBe(false);
        });

        it("fails with wrong public key", async () => {
            const { publicKey: pk1, privateKey } = await generateKeyPair();
            const { publicKey: pk2 } = await generateKeyPair();
            const challengeBytes = Buffer.from(
                crypto.getRandomValues(new Uint8Array(32)),
            );

            const signatureB64Url = await signChallenge(
                privateKey,
                new Uint8Array(challengeBytes),
            );

            expect(
                verifyPasskeySignature(
                    publicKeyJwkToString(pk2),
                    challengeBytes,
                    signatureB64Url,
                ),
            ).toBe(false);
            expect(
                verifyPasskeySignature(
                    publicKeyJwkToString(pk1),
                    challengeBytes,
                    signatureB64Url,
                ),
            ).toBe(true);
        });
    });
});
