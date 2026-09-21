/**
 * `libsodium-wrappers-sumo` is mocked below. For real XChaCha20-Poly1305 / Argon2ID behavior,
 * see `encryption.integration.test.ts`.
 */
import {
    describe,
    it,
    expect,
    jest,
    beforeEach,
    afterEach,
} from "@jest/globals";
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
        base64ToUint8: (value: string) =>
            new Uint8Array(Buffer.from(value, "base64")),
        uint8ToBase64: (value: Uint8Array) =>
            Buffer.from(value).toString("base64"),
        base64UrlToUint8: (value: string) =>
            new Uint8Array(Buffer.from(value, "base64url")),
        uint8ToBase64Url: (value: Uint8Array) =>
            Buffer.from(value).toString("base64url"),
    }),
    { virtual: true },
);

jest.mock("libsodium-wrappers-sumo", () => {
    const xorWithKey = (data: Uint8Array, key: Uint8Array): Uint8Array => {
        const out = new Uint8Array(data.length);
        for (let i = 0; i < data.length; i++) {
            const dataByte = data[i] ?? 0;
            const keyByte = key[i % key.length] ?? 0;
            out[i] = dataByte ^ keyByte;
        }
        return out;
    };

    const toKey = (data: Uint8Array) => Buffer.from(data).toString("base64");
    const ciphertextState = new Map<
        string,
        { key: string; header: string; message: Uint8Array }
    >();
    let randomCounter = 0;

    const makePseudoRandom = (size: number): Uint8Array => {
        const output = new Uint8Array(size);
        for (let i = 0; i < size; i++) {
            // Deterministic but unique per call to emulate nonce/salt variability.
            output[i] = (randomCounter * 53 + i * 29 + 17) % 256;
        }
        randomCounter += 1;
        return output;
    };

    return {
        ready: Promise.resolve(),
        crypto_pwhash_ALG_ARGON2ID13: 2,
        crypto_secretstream_xchacha20poly1305_KEYBYTES: 32,
        crypto_shorthash_KEYBYTES: 16,
        randombytes_buf: jest.fn((size: number) => makePseudoRandom(size)),
        crypto_pwhash: jest.fn(
            (
                keyLen: number,
                secret: Uint8Array,
                salt: Uint8Array,
                opsLimit: number,
                memLimit: number,
            ) => {
                const output = new Uint8Array(keyLen);
                for (let i = 0; i < keyLen; i++) {
                    const s = secret[i % secret.length] ?? 0;
                    const sa = salt[i % salt.length] ?? 0;
                    output[i] =
                        (s ^ sa ^ (opsLimit + i) ^ (memLimit & 0xff)) & 0xff;
                }
                return output;
            },
        ),
        crypto_secretstream_xchacha20poly1305_init_push: jest.fn(
            (key: Uint8Array) => {
                const header = makePseudoRandom(24);
                return {
                    state: {
                        id: "state",
                        key: new Uint8Array(key),
                        header: new Uint8Array(header),
                    },
                    header,
                };
            },
        ),
        crypto_secretstream_xchacha20poly1305_TAG_MESSAGE: 0,
        crypto_secretstream_xchacha20poly1305_push: jest.fn(
            (
                state: { key: Uint8Array },
                blob: Uint8Array,
                _ad: unknown,
                _tag: number,
            ) => {
                const out = xorWithKey(blob, state.key);
                const cKey = toKey(out);
                ciphertextState.set(cKey, {
                    key: toKey(state.key),
                    // libsodium uses header from init; we bind it to state in this mock.
                    header: toKey(
                        (state as { header?: Uint8Array }).header ??
                            new Uint8Array(),
                    ),
                    message: new Uint8Array(blob),
                });
                return out;
            },
        ),
        crypto_secretstream_xchacha20poly1305_init_pull: jest.fn(
            (header: Uint8Array, key: Uint8Array) => ({
                id: "state-in",
                header: toKey(header),
                key: toKey(key),
            }),
        ),
        crypto_secretstream_xchacha20poly1305_pull: jest.fn(
            (state: { header: string; key: string }, encrypted: Uint8Array) => {
                const record = ciphertextState.get(toKey(encrypted));
                if (
                    record == undefined ||
                    record.key !== state.key ||
                    record.header !== state.header
                ) {
                    return false;
                }

                return {
                    message: new Uint8Array(record.message),
                };
            },
        ),
        __resetMockState: jest.fn(() => {
            ciphertextState.clear();
            randomCounter = 0;
        }),
    };
});

import * as VaultUtilTypes from "@cryptex-industries/vault-core/proto";
import sodium from "libsodium-wrappers-sumo";
import {
    DecryptDataBlob,
    EncryptDataBlob,
    EncryptedBlob,
    KeyDerivationConfig_Argon2ID,
    KeyDerivationConfig_PBKDF2,
    hashSecret,
    isRecoverySlot,
} from "@cryptex-industries/vault-core/vault-utils/encryption";

describe("vault-utils/encryption", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (
            sodium as typeof sodium & { __resetMockState: () => void }
        ).__resetMockState();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("creates default encrypted blob with argon2 config", () => {
        const blob = EncryptedBlob.CreateDefault();

        expect(blob.Algorithm).toBe(
            VaultUtilTypes.EncryptionAlgorithm.XChaCha20Poly1305,
        );
        expect(blob.KeyDerivationFunc).toBe(
            VaultUtilTypes.KeyDerivationFunction.Argon2ID,
        );
        expect(blob.KDFConfigArgon2ID).toBeInstanceOf(
            KeyDerivationConfig_Argon2ID,
        );
    });

    it("identifies recovery slots", () => {
        expect(
            isRecoverySlot({
                Kind: VaultUtilTypes.KeySlotKind.RECOVERY,
            } as VaultUtilTypes.KeySlot),
        ).toBe(true);
        expect(
            isRecoverySlot({
                Kind: VaultUtilTypes.KeySlotKind.PRIMARY,
            } as VaultUtilTypes.KeySlot),
        ).toBe(false);
    });

    it("upgrades legacy encrypted blob metadata and marks requiresSave", () => {
        const blob = EncryptedBlob.CreateDefault();
        blob.Version = 1;
        blob.CurrentVersion = 0;

        const result = blob.upgrade();

        expect(result).toEqual({
            upgraded: true,
            version: 3,
            requiresSave: true,
        });
        expect(blob.CurrentVersion).toBe(3);
    });

    it("encrypts and decrypts AES256 data with PBKDF2", async () => {
        const plain = new TextEncoder().encode("secret payload");
        const secret = await hashSecret("pw");

        const encrypted = await EncryptDataBlob(
            plain,
            secret,
            VaultUtilTypes.EncryptionAlgorithm.AES256,
            VaultUtilTypes.KeyDerivationFunction.PBKDF2,
            new KeyDerivationConfig_Argon2ID(),
            new KeyDerivationConfig_PBKDF2(1000),
        );

        const decrypted = await DecryptDataBlob(
            encrypted,
            secret,
            VaultUtilTypes.EncryptionAlgorithm.AES256,
            VaultUtilTypes.KeyDerivationFunction.PBKDF2,
            new KeyDerivationConfig_PBKDF2(1000),
        );

        expect(decrypted.isOk()).toBe(true);
        if (decrypted.isOk()) {
            expect(new TextDecoder().decode(decrypted.value)).toBe(
                "secret payload",
            );
        }
    });

    it("returns decryption failure for wrong AES secret", async () => {
        const plain = new TextEncoder().encode("payload");
        const secret = await hashSecret("pw");
        const wrongSecret = await hashSecret("wrong");

        const encrypted = await EncryptDataBlob(
            plain,
            secret,
            VaultUtilTypes.EncryptionAlgorithm.AES256,
            VaultUtilTypes.KeyDerivationFunction.PBKDF2,
            new KeyDerivationConfig_Argon2ID(),
            new KeyDerivationConfig_PBKDF2(1000),
        );

        const decrypted = await DecryptDataBlob(
            encrypted,
            wrongSecret,
            VaultUtilTypes.EncryptionAlgorithm.AES256,
            VaultUtilTypes.KeyDerivationFunction.PBKDF2,
            new KeyDerivationConfig_PBKDF2(1000),
        );

        expect(decrypted.isErr()).toBe(true);
        if (decrypted.isErr()) {
            expect(decrypted.error).toBe("DECRYPTION_FAILED");
        }
    });

    it("encrypts and decrypts XChaCha20 data with mocked sodium backend", async () => {
        const plain = new Uint8Array([1, 2, 3, 4]);
        const secret = await hashSecret("argon-secret");
        const argon = new KeyDerivationConfig_Argon2ID(2, 1);

        const encrypted = await EncryptDataBlob(
            plain,
            secret,
            VaultUtilTypes.EncryptionAlgorithm.XChaCha20Poly1305,
            VaultUtilTypes.KeyDerivationFunction.Argon2ID,
            argon,
            new KeyDerivationConfig_PBKDF2(),
        );
        const decrypted = await DecryptDataBlob(
            encrypted,
            secret,
            VaultUtilTypes.EncryptionAlgorithm.XChaCha20Poly1305,
            VaultUtilTypes.KeyDerivationFunction.Argon2ID,
            argon,
        );

        expect(decrypted.isOk()).toBe(true);
        if (decrypted.isOk()) {
            expect(Array.from(decrypted.value)).toEqual([1, 2, 3, 4]);
        }
        expect(sodium.crypto_pwhash).toHaveBeenCalled();
        expect(
            sodium.crypto_secretstream_xchacha20poly1305_push,
        ).toHaveBeenCalled();
    });

    it("fails XChaCha20 decryption with wrong secret", async () => {
        const plain = new Uint8Array([5, 4, 3, 2, 1]);
        const secret = await hashSecret("correct");
        const wrongSecret = await hashSecret("incorrect");
        const argon = new KeyDerivationConfig_Argon2ID(2, 1);

        const encrypted = await EncryptDataBlob(
            plain,
            secret,
            VaultUtilTypes.EncryptionAlgorithm.XChaCha20Poly1305,
            VaultUtilTypes.KeyDerivationFunction.Argon2ID,
            argon,
            new KeyDerivationConfig_PBKDF2(),
        );

        const decrypted = await DecryptDataBlob(
            encrypted,
            wrongSecret,
            VaultUtilTypes.EncryptionAlgorithm.XChaCha20Poly1305,
            VaultUtilTypes.KeyDerivationFunction.Argon2ID,
            argon,
        );

        expect(decrypted.isErr()).toBe(true);
        if (decrypted.isErr()) {
            expect(decrypted.error).toBe("DECRYPTION_FAILED");
        }
    });

    it("fails decryption if XChaCha20 header is tampered", async () => {
        const plain = new Uint8Array([10, 20, 30, 40]);
        const secret = await hashSecret("tamper-me");
        const argon = new KeyDerivationConfig_Argon2ID(2, 1);

        const encrypted = await EncryptDataBlob(
            plain,
            secret,
            VaultUtilTypes.EncryptionAlgorithm.XChaCha20Poly1305,
            VaultUtilTypes.KeyDerivationFunction.Argon2ID,
            argon,
            new KeyDerivationConfig_PBKDF2(),
        );

        encrypted.HeaderIV = Buffer.from("tampered-header").toString("base64");

        const decrypted = await DecryptDataBlob(
            encrypted,
            secret,
            VaultUtilTypes.EncryptionAlgorithm.XChaCha20Poly1305,
            VaultUtilTypes.KeyDerivationFunction.Argon2ID,
            argon,
        );

        expect(decrypted.isErr()).toBe(true);
        if (decrypted.isErr()) {
            expect(decrypted.error).toBe("DECRYPTION_FAILED");
        }
    });

    it("fails decryption with mismatched PBKDF2 iteration count", async () => {
        const plain = new TextEncoder().encode("iter-sensitive");
        const secret = await hashSecret("pw");

        const encrypted = await EncryptDataBlob(
            plain,
            secret,
            VaultUtilTypes.EncryptionAlgorithm.AES256,
            VaultUtilTypes.KeyDerivationFunction.PBKDF2,
            new KeyDerivationConfig_Argon2ID(),
            new KeyDerivationConfig_PBKDF2(1200),
        );

        const decrypted = await DecryptDataBlob(
            encrypted,
            secret,
            VaultUtilTypes.EncryptionAlgorithm.AES256,
            VaultUtilTypes.KeyDerivationFunction.PBKDF2,
            new KeyDerivationConfig_PBKDF2(1201),
        );

        expect(decrypted.isErr()).toBe(true);
        if (decrypted.isErr()) {
            expect(decrypted.error).toBe("DECRYPTION_FAILED");
        }
    });

    it("uses fresh AES salt and IV for identical plaintext and secret", async () => {
        const plain = new TextEncoder().encode("repeatable-input");
        const secret = await hashSecret("same-secret");

        const encryptedA = await EncryptDataBlob(
            plain,
            secret,
            VaultUtilTypes.EncryptionAlgorithm.AES256,
            VaultUtilTypes.KeyDerivationFunction.PBKDF2,
            new KeyDerivationConfig_Argon2ID(),
            new KeyDerivationConfig_PBKDF2(1000),
        );
        const encryptedB = await EncryptDataBlob(
            plain,
            secret,
            VaultUtilTypes.EncryptionAlgorithm.AES256,
            VaultUtilTypes.KeyDerivationFunction.PBKDF2,
            new KeyDerivationConfig_Argon2ID(),
            new KeyDerivationConfig_PBKDF2(1000),
        );

        expect(encryptedA.Salt).not.toBe(encryptedB.Salt);
        expect(encryptedA.HeaderIV).not.toBe(encryptedB.HeaderIV);
        expect(Array.from(encryptedA.Blob)).not.toEqual(
            Array.from(encryptedB.Blob),
        );
    });

    it("validates encrypted blob payload type before decryption", async () => {
        const blob = EncryptedBlob.CreateDefault();
        blob.Blob = "bad-type" as unknown as Uint8Array;

        const result = await DecryptDataBlob(
            blob,
            await hashSecret("pw"),
            VaultUtilTypes.EncryptionAlgorithm.XChaCha20Poly1305,
            VaultUtilTypes.KeyDerivationFunction.Argon2ID,
            new KeyDerivationConfig_Argon2ID(),
        );

        expect(result.isErr()).toBe(true);
        if (result.isErr()) {
            expect(result.error).toBe("VAULT_BLOB_INVALID_TYPE");
        }
    });

    it("returns error for invalid algorithm values in decryption", async () => {
        const blob = EncryptedBlob.CreateDefault();
        const result = await DecryptDataBlob(
            blob,
            await hashSecret("pw"),
            999 as VaultUtilTypes.EncryptionAlgorithm,
            VaultUtilTypes.KeyDerivationFunction.Argon2ID,
            new KeyDerivationConfig_Argon2ID(),
        );

        expect(result.isErr()).toBe(true);
        if (result.isErr()) {
            expect(result.error).toBe("ENCRYPTION_ALGORITHM_INVALID");
        }
    });

    it("hashSecret is deterministic and sha256-sized", async () => {
        const hashA = await hashSecret("same-secret");
        const hashB = await hashSecret("same-secret");
        const hashC = await hashSecret("different-secret");

        expect(hashA).toHaveLength(32);
        expect(Array.from(hashA)).toEqual(Array.from(hashB));
        expect(Array.from(hashA)).not.toEqual(Array.from(hashC));
    });

    it("encrypts and decrypts AES256 with Argon2ID", async () => {
        const plain = new TextEncoder().encode("aes-argon");
        const secret = await hashSecret("aes-argon-secret");
        const argon = new KeyDerivationConfig_Argon2ID(2, 1);

        const encrypted = await EncryptDataBlob(
            plain,
            secret,
            VaultUtilTypes.EncryptionAlgorithm.AES256,
            VaultUtilTypes.KeyDerivationFunction.Argon2ID,
            argon,
            new KeyDerivationConfig_PBKDF2(),
        );

        expect(encrypted.Algorithm).toBe(
            VaultUtilTypes.EncryptionAlgorithm.AES256,
        );
        expect(encrypted.KeyDerivationFunc).toBe(
            VaultUtilTypes.KeyDerivationFunction.Argon2ID,
        );

        const decrypted = await DecryptDataBlob(
            encrypted,
            secret,
            VaultUtilTypes.EncryptionAlgorithm.AES256,
            VaultUtilTypes.KeyDerivationFunction.Argon2ID,
            argon,
        );

        expect(decrypted.isOk()).toBe(true);
        if (decrypted.isOk()) {
            expect(new TextDecoder().decode(decrypted.value)).toBe("aes-argon");
        }
    });

    it("encrypts and decrypts XChaCha20Poly1305 with PBKDF2", async () => {
        const plain = new TextEncoder().encode("xchacha-pbkdf2");
        const secret = await hashSecret("xchacha-pbkdf2-secret");
        const pbkdf = new KeyDerivationConfig_PBKDF2(1000);

        const encrypted = await EncryptDataBlob(
            plain,
            secret,
            VaultUtilTypes.EncryptionAlgorithm.XChaCha20Poly1305,
            VaultUtilTypes.KeyDerivationFunction.PBKDF2,
            new KeyDerivationConfig_Argon2ID(),
            pbkdf,
        );

        expect(encrypted.Algorithm).toBe(
            VaultUtilTypes.EncryptionAlgorithm.XChaCha20Poly1305,
        );
        expect(encrypted.KeyDerivationFunc).toBe(
            VaultUtilTypes.KeyDerivationFunction.PBKDF2,
        );

        const decrypted = await DecryptDataBlob(
            encrypted,
            secret,
            VaultUtilTypes.EncryptionAlgorithm.XChaCha20Poly1305,
            VaultUtilTypes.KeyDerivationFunction.PBKDF2,
            pbkdf,
        );

        expect(decrypted.isOk()).toBe(true);
        if (decrypted.isOk()) {
            expect(new TextDecoder().decode(decrypted.value)).toBe(
                "xchacha-pbkdf2",
            );
        }
    });

    it("AES encrypt throws when KDF config is undefined", async () => {
        await expect(
            EncryptDataBlob(
                new Uint8Array([1, 2, 3]),
                await hashSecret("pw"),
                VaultUtilTypes.EncryptionAlgorithm.AES256,
                VaultUtilTypes.KeyDerivationFunction.PBKDF2,
                new KeyDerivationConfig_Argon2ID(),
                undefined as unknown as KeyDerivationConfig_PBKDF2,
            ),
        ).rejects.toThrow("Key derivation function config is undefined");
    });

    it("AES encrypt throws when KDF function is invalid", async () => {
        await expect(
            EncryptDataBlob(
                new Uint8Array([1, 2, 3]),
                await hashSecret("pw"),
                VaultUtilTypes.EncryptionAlgorithm.AES256,
                999 as VaultUtilTypes.KeyDerivationFunction,
                new KeyDerivationConfig_Argon2ID(),
                new KeyDerivationConfig_PBKDF2(1000),
            ),
        ).rejects.toThrow("Invalid key derivation function");
    });

    it("AES decrypt returns KEY_DERIVATION_FN_INVALID for invalid kdf", async () => {
        const plain = new TextEncoder().encode("k");
        const secret = await hashSecret("pw");
        const encrypted = await EncryptDataBlob(
            plain,
            secret,
            VaultUtilTypes.EncryptionAlgorithm.AES256,
            VaultUtilTypes.KeyDerivationFunction.PBKDF2,
            new KeyDerivationConfig_Argon2ID(),
            new KeyDerivationConfig_PBKDF2(1000),
        );

        const decrypted = await DecryptDataBlob(
            encrypted,
            secret,
            VaultUtilTypes.EncryptionAlgorithm.AES256,
            999 as VaultUtilTypes.KeyDerivationFunction,
            new KeyDerivationConfig_PBKDF2(1000),
        );

        expect(decrypted.isErr()).toBe(true);
        if (decrypted.isErr()) {
            expect(decrypted.error).toBe("KEY_DERIVATION_FN_INVALID");
        }
    });

    it("AES decrypt returns KEY_DERIVATION_FN_CONFIG_UNDEFINED when config is undefined", async () => {
        const plain = new TextEncoder().encode("k");
        const secret = await hashSecret("pw");
        const encrypted = await EncryptDataBlob(
            plain,
            secret,
            VaultUtilTypes.EncryptionAlgorithm.AES256,
            VaultUtilTypes.KeyDerivationFunction.PBKDF2,
            new KeyDerivationConfig_Argon2ID(),
            new KeyDerivationConfig_PBKDF2(1000),
        );

        const decrypted = await DecryptDataBlob(
            encrypted,
            secret,
            VaultUtilTypes.EncryptionAlgorithm.AES256,
            VaultUtilTypes.KeyDerivationFunction.PBKDF2,
            undefined as unknown as KeyDerivationConfig_PBKDF2,
        );

        expect(decrypted.isErr()).toBe(true);
        if (decrypted.isErr()) {
            expect(decrypted.error).toBe("KEY_DERIVATION_FN_CONFIG_UNDEFINED");
        }
    });

    it("XChaCha20 encrypt throws when KDF config is undefined", async () => {
        await expect(
            EncryptDataBlob(
                new Uint8Array([1, 2, 3]),
                await hashSecret("pw"),
                VaultUtilTypes.EncryptionAlgorithm.XChaCha20Poly1305,
                VaultUtilTypes.KeyDerivationFunction.Argon2ID,
                undefined as unknown as KeyDerivationConfig_Argon2ID,
                new KeyDerivationConfig_PBKDF2(1000),
            ),
        ).rejects.toThrow("Key derivation function config is undefined");
    });

    it("XChaCha20 encrypt throws for invalid kdf function", async () => {
        await expect(
            EncryptDataBlob(
                new Uint8Array([1, 2, 3]),
                await hashSecret("pw"),
                VaultUtilTypes.EncryptionAlgorithm.XChaCha20Poly1305,
                999 as VaultUtilTypes.KeyDerivationFunction,
                new KeyDerivationConfig_Argon2ID(),
                new KeyDerivationConfig_PBKDF2(1000),
            ),
        ).rejects.toThrow("Invalid key derivation function");
    });

    it("XChaCha20 decrypt returns KEY_DERIVATION_FN_CONFIG_UNDEFINED", async () => {
        const plain = new Uint8Array([1, 2, 3]);
        const secret = await hashSecret("pw");
        const argon = new KeyDerivationConfig_Argon2ID(2, 1);

        const encrypted = await EncryptDataBlob(
            plain,
            secret,
            VaultUtilTypes.EncryptionAlgorithm.XChaCha20Poly1305,
            VaultUtilTypes.KeyDerivationFunction.Argon2ID,
            argon,
            new KeyDerivationConfig_PBKDF2(),
        );

        const decrypted = await DecryptDataBlob(
            encrypted,
            secret,
            VaultUtilTypes.EncryptionAlgorithm.XChaCha20Poly1305,
            VaultUtilTypes.KeyDerivationFunction.Argon2ID,
            undefined as unknown as KeyDerivationConfig_Argon2ID,
        );

        expect(decrypted.isErr()).toBe(true);
        if (decrypted.isErr()) {
            expect(decrypted.error).toBe("KEY_DERIVATION_FN_CONFIG_UNDEFINED");
        }
    });

    it("XChaCha20 decrypt returns KEY_DERIVATION_FN_INVALID for invalid kdf", async () => {
        const encrypted = EncryptedBlob.CreateDefault();
        encrypted.Algorithm =
            VaultUtilTypes.EncryptionAlgorithm.XChaCha20Poly1305;
        encrypted.KeyDerivationFunc =
            VaultUtilTypes.KeyDerivationFunction.Argon2ID;
        encrypted.Blob = new Uint8Array([1, 2, 3]);
        encrypted.Salt = Buffer.from(new Uint8Array(16)).toString("base64");
        encrypted.HeaderIV = Buffer.from(new Uint8Array(24)).toString("base64");

        const decrypted = await DecryptDataBlob(
            encrypted,
            await hashSecret("pw"),
            VaultUtilTypes.EncryptionAlgorithm.XChaCha20Poly1305,
            999 as VaultUtilTypes.KeyDerivationFunction,
            new KeyDerivationConfig_Argon2ID(),
        );

        expect(decrypted.isErr()).toBe(true);
        if (decrypted.isErr()) {
            expect(decrypted.error).toBe("KEY_DERIVATION_FN_INVALID");
        }
    });

    it("serializes and deserializes encrypted blobs from binary", async () => {
        const payload = new Uint8Array([9, 8, 7]);
        const encrypted = await EncryptDataBlob(
            payload,
            await hashSecret("pw"),
            VaultUtilTypes.EncryptionAlgorithm.XChaCha20Poly1305,
            VaultUtilTypes.KeyDerivationFunction.Argon2ID,
            new KeyDerivationConfig_Argon2ID(),
            new KeyDerivationConfig_PBKDF2(),
        );
        encrypted.Envelope = {
            Version: 3,
            DEKAlgo: "AES-GCM-256",
            Slots: [],
            PrimaryProtectionKind:
                VaultUtilTypes.AdditionalKeyProtectionKind.NONE,
            VaultID: "vault-1",
        };

        const binary = VaultUtilTypes.EncryptedBlob.encode(encrypted).finish();
        const deserialized = EncryptedBlob.fromBinary(binary);

        expect(deserialized.Salt).toBe(encrypted.Salt);
        expect(deserialized.HeaderIV).toBe(encrypted.HeaderIV);
        expect(Array.from(deserialized.Blob)).toEqual(
            Array.from(encrypted.Blob),
        );
        expect(deserialized.Envelope?.VaultID).toBe("vault-1");
    });

    it("preserves legacy Version and CurrentVersion when deserializing from binary", async () => {
        const payload = new Uint8Array([1, 2, 3]);
        const encrypted = await EncryptDataBlob(
            payload,
            await hashSecret("pw"),
            VaultUtilTypes.EncryptionAlgorithm.XChaCha20Poly1305,
            VaultUtilTypes.KeyDerivationFunction.Argon2ID,
            new KeyDerivationConfig_Argon2ID(),
            new KeyDerivationConfig_PBKDF2(),
        );
        encrypted.Version = 2;
        encrypted.CurrentVersion = 2;

        const binary = VaultUtilTypes.EncryptedBlob.encode(encrypted).finish();
        const deserialized = EncryptedBlob.fromBinary(binary);

        expect(deserialized.Version).toBe(2);
        expect(deserialized.CurrentVersion).toBe(2);
        expect(deserialized.Envelope).toBeUndefined();
    });
});
