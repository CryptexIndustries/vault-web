/**
 * @jest-environment node
 */
import { describe, expect, it } from "@jest/globals";

import {
    buildAssertionAuthenticatorData,
    buildNoneAttestationObject,
    buildRegistrationAuthenticatorData,
    CRYPTEX_VAULT_SYNCED_SOFTWARE_AUTHENTICATOR_AAGUID,
    encodeAuthenticatorFlags,
} from "../src/content/passkey-authenticator-data";

const coordinate = (byte: number) =>
    Buffer.alloc(32, byte).toString("base64url");

const publicKey: JsonWebKey = {
    kty: "EC",
    crv: "P-256",
    x: coordinate(0x11),
    y: coordinate(0x22),
};

describe("passkey authenticator-data encoding", () => {
    it("names and combines WebAuthn flags without magic values", () => {
        expect(
            encodeAuthenticatorFlags({
                userPresent: true,
                userVerified: false,
                backupEligible: true,
                backedUp: true,
                includesAttestedCredentialData: true,
            }),
        ).toBe(0x59);
    });

    it("rejects the invalid backed-up-without-eligibility flag state", () => {
        expect(() =>
            encodeAuthenticatorFlags({
                userPresent: true,
                userVerified: false,
                backupEligible: false,
                backedUp: true,
                includesAttestedCredentialData: true,
            }),
        ).toThrow("must be backup eligible");
    });

    it("encodes each registration field in WebAuthn order", async () => {
        const credentialId = Uint8Array.of(0xaa, 0xbb);
        const data = await buildRegistrationAuthenticatorData({
            rpId: "example.com",
            credentialId,
            publicKey,
            userVerified: false,
        });

        // 32-byte RP hash, flags, 4-byte counter, 16-byte AAGUID,
        // 2-byte credential length, credential ID, and 77-byte ES256 COSE key.
        expect(data).toHaveLength(32 + 1 + 4 + 16 + 2 + 2 + 77);
        expect(data[32]).toBe(0x59);
        expect(data.slice(33, 37)).toEqual(Uint8Array.of(0, 0, 0, 0));
        expect(data.slice(37, 53)).toEqual(
            CRYPTEX_VAULT_SYNCED_SOFTWARE_AUTHENTICATOR_AAGUID,
        );
        expect(data.slice(53, 55)).toEqual(Uint8Array.of(0, 2));
        expect(data.slice(55, 57)).toEqual(Uint8Array.of(0xaa, 0xbb));

        // Canonical COSE EC2/ES256/P-256 map followed by X and Y coordinates.
        expect(data.slice(57, 67)).toEqual(
            Uint8Array.of(
                0xa5,
                0x01,
                0x02,
                0x03,
                0x26,
                0x20,
                0x01,
                0x21,
                0x58,
                0x20,
            ),
        );
        expect(data.slice(67, 99)).toEqual(new Uint8Array(32).fill(0x11));
        expect(data.slice(99, 102)).toEqual(Uint8Array.of(0x22, 0x58, 0x20));
        expect(data.slice(102)).toEqual(new Uint8Array(32).fill(0x22));
    });

    it("wraps authenticator data in canonical none attestation CBOR", () => {
        const encoded = buildNoneAttestationObject(Uint8Array.of(1, 2, 3));
        expect([...encoded]).toEqual([
            0xa3, 0x63, 0x66, 0x6d, 0x74, 0x64, 0x6e, 0x6f, 0x6e, 0x65, 0x67,
            0x61, 0x74, 0x74, 0x53, 0x74, 0x6d, 0x74, 0xa0, 0x68, 0x61, 0x75,
            0x74, 0x68, 0x44, 0x61, 0x74, 0x61, 0x43, 0x01, 0x02, 0x03,
        ]);
    });

    it("encodes assertion data without attested credential material", async () => {
        const data = await buildAssertionAuthenticatorData({
            rpId: "example.com",
            signCount: 0,
            userVerified: true,
        });

        expect(data).toHaveLength(37);
        expect(data[32]).toBe(0x1d); // UP | UV | BE | BS
        expect(data.slice(33)).toEqual(Uint8Array.of(0, 0, 0, 0));
        expect(data.slice(0, 32)).toEqual(
            new Uint8Array(
                await crypto.subtle.digest(
                    "SHA-256",
                    new TextEncoder().encode("example.com"),
                ),
            ),
        );
    });
});
