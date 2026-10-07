import { afterEach, describe, expect, it, jest } from "@jest/globals";
import * as vaultCoreRuntime from "@cryptex-industries/vault-core/runtime";
import { KeyDerivationConfig_Argon2ID } from "@cryptex-industries/vault-core/vault-utils/encryption";
import {
    deriveKEK,
    deriveRecoveryKEK,
    importHkdfBaseKey,
} from "@cryptex-industries/vault-core/vault-utils/envelope-encryption";

import { createMobileEnvelopeCrypto } from "@/crypto/envelope-crypto";

afterEach(() => {
    jest.restoreAllMocks();
});

const hex = (value: string): Uint8Array =>
    Uint8Array.from(value.match(/.{2}/g) ?? [], (byte) =>
        Number.parseInt(byte, 16),
    );

const ascii = (value: string): Uint8Array =>
    Uint8Array.from(value, (character) => character.charCodeAt(0));

const toHex = (value: Uint8Array): string =>
    Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");

describe("mobile envelope cryptography", () => {
    it("uses native AES-256-KW with wire-compatible HKDF output", async () => {
        const cryptoPort = createMobileEnvelopeCrypto();
        expect(cryptoPort.backend).toBe("quick-crypto-native");
        await expect(cryptoPort.selfTest()).resolves.toBeUndefined();

        const hkdfKey = await cryptoPort.importHkdfKey(
            hex(
                "000102030405060708090a0b0c0d0e0f" +
                    "101112131415161718191a1b1c1d1e1f",
            ),
        );
        const kek = await cryptoPort.deriveKek(
            hkdfKey,
            hex(
                "f0e0d0c0b0a090807060504030201000" +
                    "ffeeddccbbaa99887766554433221100",
            ),
            ascii("cryptex/kek/v1|01J00000000000000000000000"),
        );
        const rawDek = hex(
            "00112233445566778899aabbccddeeff" +
                "000102030405060708090a0b0c0d0e0f",
        );
        const dek = await crypto.subtle.importKey(
            "raw",
            new Uint8Array(rawDek),
            { name: "AES-GCM", length: 256 },
            true,
            ["encrypt", "decrypt"],
        );

        const wrapped = await cryptoPort.wrapDek(dek, kek);
        const shortDek = await crypto.subtle.generateKey(
            { name: "AES-GCM", length: 128 },
            true,
            ["encrypt", "decrypt"],
        );
        await expect(cryptoPort.wrapDek(shortDek, kek)).rejects.toThrow(
            "VAULT_DEK_INVALID",
        );
        await expect(
            cryptoPort.unwrapDek(new Uint8Array(24), kek, false),
        ).rejects.toThrow("VAULT_WRAPPED_DEK_INVALID");
        expect(toHex(wrapped)).toBe(
            "9ba053cbe0619b996a04ccd77700c40d" +
                "e2d7b9921bc566637a40e1dc585db184" +
                "2914956b9627efbe",
        );

        const unwrapped = await cryptoPort.unwrapDek(wrapped, kek, true);
        expect(
            toHex(
                new Uint8Array(await crypto.subtle.exportKey("raw", unwrapped)),
            ),
        ).toBe(toHex(rawDek));

        const tampered = new Uint8Array(wrapped);
        tampered[0] = tampered[0]! ^ 1;
        await expect(
            cryptoPort.unwrapDek(tampered, kek, false),
        ).rejects.toBeDefined();

        cryptoPort.disposeKek(kek);
        cryptoPort.disposeKek(kek);
        await expect(cryptoPort.wrapDek(dek, kek)).rejects.toThrow(
            "VAULT_KEK_BACKEND_MISMATCH",
        );

        cryptoPort.disposeHkdfKey(hkdfKey);
        cryptoPort.disposeHkdfKey(hkdfKey);
        await expect(
            cryptoPort.deriveKek(
                hkdfKey,
                new Uint8Array(32),
                ascii("cryptex/kek/v1|disposed"),
            ),
        ).rejects.toThrow("VAULT_HKDF_KEY_BACKEND_MISMATCH");
    });

    it("fails closed and caches a failed native known-answer test", async () => {
        const wrap = jest
            .spyOn(crypto.subtle, "wrapKey")
            .mockImplementation(async () => {
                throw new Error("native cipher unavailable");
            });
        const cryptoPort = createMobileEnvelopeCrypto();

        await expect(cryptoPort.selfTest()).rejects.toThrow(
            "VAULT_PLATFORM_CRYPTO_UNAVAILABLE",
        );
        await expect(
            cryptoPort.importHkdfKey(new Uint8Array(32)),
        ).rejects.toThrow("VAULT_PLATFORM_CRYPTO_UNAVAILABLE");
        expect(wrap).toHaveBeenCalledTimes(1);
        wrap.mockRestore();
    });
});

describe("envelope key buffer lifetime", () => {
    it.each<["HKDF" | "AES-KW", boolean]>([
        ["HKDF", false],
        ["HKDF", true],
        ["AES-KW", false],
        ["AES-KW", true],
    ])(
        "wipes owned %s import bytes and preserves caller bytes, failure=%s",
        async (algorithm, fail) => {
            const port = vaultCoreRuntime.createWebCryptoEnvelopeCrypto();
            jest.spyOn(vaultCoreRuntime, "getEnvelopeCrypto").mockReturnValue(
                port,
            );
            const backing = new Uint8Array(40).fill(9);
            const callerBytes = new Uint8Array(backing.buffer, 4, 32);
            const originalImport = crypto.subtle.importKey.bind(crypto.subtle);
            const imported: Uint8Array[] = [];
            jest.spyOn(crypto.subtle, "importKey").mockImplementationOnce(
                async (...args) => {
                    const data = args[1];
                    if (!(data instanceof Uint8Array))
                        throw new Error("expected byte input");
                    imported.push(data);
                    expect(data.buffer).not.toBe(backing.buffer);
                    await Promise.resolve();
                    expect(data).toEqual(new Uint8Array(32).fill(9));
                    if (fail) throw new Error("import failed");
                    return originalImport(...args);
                },
            );
            const result =
                algorithm === "HKDF"
                    ? importHkdfBaseKey(callerBytes)
                    : port.importKek(callerBytes);
            if (fail) await expect(result).rejects.toThrow("import failed");
            else await result;
            expect(imported).toEqual([new Uint8Array(32)]);
            expect(backing).toEqual(new Uint8Array(40).fill(9));
        },
    );

    it.each([false, true])(
        "wipes the owned password-key HKDF salt after derivation settles, failure=%s",
        async (fail) => {
            const port = vaultCoreRuntime.createWebCryptoEnvelopeCrypto();
            const base = await port.importHkdfKey(new Uint8Array(32).fill(3));
            jest.spyOn(vaultCoreRuntime, "getEnvelopeCrypto").mockReturnValue(
                port,
            );
            const passwordKey = new Uint8Array(32).fill(9);
            const originalDerive = crypto.subtle.deriveKey.bind(crypto.subtle);
            const salts: Uint8Array[] = [];
            jest.spyOn(crypto.subtle, "deriveKey").mockImplementationOnce(
                async (...args) => {
                    const algorithm = args[0];
                    if (
                        typeof algorithm === "string" ||
                        !("salt" in algorithm) ||
                        !(algorithm.salt instanceof Uint8Array)
                    ) {
                        throw new Error("expected HKDF salt bytes");
                    }
                    salts.push(algorithm.salt);
                    expect(algorithm.salt.buffer).not.toBe(passwordKey.buffer);
                    await Promise.resolve();
                    expect(algorithm.salt).toEqual(new Uint8Array(32).fill(9));
                    if (fail) throw new Error("derivation failed");
                    return originalDerive(...args);
                },
            );
            const result = deriveKEK(passwordKey, "test KEK", base, null);
            if (fail) await expect(result).rejects.toThrow("derivation failed");
            else await result;
            expect(salts).toEqual([new Uint8Array(32)]);
            expect(passwordKey).toEqual(new Uint8Array(32).fill(9));
        },
    );

    it.each([false, true])(
        "wipes derived recovery KEK bytes after import settles, failure=%s",
        async (fail) => {
            const port = vaultCoreRuntime.createWebCryptoEnvelopeCrypto();
            jest.spyOn(vaultCoreRuntime, "getEnvelopeCrypto").mockReturnValue(
                port,
            );
            const originalImport = port.importKek.bind(port);
            const materials: Uint8Array[] = [];
            const importKek = jest
                .spyOn(port, "importKek")
                .mockImplementationOnce(async (bytes) => {
                    materials.push(bytes);
                    const expected = bytes.slice();
                    await Promise.resolve();
                    expect(bytes).toEqual(expected);
                    if (fail) throw new Error("import failed");
                    return originalImport(bytes);
                });
            const salt = new Uint8Array(16).fill(3);
            const result = deriveRecoveryKEK(
                "recovery code",
                salt,
                new KeyDerivationConfig_Argon2ID(19, 2),
            );
            if (fail) await expect(result).rejects.toThrow("import failed");
            else await result;
            expect(importKek).toHaveBeenCalledTimes(1);
            expect(materials).toEqual([new Uint8Array(32)]);
            expect(salt).toEqual(new Uint8Array(16).fill(3));
        },
    );
});
