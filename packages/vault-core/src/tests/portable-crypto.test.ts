/**
 * @jest-environment node
 */
import { describe, expect, it } from "@jest/globals";
import { webcrypto } from "crypto";
import { aeskw } from "@noble/ciphers/aes.js";

Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    writable: true,
});

import { deriveHkdfSha256 } from "../vault-utils/hkdf";
import { createWebCryptoEnvelopeCrypto } from "../runtime";

const wrapRawKeyWithAesKw = (
    rawKey: Uint8Array,
    wrappingKey: Uint8Array,
): Uint8Array =>
    new Uint8Array(
        aeskw(new Uint8Array(wrappingKey)).encrypt(new Uint8Array(rawKey)),
    );

const unwrapRawKeyWithAesKw = (
    wrappedKey: Uint8Array,
    wrappingKey: Uint8Array,
): Uint8Array =>
    new Uint8Array(
        aeskw(new Uint8Array(wrappingKey)).decrypt(new Uint8Array(wrappedKey)),
    );

const hex = (value: string): Uint8Array =>
    new Uint8Array(
        value.match(/.{2}/g)?.map((byte) => Number.parseInt(byte, 16)) ?? [],
    );

const toHex = (value: Uint8Array): string =>
    Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");

const ascii = (value: string): Uint8Array =>
    Uint8Array.from(value, (character) => character.charCodeAt(0));

describe("portable cryptography wire compatibility", () => {
    it("WebCrypto envelope backend passes its known-answer self-test", async () => {
        await expect(
            createWebCryptoEnvelopeCrypto().selfTest(),
        ).resolves.toBeUndefined();
    });

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

    it("preserves the vault's 256-bit HKDF and AES-KW output", () => {
        const wrappingKey = deriveHkdfSha256(
            hex(
                "000102030405060708090a0b0c0d0e0f" +
                    "101112131415161718191a1b1c1d1e1f",
            ),
            hex(
                "f0e0d0c0b0a090807060504030201000" +
                    "ffeeddccbbaa99887766554433221100",
            ),
            ascii("cryptex/kek/v1|01J00000000000000000000000"),
        );
        const rawKey = hex(
            "00112233445566778899aabbccddeeff" +
                "000102030405060708090a0b0c0d0e0f",
        );

        expect(toHex(wrappingKey)).toBe(
            "42a6e799a9d1f2ec7c222e9a3fd03a28" +
                "ca92f211948fcc9572ccd13d9569c052",
        );

        const wrapped = wrapRawKeyWithAesKw(rawKey, wrappingKey);
        expect(toHex(wrapped)).toBe(
            "9ba053cbe0619b996a04ccd77700c40d" +
                "e2d7b9921bc566637a40e1dc585db184" +
                "2914956b9627efbe",
        );
        expect(toHex(unwrapRawKeyWithAesKw(wrapped, wrappingKey))).toBe(
            toHex(rawKey),
        );
    });
});
