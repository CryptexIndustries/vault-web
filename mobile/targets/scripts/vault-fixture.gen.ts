/**
 * Writes the AutoFill extension's decryption fixture with the app's own vault
 * storage and biometric enrollment code. Jest provides the storage mocks;
 * targets/scripts/generate.mjs runs this file on its own.
 */
import { beforeAll, expect, it, jest } from "@jest/globals";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import * as VaultProto from "@cryptex-industries/vault-core/proto";
import {
    configureVaultCoreRuntime,
    createWebCryptoEnvelopeCrypto,
} from "@cryptex-industries/vault-core/runtime";
import {
    type LinkedDevices,
    VaultCredential,
} from "@cryptex-industries/vault-core/vault-utils/vault";

const mockMmkv = new Map<string, string | number>();
const mockSecureStore = new Map<string, string>();

jest.mock("react-native-mmkv", () => ({
    MMKV: class {
        getString(key: string) {
            const value = mockMmkv.get(key);
            return typeof value === "string" ? value : undefined;
        }
        getNumber(key: string) {
            const value = mockMmkv.get(key);
            return typeof value === "number" ? value : undefined;
        }
        set(key: string, value: string | number) {
            mockMmkv.set(key, value);
        }
    },
}));
jest.mock("expo-secure-store", () => ({
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 6,
    getItemAsync: async (key: string) => mockSecureStore.get(key) ?? null,
    setItemAsync: async (key: string, value: string) => {
        mockSecureStore.set(key, value);
    },
}));
jest.mock("expo-local-authentication", () => ({
    hasHardwareAsync: async () => true,
    isEnrolledAsync: async () => true,
}));
// Real key generation adds nothing to the fixture.
jest.mock("@cryptex-industries/vault-core/vault-utils/sync-signing", () => ({
    ensureSyncSigningKeypair: async (linkedDevices: LinkedDevices) => {
        linkedDevices.SyncSigningPublicKey = "fixture-signing-public";
        linkedDevices.SyncSigningPrivateKey = "fixture-signing-private";
        return true;
    },
}));
jest.mock(
    "@cryptex-industries/vault-core/vault-utils/post-quantum-kem",
    () => ({
        ensureSyncKemKeypair: async (linkedDevices: LinkedDevices) => {
            linkedDevices.SyncKemPublicKey = "fixture-kem-public";
            linkedDevices.SyncKemPrivateKey = "fixture-kem-private";
            return true;
        },
    }),
);

import { VaultMetadata } from "@/app_lib/vault-utils/storage";
import { enableBiometricUnlock } from "@/lib/secure-dek";
import { isAutofillCandidate } from "@/utils/android-autofill";

const silentLog = { debug() {}, info() {}, warn() {}, error() {} };

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

const credential = (fields: Partial<VaultCredential>) =>
    Object.assign(new VaultCredential(), fields);

it("writes targets/AutofillCoreTests/Fixtures/vault.json", async () => {
    const password = "fixture master password";
    const created = await VaultMetadata.createNewVault(
        { Name: "Personal", Description: "" },
        {
            Secret: password,
            Encryption: VaultProto.EncryptionAlgorithm.AES256,
            EncryptionKeyDerivationFunction:
                VaultProto.KeyDerivationFunction.Argon2ID,
            EncryptionConfig: { memLimit: 8, opsLimit: 1, iterations: 1_000 },
        },
        false,
        0,
        {
            additionalKeyProtection: {
                kind: VaultProto.AdditionalKeyProtectionKind.NONE,
            },
        },
    );
    created.vault.Credentials.push(
        credential({
            ID: "credential-example",
            Name: "Example",
            Username: "alice@example.com",
            Password: "correct horse battery staple",
            URL: "https://login.example.com",
            AdditionalURLs: [
                {
                    URL: "*.example.net",
                    MatchMode: VaultProto.CredentialURLMatchMode.Wildcard,
                },
            ],
        }),
        credential({
            ID: "credential-bank",
            Name: "Bank",
            Username: "bob",
            Password: "š€cret ✓",
            URL: "bank.example.org",
            URLMatchMode: VaultProto.CredentialURLMatchMode.Domain,
        }),
        credential({ ID: "credential-pin", Name: "PIN", Password: "1234" }),
        credential({
            ID: "credential-deleted",
            Name: "Deleted",
            Password: "deleted",
            Deleted: true,
        }),
        credential({
            ID: "credential-ssh",
            Name: "Server key",
            Type: VaultProto.ItemType.SSHKey,
            Password: "passphrase",
        }),
        credential({
            ID: "credential-note",
            Name: "Note",
            Type: VaultProto.ItemType.Note,
        }),
    );
    await created.metadata.save(created.vault, created.dek);
    const dek = await created.metadata.prepareBiometricUnlock(password);
    if (dek.isErr()) throw new Error(dek.error);
    const index = created.metadata.DBIndex!;
    expect((await enableBiometricUnlock(dek.value, index)).isOk()).toBe(true);

    writeFileSync(
        join(__dirname, "../AutofillCoreTests/Fixtures/vault.json"),
        JSON.stringify(
            {
                storedMetadata: mockMmkv.get(`vault:data:${index}`),
                wrapKeyItem: mockSecureStore.get(
                    `cryptex.biometric-device-wrap-key.${index}`,
                ),
                wrappedKeyItem: mockSecureStore.get(
                    `cryptex.biometric-wrapped-dek.${index}`,
                ),
                credentials: created.vault.Credentials.map(
                    ({ ID, Name, Username, Password }) => ({
                        ID,
                        Name,
                        Username,
                        Password,
                    }),
                ),
                candidateIDs: created.vault.Credentials.filter(
                    isAutofillCandidate,
                ).map(({ ID }) => ID),
            },
            null,
            4,
        ) + "\n",
    );
});
