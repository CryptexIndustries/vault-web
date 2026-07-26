import { describe, expect, it } from "@jest/globals";

import {
    unwrapRawKeyWithAesKw,
    wrapRawKeyWithAesKw,
} from "../vault-utils/aes-key-wrap";
import { deriveHkdfSha256 } from "../vault-utils/hkdf";

const hex = (value: string): Uint8Array =>
    new Uint8Array(
        value.match(/.{2}/g)?.map((byte) => Number.parseInt(byte, 16)) ?? [],
    );

const toHex = (value: Uint8Array): string =>
    Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");

describe("portable cryptography wire compatibility", () => {
    it("matches RFC 5869 HKDF-SHA-256 test case 1", () => {
        const output = deriveHkdfSha256(
            new Uint8Array(22).fill(0x0b),
            hex("000102030405060708090a0b0c"),
            hex("f0f1f2f3f4f5f6f7f8f9"),
            42,
        );

        expect(toHex(output)).toBe(
            "3cb25f25faacd57a90434f64d0362f2a" +
                "2d2d0a90cf1a5a4c5db02d56ecc4c5bf" +
                "34007208d5b887185865",
        );
    });

    it("matches RFC 3394 AES-KW 128-bit test vector", () => {
        const wrappingKey = hex("000102030405060708090a0b0c0d0e0f");
        const rawKey = hex("00112233445566778899aabbccddeeff");
        const expected =
            "1fa68b0a8112b447aef34bd8fb5a7b82" + "9d3e862371d2cfe5";

        const wrapped = wrapRawKeyWithAesKw(rawKey, wrappingKey);
        expect(toHex(wrapped)).toBe(expected);
        expect(toHex(unwrapRawKeyWithAesKw(wrapped, wrappingKey))).toBe(
            toHex(rawKey),
        );
    });
});
