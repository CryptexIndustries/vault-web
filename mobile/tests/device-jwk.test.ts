import { describe, expect, it } from "@jest/globals";

import { normalizeEcJwk } from "@/utils/device-jwk";

describe("normalizeEcJwk", () => {
    it("converts native padded EC key members to unpadded base64url", () => {
        const normalized = normalizeEcJwk({
            kty: "EC",
            crv: "P-256",
            x: "ab+/cd==",
            y: "ef/_gh.",
            d: "ij-_kl..",
            key_ops: ["sign"],
        });

        expect(normalized).toMatchObject({
            x: "ab-_cd",
            y: "ef__gh",
            d: "ij-_kl",
            key_ops: ["sign"],
        });
        expect(normalized.x).not.toMatch(/[+/.=]/);
        expect(normalized.y).not.toMatch(/[+/.=]/);
        expect(normalized.d).not.toMatch(/[+/.=]/);
    });

    it("does not change unrelated JWK metadata", () => {
        const jwk: JsonWebKey = {
            kty: "EC",
            crv: "P-256",
            x: "already_url-safe",
            y: "also-safe",
            ext: true,
        };

        expect(normalizeEcJwk(jwk)).toEqual(jwk);
    });
});
