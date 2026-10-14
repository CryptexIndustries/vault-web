import { beforeAll, describe, expect, it } from "@jest/globals";

import { AdditionalKeyProtectionKind } from "@cryptex-industries/vault-core/proto";
import {
    configureVaultCoreRuntime,
    createWebCryptoEnvelopeCrypto,
} from "@cryptex-industries/vault-core/runtime";
import {
    isPrimarySlot,
    KeyDerivationConfig_Argon2ID,
} from "@cryptex-industries/vault-core/vault-utils/encryption";
import { openEnvelopeBlob } from "@cryptex-industries/vault-core/vault-utils/vault-envelope-ops";
import { deriveProtectionPhraseKey } from "@cryptex-industries/vault-core/vault-utils/additional-key-protection";

import { createLinkedVaultEnvelope } from "@/utils/linked-vault-envelope";

const silentLog = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
};

beforeAll(() => {
    configureVaultCoreRuntime({
        envelopeCrypto: createWebCryptoEnvelopeCrypto(),
        env: {
            NEXT_PUBLIC_PUSHER_APP_KEY: "",
            NEXT_PUBLIC_PUSHER_APP_HOST: "",
            NEXT_PUBLIC_PUSHER_APP_PORT: "",
            NEXT_PUBLIC_PUSHER_APP_TLS: false,
        },
        onlineServicesSessionPort: {} as never,
        onlineServicesApi: {} as never,
        syncLog: silentLog,
        signalingLog: silentLog,
        webrtcLog: silentLog,
        additionalKeyProtectionStore: {
            setDeviceAdditionalKeyProtectionKey: async () => {},
            getDeviceAdditionalKeyProtectionKey: async () => null,
        },
    });
});

describe("linked vault envelope recovery", () => {
    it("opens with its returned recovery code and generated protection phrase", async () => {
        const plaintext = new TextEncoder().encode("linked vault payload");
        const vaultId = "01JLINKEDVAULTTEST000000000";
        const kdfConfig = new KeyDerivationConfig_Argon2ID(19, 2);
        const created = await createLinkedVaultEnvelope(plaintext, {
            vaultId,
            masterPassword: "correct horse battery staple",
            kdfConfig,
            additionalKeyProtection: {
                kind: AdditionalKeyProtectionKind.PROTECTION_PHRASE_128,
            },
        });

        expect(created.recoveryCode).not.toBe("");
        expect(created.protectionPhrase).not.toBeUndefined();
        expect(created.blob.KDFConfigArgon2ID).toEqual({
            memLimit: 19,
            opsLimit: 2,
        });

        const recovered = await openEnvelopeBlob(created.blob, vaultId, {
            masterPassword: "",
            useRecovery: true,
            recoveryCode: created.recoveryCode,
        });
        expect(recovered.isOk()).toBe(true);
        if (recovered.isOk()) {
            expect(recovered.value.plaintext).toEqual(plaintext);
        }

        const primarySlot = created.blob.Envelope?.Slots.find(isPrimarySlot);
        expect(primarySlot?.ProtectionPhraseSalt).toBeTruthy();
        const factorKey = await deriveProtectionPhraseKey(
            created.protectionPhrase!,
            primarySlot!.ProtectionPhraseSalt,
            new KeyDerivationConfig_Argon2ID(
                created.blob.KDFConfigArgon2ID!.memLimit,
                created.blob.KDFConfigArgon2ID!.opsLimit,
            ),
        );
        const opened = await openEnvelopeBlob(created.blob, vaultId, {
            masterPassword: "correct horse battery staple",
            additionalKeyProtectionHkdfBase: factorKey,
        });
        expect(opened.isOk()).toBe(true);
        if (opened.isOk()) {
            expect(opened.value.plaintext).toEqual(plaintext);
        }

        const wrongPassword = await openEnvelopeBlob(created.blob, vaultId, {
            masterPassword: "wrong password",
            additionalKeyProtectionHkdfBase: factorKey,
        });
        expect(wrongPassword.isErr()).toBe(true);

        const wrongFactorKey = await deriveProtectionPhraseKey(
            "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
            primarySlot!.ProtectionPhraseSalt,
            kdfConfig,
        );
        const wrongFactor = await openEnvelopeBlob(created.blob, vaultId, {
            masterPassword: "correct horse battery staple",
            additionalKeyProtectionHkdfBase: wrongFactorKey,
        });
        expect(wrongFactor.isErr()).toBe(true);
    });
});
