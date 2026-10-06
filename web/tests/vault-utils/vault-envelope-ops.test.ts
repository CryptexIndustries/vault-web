/**
 * @jest-environment node
 */
import { beforeAll, describe, expect, it, jest } from "@jest/globals";
import { webcrypto } from "crypto";
import { TextDecoder, TextEncoder } from "util";

Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    writable: true,
});
Object.defineProperty(globalThis, "TextEncoder", {
    value: TextEncoder,
    writable: true,
});
Object.defineProperty(globalThis, "TextDecoder", {
    value: TextDecoder,
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
import { KeyDerivationConfig_Argon2ID } from "@cryptex-industries/vault-core/vault-utils/encryption";
import {
    decryptWithDEK,
    deriveAdditionalKeyProtectionKeyMaterial,
    generateRandomSalt,
    importHkdfBaseKey,
    openRecoverySlot,
} from "@cryptex-industries/vault-core/vault-utils/envelope-encryption";
import {
    createEnvelopeEncryptedBlob,
    migrateLegacyBlobToEnvelope,
    openEnvelopeBlob,
    reconfigureAdditionalKeyProtection,
    reencryptVaultBytesWithDEK,
    rotateRecoveryCode,
    rotateVaultDataKey,
} from "@cryptex-industries/vault-core/vault-utils/vault-envelope-ops";
import type { AdditionalKeyProtectionEnrollmentResult } from "@cryptex-industries/vault-core/vault-utils/additional-key-protection";
import type { VaultHkdfKey } from "@cryptex-industries/vault-core/envelope-crypto";
import { EncryptedBlob } from "@cryptex-industries/vault-core/vault-utils/encryption";
import { configureTestVaultCoreRuntime } from "../helpers/vault-core-runtime";

configureTestVaultCoreRuntime();

// Small Argon2 cost keeps the crypto deterministic but fast in CI.
const kdf = new KeyDerivationConfig_Argon2ID(8, 1);
const VAULT_ID = "vault-1";
const PLAINTEXT = new TextEncoder().encode("top secret vault bytes");

const noAdditionalProtection: AdditionalKeyProtectionEnrollmentResult = {
    kind: VaultUtilTypes.AdditionalKeyProtectionKind.NONE,
    hkdfBaseKey: null,
};

async function makeProtectionPhrase(
    protectionPhrase = "correct horse battery staple",
): Promise<AdditionalKeyProtectionEnrollmentResult> {
    const secretBytes = new TextEncoder().encode(protectionPhrase);
    const salt = generateRandomSalt();
    const derived = await deriveAdditionalKeyProtectionKeyMaterial(
        secretBytes,
        salt,
        kdf,
    );
    const hkdfBaseKey = await importHkdfBaseKey(derived);
    return {
        kind: VaultUtilTypes.AdditionalKeyProtectionKind.PROTECTION_PHRASE_128,
        hkdfBaseKey,
        protectionPhrase,
        protectionPhraseSalt: Buffer.from(salt).toString("base64"),
    };
}

async function deriveProtectionFromDisplayedPhrase(
    protectionPhrase: string,
    saltB64: string,
): Promise<VaultHkdfKey> {
    const derived = await deriveAdditionalKeyProtectionKeyMaterial(
        new TextEncoder().encode(protectionPhrase),
        new Uint8Array(Buffer.from(saltB64, "base64")),
        kdf,
    );
    return importHkdfBaseKey(derived);
}

async function decryptedText(
    blob: Awaited<ReturnType<typeof createEnvelopeEncryptedBlob>>["blob"],
    options: Parameters<typeof openEnvelopeBlob>[2],
): Promise<string | null> {
    const res = await openEnvelopeBlob(blob, VAULT_ID, options);
    if (res.isErr()) return null;
    return new TextDecoder().decode(res.value.plaintext);
}

describe("vault-envelope-ops re-keying", () => {
    beforeAll(async () => {
        await sodium.ready;
    });

    describe("reconfigureAdditionalKeyProtection", () => {
        it("changes the master password without re-encrypting the vault", async () => {
            const created = await createEnvelopeEncryptedBlob(
                PLAINTEXT,
                "old-password",
                VAULT_ID,
                noAdditionalProtection,
                kdf,
            );
            const originalCiphertext = created.blob.Blob;

            const res = await reconfigureAdditionalKeyProtection(
                created.blob,
                VAULT_ID,
                {
                    masterPassword: "old-password",
                    additionalKeyProtectionHkdfBase: null,
                },
                {
                    masterPassword: "new-password",
                    additionalKeyProtection: noAdditionalProtection,
                },
                kdf,
            );
            expect(res.isOk()).toBe(true);
            if (res.isErr()) return;
            const blob = res.value;

            // DEK unchanged: ciphertext bytes are untouched.
            expect(blob.Blob).toEqual(originalCiphertext);
            expect(blob.Blob).not.toBe(originalCiphertext);

            expect(
                await decryptedText(blob, { masterPassword: "new-password" }),
            ).toBe("top secret vault bytes");
            expect(
                await decryptedText(blob, { masterPassword: "old-password" }),
            ).toBeNull();
        });

        it("keeps the recovery code working after a password change", async () => {
            const created = await createEnvelopeEncryptedBlob(
                PLAINTEXT,
                "old-password",
                VAULT_ID,
                noAdditionalProtection,
                kdf,
            );

            const res = await reconfigureAdditionalKeyProtection(
                created.blob,
                VAULT_ID,
                {
                    masterPassword: "old-password",
                    additionalKeyProtectionHkdfBase: null,
                },
                {
                    masterPassword: "new-password",
                    additionalKeyProtection: noAdditionalProtection,
                },
                kdf,
            );
            expect(res.isOk()).toBe(true);
            if (res.isErr()) return;

            expect(
                await decryptedText(res.value, {
                    masterPassword: "",
                    useRecovery: true,
                    recoveryCode: created.recoveryCode,
                }),
            ).toBe("top secret vault bytes");
        });

        it("adds additional key protection and requires it on unlock", async () => {
            const created = await createEnvelopeEncryptedBlob(
                PLAINTEXT,
                "master",
                VAULT_ID,
                noAdditionalProtection,
                kdf,
            );

            const protection = await makeProtectionPhrase();
            const res = await reconfigureAdditionalKeyProtection(
                created.blob,
                VAULT_ID,
                {
                    masterPassword: "master",
                    additionalKeyProtectionHkdfBase: null,
                },
                {
                    masterPassword: "master",
                    additionalKeyProtection: protection,
                },
                kdf,
            );
            expect(res.isOk()).toBe(true);
            if (res.isErr()) return;
            const blob = res.value;

            expect(blob.Envelope?.PrimaryProtectionKind).toBe(
                VaultUtilTypes.AdditionalKeyProtectionKind
                    .PROTECTION_PHRASE_128,
            );

            // Password alone no longer unlocks.
            expect(
                await decryptedText(blob, { masterPassword: "master" }),
            ).toBeNull();
            // Password + the enrolled protection unlocks.
            expect(
                await decryptedText(blob, {
                    masterPassword: "master",
                    additionalKeyProtectionHkdfBase: protection.hkdfBaseKey,
                }),
            ).toBe("top secret vault bytes");
        });

        it("stores the protection-phrase salt and survives restore with a different local id", async () => {
            const protection = await makeProtectionPhrase(
                "restore protection phrase",
            );
            const created = await createEnvelopeEncryptedBlob(
                PLAINTEXT,
                "master",
                VAULT_ID,
                protection,
                kdf,
            );
            const primarySlot = created.blob.Envelope?.Slots.find(
                (slot) => slot.Kind === VaultUtilTypes.KeySlotKind.PRIMARY,
            );
            expect(created.blob.Envelope?.VaultID).toBe(VAULT_ID);
            expect(primarySlot?.ProtectionPhraseSalt).toBe(
                protection.protectionPhraseSalt,
            );

            const restoredProtection =
                await deriveProtectionFromDisplayedPhrase(
                    protection.protectionPhrase!,
                    primarySlot!.ProtectionPhraseSalt,
                );
            const restored = await openEnvelopeBlob(
                created.blob,
                "different-restored-local-id",
                {
                    masterPassword: "master",
                    additionalKeyProtectionHkdfBase: restoredProtection,
                },
            );

            expect(restored.isOk()).toBe(true);
            if (restored.isErr()) return;
            expect(new TextDecoder().decode(restored.value.plaintext)).toBe(
                "top secret vault bytes",
            );
        });

        it("removes additional key protection", async () => {
            const protection = await makeProtectionPhrase();
            const created = await createEnvelopeEncryptedBlob(
                PLAINTEXT,
                "master",
                VAULT_ID,
                protection,
                kdf,
            );

            const res = await reconfigureAdditionalKeyProtection(
                created.blob,
                VAULT_ID,
                {
                    masterPassword: "master",
                    additionalKeyProtectionHkdfBase: protection.hkdfBaseKey,
                },
                {
                    masterPassword: "master",
                    additionalKeyProtection: noAdditionalProtection,
                },
                kdf,
            );
            expect(res.isOk()).toBe(true);
            if (res.isErr()) return;
            const blob = res.value;

            expect(blob.Envelope?.PrimaryProtectionKind).toBe(
                VaultUtilTypes.AdditionalKeyProtectionKind.NONE,
            );
            expect(
                await decryptedText(blob, { masterPassword: "master" }),
            ).toBe("top secret vault bytes");
        });

        it("fails when the current password is wrong", async () => {
            const created = await createEnvelopeEncryptedBlob(
                PLAINTEXT,
                "correct",
                VAULT_ID,
                noAdditionalProtection,
                kdf,
            );

            const res = await reconfigureAdditionalKeyProtection(
                created.blob,
                VAULT_ID,
                {
                    masterPassword: "wrong",
                    additionalKeyProtectionHkdfBase: null,
                },
                {
                    masterPassword: "new",
                    additionalKeyProtection: noAdditionalProtection,
                },
                kdf,
            );
            expect(res.isErr()).toBe(true);
            if (res.isErr()) {
                expect(res.error).toBe("DEK_UNWRAP_FAILED");
            }
        });
    });

    describe("rotateRecoveryCode", () => {
        it("invalidates the old code and issues a working new one", async () => {
            const created = await createEnvelopeEncryptedBlob(
                PLAINTEXT,
                "master",
                VAULT_ID,
                noAdditionalProtection,
                kdf,
            );
            const originalCiphertext = created.blob.Blob;

            const res = await rotateRecoveryCode(
                created.blob,
                VAULT_ID,
                {
                    masterPassword: "master",
                    additionalKeyProtectionHkdfBase: null,
                },
                kdf,
            );
            expect(res.isOk()).toBe(true);
            if (res.isErr()) return;

            const { blob, recoveryCode } = res.value;
            expect(recoveryCode).not.toBe(created.recoveryCode);
            expect(blob.Blob).toEqual(originalCiphertext);
            expect(blob.Blob).not.toBe(originalCiphertext);

            // New code unlocks.
            expect(
                await decryptedText(blob, {
                    masterPassword: "",
                    useRecovery: true,
                    recoveryCode,
                }),
            ).toBe("top secret vault bytes");
            // Old code no longer unlocks.
            expect(
                await decryptedText(blob, {
                    masterPassword: "",
                    useRecovery: true,
                    recoveryCode: created.recoveryCode,
                }),
            ).toBeNull();
            // Master password still unlocks.
            expect(
                await decryptedText(blob, { masterPassword: "master" }),
            ).toBe("top secret vault bytes");
        });

        it("rotates using the current recovery code as authorization", async () => {
            const created = await createEnvelopeEncryptedBlob(
                PLAINTEXT,
                "master",
                VAULT_ID,
                noAdditionalProtection,
                kdf,
            );

            const res = await rotateRecoveryCode(
                created.blob,
                VAULT_ID,
                {
                    masterPassword: "",
                    additionalKeyProtectionHkdfBase: null,
                    useRecovery: true,
                    recoveryCode: created.recoveryCode,
                },
                kdf,
            );
            expect(res.isOk()).toBe(true);
            if (res.isErr()) return;

            expect(
                await decryptedText(res.value.blob, {
                    masterPassword: "",
                    useRecovery: true,
                    recoveryCode: res.value.recoveryCode,
                }),
            ).toBe("top secret vault bytes");
        });
    });

    describe("rotateVaultDataKey", () => {
        it("re-encrypts with a new DEK and replaces both key slots", async () => {
            const created = await createEnvelopeEncryptedBlob(
                PLAINTEXT,
                "old-password",
                VAULT_ID,
                noAdditionalProtection,
                kdf,
            );
            const originalCiphertext = new Uint8Array(created.blob.Blob);
            const originalIv = created.blob.HeaderIV;
            const oldDek = await openRecoverySlot(
                created.blob.Envelope!,
                created.recoveryCode,
                true,
            );
            expect(oldDek.isOk()).toBe(true);
            if (oldDek.isErr()) return;

            const res = await rotateVaultDataKey(
                created.blob,
                VAULT_ID,
                {
                    masterPassword: "old-password",
                    additionalKeyProtectionHkdfBase: null,
                },
                {
                    masterPassword: "new-password",
                    additionalKeyProtection: noAdditionalProtection,
                },
                kdf,
            );
            expect(res.isOk()).toBe(true);
            if (res.isErr()) return;

            const oldRaw = new Uint8Array(
                await crypto.subtle.exportKey("raw", oldDek.value),
            );
            const candidateDek = await openRecoverySlot(
                res.value.blob.Envelope!,
                res.value.recoveryCode,
                true,
            );
            expect(candidateDek.isOk()).toBe(true);
            if (candidateDek.isErr()) return;
            const newRaw = new Uint8Array(
                await crypto.subtle.exportKey("raw", candidateDek.value),
            );
            expect(newRaw).not.toEqual(oldRaw);
            expect(res.value.dek.extractable).toBe(false);
            const sessionPlaintext = await decryptWithDEK(
                res.value.dek,
                res.value.blob.Blob,
                res.value.blob.HeaderIV,
            );
            expect(sessionPlaintext.isOk()).toBe(true);
            if (sessionPlaintext.isOk()) {
                expect(new TextDecoder().decode(sessionPlaintext.value)).toBe(
                    "top secret vault bytes",
                );
            }
            expect(res.value.blob.Blob).not.toEqual(originalCiphertext);
            expect(res.value.blob.HeaderIV).not.toBe(originalIv);
            expect(res.value.recoveryCode).not.toBe(created.recoveryCode);

            expect(
                await decryptedText(res.value.blob, {
                    masterPassword: "new-password",
                }),
            ).toBe("top secret vault bytes");
            expect(
                await decryptedText(res.value.blob, {
                    masterPassword: "old-password",
                }),
            ).toBeNull();
            expect(
                await decryptedText(res.value.blob, {
                    masterPassword: "",
                    useRecovery: true,
                    recoveryCode: res.value.recoveryCode,
                }),
            ).toBe("top secret vault bytes");
            expect(
                await decryptedText(res.value.blob, {
                    masterPassword: "",
                    useRecovery: true,
                    recoveryCode: created.recoveryCode,
                }),
            ).toBeNull();

            // Candidate generation never mutates the active blob.
            expect(created.blob.Blob).toEqual(originalCiphertext);
            expect(created.blob.HeaderIV).toBe(originalIv);
            expect(
                await decryptedText(created.blob, {
                    masterPassword: "old-password",
                }),
            ).toBe("top secret vault bytes");
        });

        it("rejects incorrect current credentials without changing the blob", async () => {
            const created = await createEnvelopeEncryptedBlob(
                PLAINTEXT,
                "master",
                VAULT_ID,
                noAdditionalProtection,
                kdf,
            );
            const original = VaultUtilTypes.EncryptedBlob.encode(
                created.blob,
            ).finish();

            const res = await rotateVaultDataKey(
                created.blob,
                VAULT_ID,
                {
                    masterPassword: "wrong",
                    additionalKeyProtectionHkdfBase: null,
                },
                {
                    masterPassword: "next",
                    additionalKeyProtection: noAdditionalProtection,
                },
                kdf,
            );

            expect(res.isErr()).toBe(true);
            expect(res.isErr() && res.error).toBe("DEK_UNWRAP_FAILED");
            expect(
                VaultUtilTypes.EncryptedBlob.encode(created.blob).finish(),
            ).toEqual(original);
        });
    });

    describe("envelope operation edge cases", () => {
        it("rejects non-envelope and malformed envelope blobs", async () => {
            const plainBlob = EncryptedBlob.CreateDefault();
            await expect(
                openEnvelopeBlob(plainBlob, VAULT_ID, {
                    masterPassword: "master",
                }),
            ).resolves.toMatchObject({ error: "NOT_ENVELOPE_BLOB" });

            const created = await createEnvelopeEncryptedBlob(
                PLAINTEXT,
                "master",
                VAULT_ID,
                noAdditionalProtection,
                kdf,
            );
            created.blob.Envelope!.Version = 2;
            await expect(
                openEnvelopeBlob(created.blob, VAULT_ID, {
                    masterPassword: "master",
                }),
            ).resolves.toMatchObject({ error: "NOT_ENVELOPE_BLOB" });
        });

        it("surfaces missing primary slot and vault id while opening", async () => {
            const created = await createEnvelopeEncryptedBlob(
                PLAINTEXT,
                "master",
                VAULT_ID,
                noAdditionalProtection,
                kdf,
            );
            created.blob.Envelope!.Slots = created.blob.Envelope!.Slots.filter(
                (slot) => slot.Kind !== VaultUtilTypes.KeySlotKind.PRIMARY,
            );
            await expect(
                openEnvelopeBlob(created.blob, VAULT_ID, {
                    masterPassword: "master",
                }),
            ).resolves.toMatchObject({ error: "PRIMARY_SLOT_MISSING" });

            const missingId = await createEnvelopeEncryptedBlob(
                PLAINTEXT,
                "master",
                VAULT_ID,
                noAdditionalProtection,
                kdf,
            );
            missingId.blob.Envelope!.VaultID = "";
            await expect(
                openEnvelopeBlob(missingId.blob, undefined, {
                    masterPassword: "master",
                }),
            ).resolves.toMatchObject({ error: "VAULT_ID_MISSING" });
        });

        it("surfaces recovery slot errors", async () => {
            const created = await createEnvelopeEncryptedBlob(
                PLAINTEXT,
                "master",
                VAULT_ID,
                noAdditionalProtection,
                kdf,
            );
            created.blob.Envelope!.Slots = created.blob.Envelope!.Slots.filter(
                (slot) => slot.Kind !== VaultUtilTypes.KeySlotKind.RECOVERY,
            );

            await expect(
                openEnvelopeBlob(created.blob, VAULT_ID, {
                    masterPassword: "",
                    useRecovery: true,
                    recoveryCode: "missing",
                }),
            ).resolves.toMatchObject({ error: "RECOVERY_SLOT_MISSING" });
        });

        it("returns decryption errors after a successful unwrap", async () => {
            const created = await createEnvelopeEncryptedBlob(
                PLAINTEXT,
                "master",
                VAULT_ID,
                noAdditionalProtection,
                kdf,
            );
            created.blob.Blob = new Uint8Array([1, 2, 3]);

            await expect(
                openEnvelopeBlob(created.blob, VAULT_ID, {
                    masterPassword: "master",
                }),
            ).resolves.toMatchObject({ error: "DECRYPTION_FAILED" });
        });

        it("re-encrypts plaintext with an existing DEK and envelope", async () => {
            const created = await createEnvelopeEncryptedBlob(
                PLAINTEXT,
                "master",
                VAULT_ID,
                noAdditionalProtection,
                kdf,
            );
            const opened = await openEnvelopeBlob(created.blob, VAULT_ID, {
                masterPassword: "master",
            });
            expect(opened.isOk()).toBe(true);
            if (opened.isErr()) return;

            const updated = await reencryptVaultBytesWithDEK(
                new TextEncoder().encode("updated vault bytes"),
                opened.value.dek,
                created.blob,
                created.blob.Envelope!,
                kdf,
            );
            expect(updated.Version).toBe(3);
            expect(updated.CurrentVersion).toBe(3);

            const reopened = await openEnvelopeBlob(updated, VAULT_ID, {
                masterPassword: "master",
            });
            expect(reopened.isOk()).toBe(true);
            if (reopened.isErr()) return;
            expect(new TextDecoder().decode(reopened.value.plaintext)).toBe(
                "updated vault bytes",
            );
        });

        it("rejects malformed blobs while reconfiguring and rotating", async () => {
            await expect(
                reconfigureAdditionalKeyProtection(
                    EncryptedBlob.CreateDefault(),
                    VAULT_ID,
                    {
                        masterPassword: "master",
                        additionalKeyProtectionHkdfBase: null,
                    },
                    {
                        masterPassword: "next",
                        additionalKeyProtection: noAdditionalProtection,
                    },
                    kdf,
                ),
            ).resolves.toMatchObject({ error: "NOT_ENVELOPE_BLOB" });
            await expect(
                rotateRecoveryCode(
                    EncryptedBlob.CreateDefault(),
                    VAULT_ID,
                    {
                        masterPassword: "master",
                        additionalKeyProtectionHkdfBase: null,
                    },
                    kdf,
                ),
            ).resolves.toMatchObject({ error: "NOT_ENVELOPE_BLOB" });

            const missingPrimary = await createEnvelopeEncryptedBlob(
                PLAINTEXT,
                "master",
                VAULT_ID,
                noAdditionalProtection,
                kdf,
            );
            missingPrimary.blob.Envelope!.Slots =
                missingPrimary.blob.Envelope!.Slots.filter(
                    (slot) => slot.Kind !== VaultUtilTypes.KeySlotKind.PRIMARY,
                );
            await expect(
                reconfigureAdditionalKeyProtection(
                    missingPrimary.blob,
                    VAULT_ID,
                    {
                        masterPassword: "master",
                        additionalKeyProtectionHkdfBase: null,
                    },
                    {
                        masterPassword: "next",
                        additionalKeyProtection: noAdditionalProtection,
                    },
                    kdf,
                ),
            ).resolves.toMatchObject({ error: "PRIMARY_SLOT_MISSING" });

            const missingVaultId = await createEnvelopeEncryptedBlob(
                PLAINTEXT,
                "master",
                VAULT_ID,
                noAdditionalProtection,
                kdf,
            );
            missingVaultId.blob.Envelope!.VaultID = "";
            await expect(
                reconfigureAdditionalKeyProtection(
                    missingVaultId.blob,
                    "",
                    {
                        masterPassword: "master",
                        additionalKeyProtectionHkdfBase: null,
                    },
                    {
                        masterPassword: "next",
                        additionalKeyProtection: noAdditionalProtection,
                    },
                    kdf,
                ),
            ).resolves.toMatchObject({ error: "VAULT_ID_MISSING" });
        });

        it("propagates DEK unwrap errors while rotating recovery code", async () => {
            const created = await createEnvelopeEncryptedBlob(
                PLAINTEXT,
                "master",
                VAULT_ID,
                noAdditionalProtection,
                kdf,
            );

            await expect(
                rotateRecoveryCode(
                    created.blob,
                    VAULT_ID,
                    {
                        masterPassword: "wrong",
                        additionalKeyProtectionHkdfBase: null,
                    },
                    kdf,
                ),
            ).resolves.toMatchObject({ error: "DEK_UNWRAP_FAILED" });
        });

        it("adds a recovery slot if rotation starts without one", async () => {
            const created = await createEnvelopeEncryptedBlob(
                PLAINTEXT,
                "master",
                VAULT_ID,
                noAdditionalProtection,
                kdf,
            );
            created.blob.Envelope!.Slots = created.blob.Envelope!.Slots.filter(
                (slot) => slot.Kind !== VaultUtilTypes.KeySlotKind.RECOVERY,
            );
            const res = await rotateRecoveryCode(
                created.blob,
                VAULT_ID,
                {
                    masterPassword: "master",
                    additionalKeyProtectionHkdfBase: null,
                },
                kdf,
            );

            expect(res.isOk()).toBe(true);
            if (res.isErr()) return;
            expect(
                res.value.blob.Envelope?.Slots.some(
                    (slot) => slot.Kind === VaultUtilTypes.KeySlotKind.RECOVERY,
                ),
            ).toBe(true);
        });

        it("migrates legacy bytes through envelope creation", async () => {
            const migrated = await migrateLegacyBlobToEnvelope(
                PLAINTEXT,
                "master",
                VAULT_ID,
                noAdditionalProtection,
            );

            expect(migrated.blob.Envelope?.Version).toBe(3);
            expect(migrated.recoveryCode).toBeTruthy();
        });

        it("creates WebAuthn primary slots only when metadata is complete", async () => {
            const key = await importHkdfBaseKey(
                crypto.getRandomValues(new Uint8Array(32)),
            );
            const missingMeta: AdditionalKeyProtectionEnrollmentResult = {
                kind: VaultUtilTypes.AdditionalKeyProtectionKind.WEBAUTHN_PRF,
                hkdfBaseKey: key,
                webauthnCredentialId: "credential",
            };
            const completeMeta: AdditionalKeyProtectionEnrollmentResult = {
                kind: VaultUtilTypes.AdditionalKeyProtectionKind.WEBAUTHN_PRF,
                hkdfBaseKey: key,
                webauthnCredentialId: "credential",
                webauthnPrfSalt: "salt",
            };

            const missing = await createEnvelopeEncryptedBlob(
                PLAINTEXT,
                "master",
                VAULT_ID,
                missingMeta,
                kdf,
            );
            const complete = await createEnvelopeEncryptedBlob(
                PLAINTEXT,
                "master",
                VAULT_ID,
                completeMeta,
                kdf,
            );

            const missingSlot = missing.blob.Envelope?.Slots.find(
                (slot) => slot.Kind === VaultUtilTypes.KeySlotKind.PRIMARY,
            );
            const completeSlot = complete.blob.Envelope?.Slots.find(
                (slot) => slot.Kind === VaultUtilTypes.KeySlotKind.PRIMARY,
            );
            expect(missingSlot?.WebauthnCredentialId).toBe("");
            expect(missingSlot?.WebauthnPrfSalt).toBe("");
            expect(completeSlot?.WebauthnCredentialId).toBe("credential");
            expect(completeSlot?.WebauthnPrfSalt).toBe("salt");
        });
    });
});
