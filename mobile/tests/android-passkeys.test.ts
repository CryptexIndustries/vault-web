import { describe, expect, it } from "@jest/globals";

import type { PasskeyData } from "@cryptex-industries/vault-core/proto";

import {
    assertAndroidPasskey,
    createAndroidPasskey,
} from "@/utils/android-passkeys";
import { ES256_ALGORITHM_IDENTIFIER } from "@/utils/android-passkey-authenticator-data";

const AAGUID_HEX = "bec1418fa8c44c38ac6f3e3e1f9ad0c0";

const CREATE_REQUEST = {
    rp: { id: "localhost", name: "Cryptex E2E" },
    user: {
        id: "Zml4dHVyZS11c2Vy",
        name: "fixture@example.test",
        displayName: "Fixture User",
    },
    challenge: "Y3J5cHRleC1kZXRlcm1pbmlzdGljLWNyZWF0ZQ",
    pubKeyCredParams: [{ type: "public-key", alg: -7 }],
    authenticatorSelection: { residentKey: "required" },
};

const decodeBase64Url = (value: string): Uint8Array =>
    new Uint8Array(Buffer.from(value, "base64url"));

const concat = (...parts: Uint8Array[]): Uint8Array<ArrayBuffer> => {
    const buffer = new ArrayBuffer(
        parts.reduce((total, part) => total + part.length, 0),
    );
    const output = new Uint8Array(buffer);
    let offset = 0;
    for (const part of parts) {
        output.set(part, offset);
        offset += part.length;
    }
    return output;
};

/** Minimal CBOR decoder covering the fixed shapes this module emits. */
function decodeCbor(bytes: Uint8Array): unknown {
    let offset = 0;
    const readHead = (): { major: number; argument: number } => {
        const head = bytes[offset++]!;
        const major = head >> 5;
        const info = head & 0x1f;
        if (info < 24) return { major, argument: info };
        if (info === 24) return { major, argument: bytes[offset++]! };
        if (info === 25) {
            const value = (bytes[offset++]! << 8) | bytes[offset++]!;
            return { major, argument: value };
        }
        const value =
            ((bytes[offset++]! << 24) |
                (bytes[offset++]! << 16) |
                (bytes[offset++]! << 8) |
                bytes[offset++]!) >>>
            0;
        return { major, argument: value };
    };
    const decode = (): unknown => {
        const { major, argument } = readHead();
        if (major === 0) return argument;
        if (major === 1) return -1 - argument;
        if (major === 2) {
            const value = bytes.slice(offset, offset + argument);
            offset += argument;
            return value;
        }
        if (major === 3) {
            const value = Buffer.from(
                bytes.slice(offset, offset + argument),
            ).toString("utf8");
            offset += argument;
            return value;
        }
        if (major === 5) {
            const map = new Map<unknown, unknown>();
            for (let index = 0; index < argument; index += 1) {
                const key = decode();
                map.set(key, decode());
            }
            return map;
        }
        throw new Error(`Unsupported CBOR major type ${major}`);
    };
    return decode();
}


describe("android passkey registration", () => {
    it("creates a discoverable ES256 passkey with a verifiable response", async () => {
        const { passkey, responseJson } = await createAndroidPasskey(
            JSON.stringify(CREATE_REQUEST),
            "http://localhost:43110",
        );

        const credentialId = decodeBase64Url(passkey.CredentialID);
        expect(credentialId).toHaveLength(32);
        expect(passkey.RPID).toBe("localhost");
        expect(passkey.UserHandle).toBe(CREATE_REQUEST.user.id);
        expect(passkey.UserName).toBe(CREATE_REQUEST.user.name);
        expect(passkey.UserDisplayName).toBe("Fixture User");
        expect(passkey.Algorithm).toBe(ES256_ALGORITHM_IDENTIFIER);
        expect(passkey.SignCount).toBe(0);
        expect(passkey.Discoverable).toBe(true);

        const response = JSON.parse(responseJson) as {
            id: string;
            rawId: string;
            type: string;
            response: Record<string, string | number | string[]>;
            clientExtensionResults: Record<string, never>;
        };
        expect(response.id).toBe(passkey.CredentialID);
        expect(response.rawId).toBe(passkey.CredentialID);
        expect(response.type).toBe("public-key");
        expect(response.response.transports).toEqual(["internal"]);
        expect(response.response.publicKeyAlgorithm).toBe(
            ES256_ALGORITHM_IDENTIFIER,
        );

        const clientData = JSON.parse(
            Buffer.from(
                decodeBase64Url(String(response.response.clientDataJSON)),
            ).toString("utf8"),
        ) as { type: string; challenge: string; origin: string };
        expect(clientData.type).toBe("webauthn.create");
        expect(clientData.challenge).toBe(CREATE_REQUEST.challenge);
        expect(clientData.origin).toBe("http://localhost:43110");

        const attestation = decodeCbor(
            decodeBase64Url(String(response.response.attestationObject)),
        ) as Map<string, unknown>;
        expect(attestation.get("fmt")).toBe("none");
        const authData = attestation.get("authData") as Uint8Array;
        expect(authData).toBeInstanceOf(Uint8Array);

        const expectedRpIdHash = new Uint8Array(
            await crypto.subtle.digest(
                "SHA-256",
                new TextEncoder().encode("localhost"),
            ),
        );
        expect(authData.slice(0, 32)).toEqual(expectedRpIdHash);
        // UP | UV | BE | BS | AT
        expect(authData[32]).toBe(0x5d);
        expect(Array.from(authData.slice(33, 37))).toEqual([0, 0, 0, 0]);
        expect(Array.from(authData.slice(37, 53))).toEqual(
            AAGUID_HEX.match(/../gu)!.map((byte) => Number.parseInt(byte, 16)),
        );
        expect(authData[53]).toBe(0);
        expect(authData[54]).toBe(32);

        const coseKey = decodeCbor(authData.slice(87)) as Map<number, unknown>;
        expect(coseKey.get(1)).toBe(2);
        expect(coseKey.get(3)).toBe(ES256_ALGORITHM_IDENTIFIER);
        expect(coseKey.get(-1)).toBe(1);

        const jwk = JSON.parse(passkey.PublicKey) as {
            kty: string;
            crv: string;
            x: string;
            y: string;
        };
        expect(jwk.kty).toBe("EC");
        expect(jwk.crv).toBe("P-256");
        expect(Array.from(coseKey.get(-2) as Uint8Array)).toEqual([
            ...decodeBase64Url(jwk.x),
        ]);
        expect(Array.from(coseKey.get(-3) as Uint8Array)).toEqual([
            ...decodeBase64Url(jwk.y),
        ]);

        // The SPKI must carry the same public point as the COSE key.
        const spki = decodeBase64Url(String(response.response.publicKey));
        expect(Array.from(spki.slice(-64))).toEqual([
            ...decodeBase64Url(jwk.x),
            ...decodeBase64Url(jwk.y),
        ]);
    });

    it("omits clientDataJSON when the caller supplies its hash", async () => {
        const clientDataHash = crypto.getRandomValues(new Uint8Array(32));
        const { responseJson } = await createAndroidPasskey(
            JSON.stringify(CREATE_REQUEST),
            "http://localhost:43110",
            clientDataHash,
        );
        const response = JSON.parse(responseJson) as {
            response: Record<string, unknown>;
        };
        expect(response.response.clientDataJSON).toBeUndefined();
        expect(response.response.attestationObject).toBeDefined();
    });

    it("rejects requests without ES256 support", async () => {
        await expect(
            createAndroidPasskey(
                JSON.stringify({
                    ...CREATE_REQUEST,
                    pubKeyCredParams: [{ type: "public-key", alg: -257 }],
                }),
                "http://localhost:43110",
            ),
        ).rejects.toThrow("PASSKEY_ALGORITHM_UNSUPPORTED");
    });

    it("rejects malformed challenges and oversized user handles", async () => {
        await expect(
            createAndroidPasskey(
                JSON.stringify({ ...CREATE_REQUEST, challenge: "not base64!" }),
                "https://example.test",
            ),
        ).rejects.toThrow("PASSKEY_CHALLENGE_INVALID");

        await expect(
            createAndroidPasskey(
                JSON.stringify({
                    ...CREATE_REQUEST,
                    user: {
                        ...CREATE_REQUEST.user,
                        id: Buffer.alloc(65).toString("base64url"),
                    },
                }),
                "https://example.test",
            ),
        ).rejects.toThrow("PASSKEY_USER_HANDLE_INVALID");
    });

    it("honors excludeCredentials before generating a replacement", async () => {
        const existingId = Buffer.alloc(32, 7).toString("base64url");
        await expect(
            createAndroidPasskey(
                JSON.stringify({
                    ...CREATE_REQUEST,
                    excludeCredentials: [
                        { type: "public-key", id: existingId },
                    ],
                }),
                "https://example.test",
                undefined,
                [existingId],
            ),
        ).rejects.toThrow("PASSKEY_CREDENTIAL_EXCLUDED");
    });

    it("rejects caller hashes that are not SHA-256 length", async () => {
        await expect(
            createAndroidPasskey(
                JSON.stringify(CREATE_REQUEST),
                "https://example.test",
                new Uint8Array(31),
            ),
        ).rejects.toThrow("PASSKEY_CLIENT_DATA_HASH_INVALID");
    });
});

describe("android passkey assertion", () => {
    it("signs the authenticator data and caller client data hash", async () => {
        const { passkey } = await createAndroidPasskey(
            JSON.stringify(CREATE_REQUEST),
            "http://localhost:43110",
        );

        const clientDataHash = crypto.getRandomValues(new Uint8Array(32));
        const assertionJson = await assertAndroidPasskey(
            JSON.stringify({
                challenge: "Y3J5cHRleC1kZXRlcm1pbmlzdGljLWdldA",
                rpId: "localhost",
            }),
            "http://localhost:43110",
            passkey,
            clientDataHash,
        );

        const assertion = JSON.parse(assertionJson) as {
            id: string;
            response: Record<string, string>;
        };
        expect(assertion.id).toBe(passkey.CredentialID);
        expect(assertion.response.clientDataJSON).toBeUndefined();
        expect(assertion.response.userHandle).toBe(passkey.UserHandle);

        const authData = decodeBase64Url(assertion.response.authenticatorData);
        const expectedRpIdHash = new Uint8Array(
            await crypto.subtle.digest(
                "SHA-256",
                new TextEncoder().encode("localhost"),
            ),
        );
        expect(authData.slice(0, 32)).toEqual(expectedRpIdHash);
        // UP | UV | BE | BS
        expect(authData[32]).toBe(0x1d);
        expect(Array.from(authData.slice(33, 37))).toEqual([0, 0, 0, 0]);

        const signedData = concat(authData, clientDataHash);
        // WebAuthn carries ECDSA signatures in DER; WebCrypto verifies raw P1363.
        const jwk = JSON.parse(passkey.PublicKey) as JsonWebKey;
        const publicKey = await crypto.subtle.importKey(
            "jwk",
            jwk,
            { name: "ECDSA", namedCurve: "P-256" },
            true,
            ["verify"],
        );
        const der = decodeBase64Url(assertion.response.signature);
        let offset = 2;
        // SEQUENCE header consumed; each INTEGER carries a tag byte first.
        offset += 1;
        const rLength = der[offset++]!;
        const r = der.slice(offset, offset + rLength);
        offset += rLength;
        offset += 1;
        const sLength = der[offset++]!;
        const s = der.slice(offset, offset + sLength);
        const pad32 = (value: Uint8Array): Uint8Array => {
            const out = new Uint8Array(32);
            const trimmed = value.length > 32 ? value.slice(-32) : value;
            out.set(trimmed, 32 - trimmed.length);
            return out;
        };
        const raw: ArrayBuffer = new Uint8Array([
            ...pad32(r),
            ...pad32(s),
        ]).buffer;
        const verified = await crypto.subtle.verify(
            { name: "ECDSA", hash: "SHA-256" },
            publicKey,
            raw,
            signedData,
        );
        expect(verified).toBe(true);
    });
    it("rejects assertions for a different relying party", async () => {
        const { passkey } = await createAndroidPasskey(
            JSON.stringify(CREATE_REQUEST),
            "http://localhost:43110",
        );
        await expect(
            assertAndroidPasskey(
                JSON.stringify({ challenge: "Y2hhbGxlbmdl", rpId: "other.com" }),
                "http://localhost:43110",
                passkey,
            ),
        ).rejects.toThrow("PASSKEY_RP_ID_MISMATCH");
    });

    it("enforces allowCredentials for the selected passkey", async () => {
        const { passkey } = await createAndroidPasskey(
            JSON.stringify(CREATE_REQUEST),
            "https://example.test",
        );
        await expect(
            assertAndroidPasskey(
                JSON.stringify({
                    challenge: "Y2hhbGxlbmdl",
                    rpId: "localhost",
                    allowCredentials: [
                        {
                            type: "public-key",
                            id: Buffer.alloc(32, 9).toString("base64url"),
                        },
                    ],
                }),
                "https://example.test",
                passkey,
            ),
        ).rejects.toThrow("PASSKEY_CREDENTIAL_NOT_ALLOWED");
    });

    it("rejects malformed descriptors and caller hashes", async () => {
        const { passkey } = await createAndroidPasskey(
            JSON.stringify(CREATE_REQUEST),
            "https://example.test",
        );
        await expect(
            assertAndroidPasskey(
                JSON.stringify({
                    challenge: "Y2hhbGxlbmdl",
                    rpId: "localhost",
                    allowCredentials: [{ type: "public-key", id: "bad!" }],
                }),
                "https://example.test",
                passkey,
            ),
        ).rejects.toThrow("PASSKEY_ALLOW_CREDENTIALS_INVALID");
        await expect(
            assertAndroidPasskey(
                JSON.stringify({
                    challenge: "Y2hhbGxlbmdl",
                    rpId: "localhost",
                }),
                "https://example.test",
                passkey,
                new Uint8Array(33),
            ),
        ).rejects.toThrow("PASSKEY_CLIENT_DATA_HASH_INVALID");

        await expect(
            assertAndroidPasskey(
                JSON.stringify({
                    challenge: "Y2hhbGxlbmdl",
                    rpId: "localhost",
                }),
                "https://example.test",
                {
                    ...passkey,
                    UserHandle: Buffer.alloc(65).toString("base64url"),
                },
            ),
        ).rejects.toThrow("PASSKEY_USER_HANDLE_INVALID");
    });
});

describe("android passkey passkey storage", () => {
    it("stores a private JWK capable of reproducing the public key", async () => {
        const { passkey } = await createAndroidPasskey(
            JSON.stringify(CREATE_REQUEST),
            "http://localhost:43110",
        );
        const stored: PasskeyData = passkey;
        const privateJwk = JSON.parse(stored.PrivateKey) as JsonWebKey & {
            d: string;
        };
        expect(privateJwk.kty).toBe("EC");
        expect(privateJwk.crv).toBe("P-256");
        expect(privateJwk.d).toBeDefined();
        const privateKey = await crypto.subtle.importKey(
            "jwk",
            privateJwk,
            { name: "ECDSA", namedCurve: "P-256" },
            true,
            ["sign"],
        );
        expect(privateKey.type).toBe("private");
        const exportedPublic = await crypto.subtle.exportKey(
            "jwk",
            privateKey,
        );
        const publicJwk = JSON.parse(stored.PublicKey) as { x: string; y: string };
        expect((exportedPublic as { x: string }).x).toBe(publicJwk.x);
        expect((exportedPublic as { y: string }).y).toBe(publicJwk.y);
    });
});
