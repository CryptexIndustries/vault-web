/**
 * @jest-environment node
 *
 * Uses real `libsodium-wrappers-sumo` (unlike `encryption.test.ts`, which mocks it for branch coverage).
 */
import { beforeAll, describe, expect, it, jest } from "@jest/globals";
import sodium from "libsodium-wrappers-sumo";
import { webcrypto } from "crypto";
import { TextDecoder, TextEncoder } from "util";

Object.defineProperty(globalThis, "TextEncoder", {
    value: TextEncoder,
    writable: true,
});

Object.defineProperty(globalThis, "TextDecoder", {
    value: TextDecoder,
    writable: true,
});

Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
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

import * as VaultUtilTypes from "../../src/app_lib/proto/vault";
import {
    DecryptDataBlob,
    EncryptDataBlob,
    EncryptedBlob,
    KeyDerivationConfig_Argon2ID,
    KeyDerivationConfig_PBKDF2,
    hashSecret,
} from "../../src/app_lib/vault-utils/encryption";

const decodeUtf8 = (value: Uint8Array): string => new TextDecoder().decode(value);

describe("vault-utils/encryption integration (real libsodium)", () => {
    beforeAll(async () => {
        await sodium.ready;
    });

    it("round-trips XChaCha20-Poly1305 payload with Argon2ID KDF", async () => {
        const payload = new TextEncoder().encode("integration-test-payload");
        const secret = await hashSecret("correct horse battery staple");
        const argonConfig = new KeyDerivationConfig_Argon2ID(8, 1);

        const encrypted = await EncryptDataBlob(
            payload,
            secret,
            VaultUtilTypes.EncryptionAlgorithm.XChaCha20Poly1305,
            VaultUtilTypes.KeyDerivationFunction.Argon2ID,
            argonConfig,
            new KeyDerivationConfig_PBKDF2(),
        );
        const decrypted = await DecryptDataBlob(
            encrypted,
            secret,
            VaultUtilTypes.EncryptionAlgorithm.XChaCha20Poly1305,
            VaultUtilTypes.KeyDerivationFunction.Argon2ID,
            argonConfig,
        );

        expect(decrypted.isOk()).toBe(true);
        if (decrypted.isOk()) {
            expect(decodeUtf8(decrypted.value)).toBe("integration-test-payload");
        }
    });

    it("returns DECRYPTION_FAILED with wrong secret for XChaCha20-Poly1305", async () => {
        const payload = new TextEncoder().encode("sealed message");
        const secret = await hashSecret("secret-a");
        const wrongSecret = await hashSecret("secret-b");
        const argonConfig = new KeyDerivationConfig_Argon2ID(8, 1);

        const encrypted = await EncryptDataBlob(
            payload,
            secret,
            VaultUtilTypes.EncryptionAlgorithm.XChaCha20Poly1305,
            VaultUtilTypes.KeyDerivationFunction.Argon2ID,
            argonConfig,
            new KeyDerivationConfig_PBKDF2(),
        );
        const decrypted = await DecryptDataBlob(
            encrypted,
            wrongSecret,
            VaultUtilTypes.EncryptionAlgorithm.XChaCha20Poly1305,
            VaultUtilTypes.KeyDerivationFunction.Argon2ID,
            argonConfig,
        );

        expect(decrypted.isErr()).toBe(true);
        if (decrypted.isErr()) {
            expect(decrypted.error).toBe("DECRYPTION_FAILED");
        }
    });

    it("returns DECRYPTION_FAILED when XChaCha20 header is tampered", async () => {
        const payload = new Uint8Array([10, 20, 30, 40, 50]);
        const secret = await hashSecret("tamper-header");
        const argonConfig = new KeyDerivationConfig_Argon2ID(8, 1);

        const encrypted = await EncryptDataBlob(
            payload,
            secret,
            VaultUtilTypes.EncryptionAlgorithm.XChaCha20Poly1305,
            VaultUtilTypes.KeyDerivationFunction.Argon2ID,
            argonConfig,
            new KeyDerivationConfig_PBKDF2(),
        );

        const originalHeader = Buffer.from(encrypted.HeaderIV, "base64");
        originalHeader[0] = (originalHeader[0] ?? 0) ^ 0xff;
        encrypted.HeaderIV = originalHeader.toString("base64");

        const decrypted = await DecryptDataBlob(
            encrypted,
            secret,
            VaultUtilTypes.EncryptionAlgorithm.XChaCha20Poly1305,
            VaultUtilTypes.KeyDerivationFunction.Argon2ID,
            argonConfig,
        );

        expect(decrypted.isErr()).toBe(true);
        if (decrypted.isErr()) {
            expect(decrypted.error).toBe("DECRYPTION_FAILED");
        }
    });

    it("returns DECRYPTION_FAILED when XChaCha20 ciphertext is tampered", async () => {
        const payload = new Uint8Array([1, 3, 5, 7, 9, 11]);
        const secret = await hashSecret("tamper-ciphertext");
        const argonConfig = new KeyDerivationConfig_Argon2ID(8, 1);

        const encrypted = await EncryptDataBlob(
            payload,
            secret,
            VaultUtilTypes.EncryptionAlgorithm.XChaCha20Poly1305,
            VaultUtilTypes.KeyDerivationFunction.Argon2ID,
            argonConfig,
            new KeyDerivationConfig_PBKDF2(),
        );
        const tamperedBlob = encrypted.Blob.slice();
        tamperedBlob[0] = (tamperedBlob[0] ?? 0) ^ 0xff;
        encrypted.Blob = tamperedBlob;

        const decrypted = await DecryptDataBlob(
            encrypted,
            secret,
            VaultUtilTypes.EncryptionAlgorithm.XChaCha20Poly1305,
            VaultUtilTypes.KeyDerivationFunction.Argon2ID,
            argonConfig,
        );

        expect(decrypted.isErr()).toBe(true);
        if (decrypted.isErr()) {
            expect(decrypted.error).toBe("DECRYPTION_FAILED");
        }
    });

    it("keeps blob decryptable after protobuf serialization round-trip", async () => {
        const payload = new TextEncoder().encode("serialize-me");
        const secret = await hashSecret("protobuf-secret");
        const argonConfig = new KeyDerivationConfig_Argon2ID(8, 1);

        const encrypted = await EncryptDataBlob(
            payload,
            secret,
            VaultUtilTypes.EncryptionAlgorithm.XChaCha20Poly1305,
            VaultUtilTypes.KeyDerivationFunction.Argon2ID,
            argonConfig,
            new KeyDerivationConfig_PBKDF2(),
        );
        const binary = VaultUtilTypes.EncryptedBlob.encode(encrypted).finish();
        const deserialized = EncryptedBlob.fromBinary(binary);

        const decrypted = await DecryptDataBlob(
            deserialized,
            secret,
            VaultUtilTypes.EncryptionAlgorithm.XChaCha20Poly1305,
            VaultUtilTypes.KeyDerivationFunction.Argon2ID,
            argonConfig,
        );

        expect(decrypted.isOk()).toBe(true);
        if (decrypted.isOk()) {
            expect(decodeUtf8(decrypted.value)).toBe("serialize-me");
        }
    });

    it("produces distinct salts, headers and ciphertexts for same input", async () => {
        const payload = new TextEncoder().encode("same-input");
        const secret = await hashSecret("same-secret");
        const argonConfig = new KeyDerivationConfig_Argon2ID(8, 1);

        const encryptedA = await EncryptDataBlob(
            payload,
            secret,
            VaultUtilTypes.EncryptionAlgorithm.XChaCha20Poly1305,
            VaultUtilTypes.KeyDerivationFunction.Argon2ID,
            argonConfig,
            new KeyDerivationConfig_PBKDF2(),
        );
        const encryptedB = await EncryptDataBlob(
            payload,
            secret,
            VaultUtilTypes.EncryptionAlgorithm.XChaCha20Poly1305,
            VaultUtilTypes.KeyDerivationFunction.Argon2ID,
            argonConfig,
            new KeyDerivationConfig_PBKDF2(),
        );

        expect(encryptedA.Salt).not.toBe(encryptedB.Salt);
        expect(encryptedA.HeaderIV).not.toBe(encryptedB.HeaderIV);
        expect(Array.from(encryptedA.Blob)).not.toEqual(Array.from(encryptedB.Blob));
    });
});
