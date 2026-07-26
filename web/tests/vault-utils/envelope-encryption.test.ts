/**
 * @jest-environment node
 */
import { beforeAll, describe, expect, it, jest } from "@jest/globals";
import { webcrypto } from "crypto";
import { TextEncoder } from "util";

Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    writable: true,
});
Object.defineProperty(globalThis, "TextEncoder", {
    value: TextEncoder,
    writable: true,
});

jest.mock(
    "@/lib/utils",
    () => ({
        base64ToUint8: (value: string): Uint8Array =>
            new Uint8Array(Buffer.from(value, "base64")),
        uint8ToBase64: (value: Uint8Array): string =>
            Buffer.from(value).toString("base64"),
        base64UrlToUint8: (value: string): Uint8Array =>
            new Uint8Array(Buffer.from(value, "base64url")),
        uint8ToBase64Url: (value: Uint8Array): string =>
            Buffer.from(value).toString("base64url"),
    }),
    { virtual: true },
);

import sodium from "libsodium-wrappers-sumo";
import * as VaultUtilTypes from "@cryptex-industries/vault-core/proto";
import {
    buildKekInfo,
    deriveKEK,
    derivePasswordKey,
    deriveRecoveryKEK,
    encryptWithDEK,
    decryptWithDEK,
    generateExtractableDEK,
    generateRandomSalt,
    generateRecoveryCode,
    importHkdfBaseKey,
    openPrimarySlot,
    openRecoverySlot,
    unwrapDEK,
    unwrapDEKFromSlot,
    wrapDEK,
    buildKeyEnvelope,
    encodeSlot,
} from "@cryptex-industries/vault-core/vault-utils/envelope-encryption";
import { KeyDerivationConfig_Argon2ID } from "@cryptex-industries/vault-core/vault-utils/encryption";
import { configureTestVaultCoreRuntime } from "../helpers/vault-core-runtime";
import { createWebCryptoEnvelopeCrypto } from "@cryptex-industries/vault-core/runtime";

configureTestVaultCoreRuntime();

describe("envelope-encryption", () => {
    beforeAll(async () => {
        await sodium.ready;
    });

    it("wraps and unwraps DEK with password-only KEK", async () => {
        const kdf = new KeyDerivationConfig_Argon2ID(8, 1);
        const salt = generateRandomSalt();
        const hkdfSalt = generateRandomSalt();
        const pwKey = await derivePasswordKey("test-password", salt, kdf);
        const kek = await deriveKEK(
            pwKey,
            buildKekInfo("vault-1"),
            null,
            hkdfSalt,
        );

        const dekExtractable = await generateExtractableDEK();
        const wrapped = await wrapDEK(dekExtractable, kek);
        const dek = await unwrapDEK(wrapped, kek);

        expect(dek.extractable).toBe(false);

        const plain = new TextEncoder().encode("hello envelope");
        const { ciphertext, iv } = await encryptWithDEK(dek, plain);
        const decrypted = await decryptWithDEK(dek, ciphertext, iv);
        expect(decrypted.isOk()).toBe(true);
        if (decrypted.isOk()) {
            expect(new TextDecoder().decode(decrypted.value)).toBe(
                "hello envelope",
            );
        }
    });

    it("uses default KDF config and returns decrypt errors", async () => {
        const salt = generateRandomSalt();
        const pwKey = await derivePasswordKey("default-password", salt);
        expect(pwKey).toHaveLength(32);

        const dek = await generateExtractableDEK();
        const badDecrypt = await decryptWithDEK(
            dek,
            new Uint8Array([1, 2, 3]),
            Buffer.from(new Uint8Array(12)).toString("base64"),
        );
        expect(badDecrypt.isErr()).toBe(true);
        if (badDecrypt.isErr()) {
            expect(badDecrypt.error).toBe("DECRYPTION_FAILED");
        }
    });

    it("opens primary and recovery slots", async () => {
        const kdf = new KeyDerivationConfig_Argon2ID(8, 1);
        const vaultId = "42";
        const primarySalt = generateRandomSalt();
        const recoverySalt = generateRandomSalt();
        const hkdfSalt = generateRandomSalt();
        const pwKey = await derivePasswordKey("master", primarySalt, kdf);
        const primaryKek = await deriveKEK(
            pwKey,
            buildKekInfo(vaultId),
            null,
            hkdfSalt,
        );

        const recoveryCode = generateRecoveryCode();
        const recoveryKek = await deriveRecoveryKEK(
            recoveryCode,
            recoverySalt,
            kdf,
        );

        const dekExtractable = await generateExtractableDEK();
        const wrappedPrimary = await wrapDEK(dekExtractable, primaryKek);
        const wrappedRecovery = await wrapDEK(dekExtractable, recoveryKek);

        const envelope = buildKeyEnvelope(
            [
                encodeSlot(
                    VaultUtilTypes.KeySlotKind.PRIMARY,
                    VaultUtilTypes.SecondFactorKind.NONE,
                    wrappedPrimary,
                    primarySalt,
                    kdf,
                    hkdfSalt,
                    vaultId,
                ),
                encodeSlot(
                    VaultUtilTypes.KeySlotKind.RECOVERY,
                    VaultUtilTypes.SecondFactorKind.NONE,
                    wrappedRecovery,
                    recoverySalt,
                    kdf,
                    null,
                    vaultId,
                ),
            ],
            VaultUtilTypes.SecondFactorKind.NONE,
            vaultId,
        );

        const viaPrimary = await openPrimarySlot(
            envelope.Slots[0] as VaultUtilTypes.KeySlot & {
                Kind: VaultUtilTypes.KeySlotKind.PRIMARY;
            },
            "master",
            vaultId,
            null,
        );
        const viaRecovery = await openRecoverySlot(envelope, recoveryCode);

        expect(viaPrimary.isOk()).toBe(true);
        expect(viaRecovery.isOk()).toBe(true);
    });

    it("requires second factor when configured", async () => {
        const kdf = new KeyDerivationConfig_Argon2ID(8, 1);
        const vaultId = "99";
        const primarySalt = generateRandomSalt();
        const sfSalt = generateRandomSalt();
        const sfBytes = crypto.getRandomValues(new Uint8Array(16));
        const pwKey = await derivePasswordKey("master", primarySalt, kdf);

        await sodium.ready;
        const sfDerived = await (
            await import("@cryptex-industries/vault-core/vault-utils/envelope-encryption")
        ).deriveSecondFactorKeyMaterial(sfBytes, sfSalt, kdf);
        const sfKey = await importHkdfBaseKey(sfDerived);
        const kek = await deriveKEK(pwKey, buildKekInfo(vaultId), sfKey, null);

        const dekExtractable = await generateExtractableDEK();
        const wrapped = await wrapDEK(dekExtractable, kek);

        const envelope = buildKeyEnvelope(
            [
                encodeSlot(
                    VaultUtilTypes.KeySlotKind.PRIMARY,
                    VaultUtilTypes.SecondFactorKind.PASSPHRASE_128,
                    wrapped,
                    primarySalt,
                    kdf,
                    null,
                    vaultId,
                ),
                encodeSlot(
                    VaultUtilTypes.KeySlotKind.RECOVERY,
                    VaultUtilTypes.SecondFactorKind.NONE,
                    wrapped,
                    generateRandomSalt(),
                    kdf,
                    null,
                    vaultId,
                ),
            ],
            VaultUtilTypes.SecondFactorKind.PASSPHRASE_128,
            vaultId,
        );

        const primarySlot = envelope.Slots[0] as VaultUtilTypes.KeySlot & {
            Kind: VaultUtilTypes.KeySlotKind.PRIMARY;
        };
        const withoutSf = await openPrimarySlot(
            primarySlot,
            "master",
            vaultId,
            null,
        );
        const withSf = await openPrimarySlot(
            primarySlot,
            "master",
            vaultId,
            sfKey,
        );

        expect(withoutSf.isErr()).toBe(true);
        expect(withSf.isOk()).toBe(true);
    });

    it("returns RECOVERY_KEK_FAILED when recovery KDF fails", async () => {
        const envelope = buildKeyEnvelope(
            [
                encodeSlot(
                    VaultUtilTypes.KeySlotKind.RECOVERY,
                    VaultUtilTypes.SecondFactorKind.NONE,
                    new Uint8Array(40),
                    new Uint8Array([1]),
                    new KeyDerivationConfig_Argon2ID(8, 1),
                    null,
                    "vault-1",
                ),
            ],
            VaultUtilTypes.SecondFactorKind.NONE,
            "vault-1",
        );

        const res = await openRecoverySlot(envelope, "recovery-code");

        expect(res.isErr()).toBe(true);
        if (res.isErr()) {
            expect(res.error).toBe("RECOVERY_KEK_FAILED");
        }
    });

    it("disposes transient HKDF and KEK handles after slot opens", async () => {
        const cryptoPort = createWebCryptoEnvelopeCrypto();
        const disposeHkdfKey = jest.fn(cryptoPort.disposeHkdfKey);
        const disposeKek = jest.fn(cryptoPort.disposeKek);
        configureTestVaultCoreRuntime({
            envelopeCrypto: {
                ...cryptoPort,
                disposeHkdfKey,
                disposeKek,
            },
        });

        try {
            const kdf = new KeyDerivationConfig_Argon2ID(8, 1);
            const salt = generateRandomSalt();
            const hkdfSalt = generateRandomSalt();
            const vaultId = "lifecycle";
            const pwKey = await derivePasswordKey("master", salt, kdf);
            const setupKek = await deriveKEK(
                pwKey,
                buildKekInfo(vaultId),
                null,
                hkdfSalt,
            );
            const dek = await generateExtractableDEK();
            const wrapped = await wrapDEK(dek, setupKek);
            cryptoPort.disposeKek(setupKek);
            const slot = encodeSlot(
                VaultUtilTypes.KeySlotKind.PRIMARY,
                VaultUtilTypes.SecondFactorKind.NONE,
                wrapped,
                salt,
                kdf,
                hkdfSalt,
                vaultId,
            ) as VaultUtilTypes.KeySlot & {
                Kind: VaultUtilTypes.KeySlotKind.PRIMARY;
            };
            disposeHkdfKey.mockClear();
            disposeKek.mockClear();

            await expect(
                openPrimarySlot(slot, "master", vaultId, null),
            ).resolves.toEqual(
                expect.objectContaining({ value: expect.anything() }),
            );
            expect(disposeHkdfKey).toHaveBeenCalledTimes(1);
            expect(disposeKek).toHaveBeenCalledTimes(1);

            await expect(
                openPrimarySlot(slot, "wrong-password", vaultId, null),
            ).resolves.toEqual(
                expect.objectContaining({ error: "DEK_UNWRAP_FAILED" }),
            );
            expect(disposeHkdfKey).toHaveBeenCalledTimes(2);
            expect(disposeKek).toHaveBeenCalledTimes(2);
        } finally {
            configureTestVaultCoreRuntime();
        }
    });

    it("validates domain inputs and normalizes unwrap failures", async () => {
        await expect(importHkdfBaseKey(new Uint8Array(31))).rejects.toThrow(
            "VAULT_HKDF_IKM_INVALID",
        );
        await expect(
            deriveKEK(new Uint8Array(31), buildKekInfo("vault-1"), null, null),
        ).rejects.toThrow("VAULT_PASSWORD_KEY_INVALID");
        await expect(
            deriveKEK(new Uint8Array(32), "", null, generateRandomSalt()),
        ).rejects.toThrow("VAULT_HKDF_INFO_REQUIRED");

        const kek = await deriveKEK(
            new Uint8Array(32),
            buildKekInfo("vault-1"),
            null,
            generateRandomSalt(),
        );
        const dek = await generateExtractableDEK();
        const wrapped = await wrapDEK(dek, kek);
        const slot = encodeSlot(
            VaultUtilTypes.KeySlotKind.PRIMARY,
            VaultUtilTypes.SecondFactorKind.NONE,
            wrapped,
            generateRandomSalt(),
            new KeyDerivationConfig_Argon2ID(8, 1),
            generateRandomSalt(),
            "vault-1",
        );

        const malformed = await unwrapDEKFromSlot(
            { ...slot, WrappedDEK: new Uint8Array(39) },
            kek,
        );
        expect(malformed).toEqual(
            expect.objectContaining({ error: "DEK_UNWRAP_FAILED" }),
        );

        const tamperedWrapped = new Uint8Array(wrapped);
        tamperedWrapped[0] = tamperedWrapped[0]! ^ 1;
        const tampered = await unwrapDEKFromSlot(
            { ...slot, WrappedDEK: tamperedWrapped },
            kek,
        );
        expect(tampered).toEqual(
            expect.objectContaining({ error: "DEK_UNWRAP_FAILED" }),
        );

        configureTestVaultCoreRuntime({
            envelopeCrypto: {
                ...createWebCryptoEnvelopeCrypto(),
                unwrapDek: async () => {
                    throw new Error("VAULT_PLATFORM_CRYPTO_UNAVAILABLE");
                },
            },
        });
        try {
            const unavailable = await unwrapDEKFromSlot(slot, kek);
            expect(unavailable).toEqual(
                expect.objectContaining({
                    error: "VAULT_PLATFORM_CRYPTO_UNAVAILABLE",
                }),
            );
        } finally {
            configureTestVaultCoreRuntime();
        }
    });
});
