import {
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    jest,
} from "@jest/globals";
import * as SecureStore from "expo-secure-store";

import * as VaultProto from "@cryptex-industries/vault-core/proto";
import {
    configureVaultCoreRuntime,
    createWebCryptoEnvelopeCrypto,
} from "@cryptex-industries/vault-core/runtime";
import { KeyDerivationConfig_Argon2ID } from "@cryptex-industries/vault-core/vault-utils/encryption";
import { decryptWithDEK } from "@cryptex-industries/vault-core/vault-utils/envelope-encryption";
import {
    LinkedDevices,
    SignalingServerConfiguration,
    STUNServerConfiguration,
    TURNServerConfiguration,
    type Vault,
    VaultCredential,
} from "@cryptex-industries/vault-core/vault-utils/vault";

const mockMmkvData = new Map<string, string | number>();
const mockSecureStoreData = new Map<string, string>();

jest.mock("react-native-mmkv", () => ({
    MMKV: class {
        getString(key: string) {
            const value = mockMmkvData.get(key);
            return typeof value === "string" ? value : undefined;
        }
        getNumber(key: string) {
            const value = mockMmkvData.get(key);
            return typeof value === "number" ? value : undefined;
        }
        set(key: string, value: string | number) {
            mockMmkvData.set(key, value);
        }
        delete(key: string) {
            mockMmkvData.delete(key);
        }
    },
}));

jest.mock("expo-secure-store", () => ({
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: "WHEN_UNLOCKED_THIS_DEVICE_ONLY",
    deleteItemAsync: jest.fn(async (key: string) => {
        mockSecureStoreData.delete(key);
    }),
    getItemAsync: jest.fn(
        async (key: string) => mockSecureStoreData.get(key) ?? null,
    ),
    setItemAsync: jest.fn(async (key: string, value: string) => {
        mockSecureStoreData.set(key, value);
    }),
}));

jest.mock("@cryptex-industries/vault-core/vault-utils/sync-signing", () => ({
    ensureSyncSigningKeypair: jest.fn(async (linkedDevices: LinkedDevices) => {
        linkedDevices.SyncSigningPublicKey = "local-signing-public";
        linkedDevices.SyncSigningPrivateKey = "local-signing-private";
        return true;
    }),
}));

jest.mock(
    "@cryptex-industries/vault-core/vault-utils/post-quantum-kem",
    () => ({
        ensureSyncKemKeypair: jest.fn(async (linkedDevices: LinkedDevices) => {
            linkedDevices.SyncKemPublicKey = "local-kem-public";
            linkedDevices.SyncKemPrivateKey = "local-kem-private";
            return true;
        }),
    }),
);

import {
    deleteVault,
    listVaults,
    loadVault,
    saveVault,
    VaultMetadata,
} from "@/app_lib/vault-utils/storage";
import {
    getDeviceAdditionalKeyProtectionKey,
    setDeviceAdditionalKeyProtectionKey,
    setDeviceAdditionalKeyProtectionRawKey,
} from "@/app_lib/vault-utils/vault-key-store";

const silentLog = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
};

const kdfConfig = new KeyDerivationConfig_Argon2ID(8, 1);
const encryptionForm = (secret: string) => ({
    Secret: secret,
    Encryption: VaultProto.EncryptionAlgorithm.AES256,
    EncryptionKeyDerivationFunction: VaultProto.KeyDerivationFunction.Argon2ID,
    EncryptionConfig: {
        memLimit: kdfConfig.memLimit,
        opsLimit: kdfConfig.opsLimit,
        iterations: 1_000,
    },
});

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
            setDeviceAdditionalKeyProtectionKey,
            setDeviceAdditionalKeyProtectionRawKey,
            getDeviceAdditionalKeyProtectionKey,
        },
    });
});

beforeEach(() => {
    mockMmkvData.clear();
    mockSecureStoreData.clear();
});

async function createConfiguredVault() {
    const created = await VaultMetadata.createNewVault(
        { Name: "Security persistence", Description: "" },
        encryptionForm("old-password"),
        false,
        0,
        {
            additionalKeyProtection: {
                kind: VaultProto.AdditionalKeyProtectionKind.NONE,
            },
        },
    );
    // Save the creation snapshot before adding current-session data. The
    // security operation must replace this stale ciphertext with the current
    // unlocked vault in its single persistence write.
    await created.metadata.save(created.vault, created.dek);
    created.vault.Credentials.push(
        Object.assign(new VaultCredential(), {
            ID: "credential-kept",
            Name: "Kept credential",
        }),
    );
    const peer = LinkedDevices.addLinkedDevice(
        created.vault.LinkedDevices,
        "Peer kept",
        "sync-kept",
        "signing-key-kept",
        "kem-key-kept",
    );
    peer.AutoConnect = false;
    peer.SyncTimeout = true;
    peer.SyncTimeoutPeriod = 91;
    created.vault.LinkedDevices.STUNServers.push(
        new STUNServerConfiguration("STUN kept", "stun:kept.example:3478"),
    );
    created.vault.LinkedDevices.TURNServers.push(
        new TURNServerConfiguration(
            "TURN kept",
            "turn:kept.example:3478",
            "user",
            "password",
        ),
    );
    created.vault.LinkedDevices.SignalingServers.push(
        new SignalingServerConfiguration(
            "Signaling kept",
            "app",
            "key",
            "secret",
            "signal.kept.example",
            "80",
            "443",
        ),
    );
    return created;
}

async function loadPersistedVault(
    metadata: VaultMetadata,
    masterPassword: string,
) {
    const data = await loadVault(metadata.DBIndex!);
    expect(data).toBeDefined();
    const persisted = VaultMetadata.deserializeMetadataBinary(
        data!,
        metadata.DBIndex,
    );
    return persisted.decryptVault(
        masterPassword,
        VaultProto.EncryptionAlgorithm.AES256,
        VaultProto.KeyDerivationFunction.Argon2ID,
        encryptionForm(masterPassword).EncryptionConfig,
    );
}

function expectCurrentVaultState(vault: Vault) {
    expect(vault.Credentials.map((item) => item.ID)).toContain(
        "credential-kept",
    );
    expect(vault.LinkedDevices.Devices).toEqual(
        expect.arrayContaining([
            expect.objectContaining({
                Name: "Peer kept",
                SyncID: "sync-kept",
                AutoConnect: false,
                SyncTimeout: true,
                SyncTimeoutPeriod: 91,
            }),
        ]),
    );
    expect(vault.LinkedDevices.STUNServers[0]?.Host).toBe(
        "stun:kept.example:3478",
    );
    expect(vault.LinkedDevices.TURNServers[0]?.Username).toBe("user");
    expect(vault.LinkedDevices.SignalingServers[0]?.Host).toBe(
        "signal.kept.example",
    );
}

describe("local vault storage contract", () => {
    it("allocates IDs from one and stores bytes under the existing MMKV keys", async () => {
        const bytes = new Uint8Array([0, 1, 255]);
        expect(await saveVault(undefined, bytes)).toBe(1);
        expect(await saveVault(undefined, new Uint8Array([2]))).toBe(2);
        expect(mockMmkvData).toEqual(new Map<string, string | number>([
            ["vaults:nextId", 3],
            ["vaults:ids", "[1,2]"],
            ["vault:data:1", "AAH/"],
            ["vault:data:2", "Ag=="],
        ]));
        expect(await loadVault(1)).toEqual(bytes);
        expect(await loadVault(99)).toBeUndefined();
    });

    it("updates an existing row without allocating an ID and leaves unknown indices untouched", async () => {
        const id = await saveVault(undefined, new Uint8Array([1]));
        const bytes = new Uint8Array([255]);
        expect(await saveVault(id, bytes)).toBe(id);
        expect(await loadVault(id)).toEqual(bytes);
        expect(mockMmkvData.get("vaults:ids")).toBe("[1]");
        expect(mockMmkvData.get("vaults:nextId")).toBe(2);

        const before = new Map(mockMmkvData);
        expect(await saveVault(99, bytes)).toBe(99);
        expect(mockMmkvData).toEqual(before);
    });

    it("loads and updates a zero-length row as an existing row", async () => {
        const id = await saveVault(undefined, new Uint8Array());
        expect(mockMmkvData.get("vault:data:1")).toBe("");
        expect(await loadVault(id)).toEqual(new Uint8Array());

        const bytes = new Uint8Array([3]);
        expect(await saveVault(id, bytes)).toBe(id);
        expect(await loadVault(id)).toEqual(bytes);
        expect(mockMmkvData.get("vaults:ids")).toBe("[1]");
    });

    it("deletes both the row and its listed ID without reusing allocated IDs", async () => {
        const first = await saveVault(undefined, new Uint8Array([1]));
        const second = await saveVault(undefined, new Uint8Array([2]));
        await deleteVault(first);
        expect(mockMmkvData.has("vault:data:1")).toBe(false);
        expect(await loadVault(first)).toBeUndefined();
        expect(mockMmkvData.get("vaults:ids")).toBe("[2]");
        expect(await loadVault(second)).toEqual(new Uint8Array([2]));

        await deleteVault(first);
        expect(await saveVault(undefined, new Uint8Array([3]))).toBe(3);
        expect(mockMmkvData.get("vaults:ids")).toBe("[2,3]");
    });

    it("lists valid metadata in ID order while skipping missing stored rows", async () => {
        const { metadata } = await createConfiguredVault();
        const missing = await saveVault(
            undefined,
            VaultProto.VaultMetadata.encode(metadata).finish(),
        );
        const last = Object.assign(new VaultMetadata(), metadata, {
            Name: "Last vault",
        });
        const lastId = await saveVault(
            undefined,
            VaultProto.VaultMetadata.encode(last).finish(),
        );
        mockMmkvData.delete(`vault:data:${missing}`);

        const listed = await listVaults();
        expect(listed.map(({ DBIndex, Name }) => ({ DBIndex, Name }))).toEqual([
            { DBIndex: metadata.DBIndex, Name: metadata.Name },
            { DBIndex: lastId, Name: last.Name },
        ]);
        expect(listed[0]?.Blob?.Envelope).toEqual(metadata.Blob?.Envelope);
        expect(mockMmkvData.get("vaults:ids")).toBe("[1,2,3]");
    });
});

describe("unlocked security persistence", () => {
    it("caches an entered protection phrase only after it unlocks the envelope", async () => {
        const created = await VaultMetadata.createNewVault(
            { Name: "Protection cache", Description: "" },
            encryptionForm("old-password"),
            false,
            0,
            {
                additionalKeyProtection: {
                    kind: VaultProto.AdditionalKeyProtectionKind
                        .PROTECTION_PHRASE_128,
                },
            },
        );
        await created.metadata.save(created.vault, created.dek);
        const protectionPhrase = created.revealSecrets.protectionPhrase!;

        const rejected = await created.metadata.decryptVault(
            "wrong-password",
            VaultProto.EncryptionAlgorithm.AES256,
            VaultProto.KeyDerivationFunction.Argon2ID,
            encryptionForm("wrong-password").EncryptionConfig,
            {
                masterPassword: "wrong-password",
                protectionPhrase,
            },
        );
        expect(rejected.isErr()).toBe(true);
        expect(SecureStore.setItemAsync).not.toHaveBeenCalled();

        const opened = await created.metadata.decryptVault(
            "old-password",
            VaultProto.EncryptionAlgorithm.AES256,
            VaultProto.KeyDerivationFunction.Argon2ID,
            encryptionForm("old-password").EncryptionConfig,
            {
                masterPassword: "old-password",
                protectionPhrase,
            },
        );
        expect(opened.isOk()).toBe(true);
        expect(SecureStore.setItemAsync).toHaveBeenCalledTimes(1);
        const [key, stored] = jest.mocked(SecureStore.setItemAsync).mock
            .calls[0]!;
        expect(key).toBe(`cryptex.device-akp.${created.metadata.DBIndex}`);
        expect(JSON.parse(stored)).toMatchObject({
            vaultDbIndex: created.metadata.DBIndex,
            kind: VaultProto.AdditionalKeyProtectionKind.PROTECTION_PHRASE_128,
        });

        const reopenedFromDeviceCache = await created.metadata.decryptVault(
            "old-password",
            VaultProto.EncryptionAlgorithm.AES256,
            VaultProto.KeyDerivationFunction.Argon2ID,
            encryptionForm("old-password").EncryptionConfig,
            { masterPassword: "old-password" },
        );
        expect(reopenedFromDeviceCache.isOk()).toBe(true);
    });

    it("preserves credentials, peers, and connection configuration in the one re-key save", async () => {
        const created = await createConfiguredVault();

        const changed = await created.metadata.reconfigureSecurity({
            currentMasterPassword: "old-password",
            newMasterPassword: "new-password",
            additionalKeyProtection: {
                kind: VaultProto.AdditionalKeyProtectionKind.NONE,
            },
            kdfConfig,
            unlockedVault: created.vault,
            unlockedVaultDEK: created.dek,
        });
        expect(changed.isOk()).toBe(true);

        const opened = await loadPersistedVault(
            created.metadata,
            "new-password",
        );
        expect(opened.isOk()).toBe(true);
        if (opened.isErr()) return;
        expectCurrentVaultState(opened.value.vault);
    });

    it("preserves the current unlocked payload while rotating the recovery code", async () => {
        const created = await createConfiguredVault();

        const changed = await created.metadata.resetRecoveryCode({
            currentMasterPassword: "old-password",
            unlockedVault: created.vault,
            unlockedVaultDEK: created.dek,
        });
        expect(changed.isOk()).toBe(true);

        const opened = await loadPersistedVault(
            created.metadata,
            "old-password",
        );
        expect(opened.isOk()).toBe(true);
        if (opened.isErr()) return;
        expectCurrentVaultState(opened.value.vault);
    });

    it("preserves the current unlocked payload while rotating the vault data key", async () => {
        const created = await createConfiguredVault();
        const nextKdfConfig = new KeyDerivationConfig_Argon2ID(9, 2);

        const changed = await created.metadata.reconfigureSecurity({
            currentMasterPassword: "old-password",
            newMasterPassword: "new-password",
            additionalKeyProtection: {
                kind: VaultProto.AdditionalKeyProtectionKind.NONE,
            },
            kdfConfig: nextKdfConfig,
            rotateDataKey: true,
            unlockedVault: created.vault,
            unlockedVaultDEK: created.dek,
        });
        expect(changed.isOk()).toBe(true);
        if (changed.isErr()) return;
        expect(changed.value.dataKeyRotated).toBe(true);
        expect(changed.value.recoveryCode).not.toBe("");
        expect(changed.value.sessionDek).toBeDefined();
        expect(created.metadata.Blob?.KDFConfigArgon2ID).toEqual({
            memLimit: nextKdfConfig.memLimit,
            opsLimit: nextKdfConfig.opsLimit,
        });

        const oldDekAgainstNewCiphertext = await decryptWithDEK(
            created.dek,
            created.metadata.Blob!.Blob,
            created.metadata.Blob!.HeaderIV,
        );
        expect(oldDekAgainstNewCiphertext.isErr()).toBe(true);
        const newDekAgainstNewCiphertext = await decryptWithDEK(
            changed.value.sessionDek!,
            created.metadata.Blob!.Blob,
            created.metadata.Blob!.HeaderIV,
        );
        expect(newDekAgainstNewCiphertext.isOk()).toBe(true);
        const biometricEnrollmentDek =
            await created.metadata.prepareBiometricUnlock("new-password");
        expect(biometricEnrollmentDek.isOk()).toBe(true);
        if (biometricEnrollmentDek.isOk()) {
            expect(biometricEnrollmentDek.value.extractable).toBe(true);
        }

        const opened = await loadPersistedVault(
            created.metadata,
            "new-password",
        );
        expect(opened.isOk()).toBe(true);
        if (opened.isErr()) return;
        expectCurrentVaultState(opened.value.vault);
    });

    it("rotates the data key when replacing the recovery code", async () => {
        const created = await createConfiguredVault();

        const changed = await created.metadata.resetRecoveryCode({
            currentMasterPassword: "old-password",
            rotateDataKey: true,
            unlockedVault: created.vault,
            unlockedVaultDEK: created.dek,
        });
        expect(changed.isOk()).toBe(true);
        if (changed.isErr()) return;
        expect(changed.value.dataKeyRotated).toBe(true);
        expect(changed.value.recoveryCode).not.toBe("");
        expect(changed.value.sessionDek).toBeDefined();

        const opened = await loadPersistedVault(
            created.metadata,
            "old-password",
        );
        expect(opened.isOk()).toBe(true);
        if (opened.isErr()) return;
        expectCurrentVaultState(opened.value.vault);
    });

    it("restores the in-memory envelope and returns no generated secret when the single save fails", async () => {
        const created = await createConfiguredVault();
        const previousBlob = created.metadata.Blob;
        jest.spyOn(created.metadata, "save").mockRejectedValueOnce(
            new Error("storage unavailable"),
        );

        await expect(
            created.metadata.reconfigureSecurity({
                currentMasterPassword: "old-password",
                additionalKeyProtection: {
                    kind: VaultProto.AdditionalKeyProtectionKind
                        .PROTECTION_PHRASE_128,
                },
                kdfConfig,
                unlockedVault: created.vault,
                unlockedVaultDEK: created.dek,
            }),
        ).rejects.toThrow("storage unavailable");
        expect(created.metadata.Blob).toBe(previousBlob);
    });
});
