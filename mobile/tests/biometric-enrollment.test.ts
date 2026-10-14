import {
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    jest,
} from "@jest/globals";
import * as SecureStore from "expo-secure-store";

const mockStoredValues = new Map<
    string,
    { value: string; service: string; authenticated: boolean }
>();
const mockInvalidatedServices = new Set<string>();

jest.mock("expo-local-authentication", () => ({
    hasHardwareAsync: async () => true,
    isEnrolledAsync: async () => true,
}));
jest.mock("expo-secure-store", () => {
    return {
        WHEN_UNLOCKED_THIS_DEVICE_ONLY: 6,
        getItemAsync: jest.fn(
            async (key: string, options?: SecureStore.SecureStoreOptions) => {
                const service = options?.keychainService ?? "default";
                const entry = mockStoredValues.get(`${service}:${key}`);
                if (
                    entry?.authenticated &&
                    mockInvalidatedServices.has(service)
                )
                    return null;
                return entry?.value ?? null;
            },
        ),
        setItemAsync: jest.fn(
            async (
                key: string,
                value: string,
                options?: SecureStore.SecureStoreOptions,
            ) => {
                const service = options?.keychainService ?? "default";
                if (
                    options?.requireAuthentication &&
                    mockInvalidatedServices.delete(service)
                ) {
                    for (const [storedKey, entry] of mockStoredValues) {
                        if (entry.service === service && entry.authenticated)
                            mockStoredValues.delete(storedKey);
                    }
                }
                mockStoredValues.set(`${service}:${key}`, {
                    value,
                    service,
                    authenticated: options?.requireAuthentication === true,
                });
            },
        ),
        deleteItemAsync: jest.fn(
            async (key: string, options?: SecureStore.SecureStoreOptions) => {
                mockStoredValues.delete(
                    `${options?.keychainService ?? "default"}:${key}`,
                );
            },
        ),
    };
});
jest.mock("@/utils/logging", () => ({ vaultLog: { warn: jest.fn() } }));

import {
    configureVaultCoreRuntime,
    createWebCryptoEnvelopeCrypto,
} from "@cryptex-industries/vault-core/runtime";
import { AdditionalKeyProtectionKind } from "@cryptex-industries/vault-core/proto";
import {
    isPrimarySlot,
    KeyDerivationConfig_Argon2ID,
} from "@cryptex-industries/vault-core/vault-utils/encryption";
import {
    openPrimarySlot,
    decryptWithDEK,
} from "@cryptex-industries/vault-core/vault-utils/envelope-encryption";
import * as vaultEncoding from "@cryptex-industries/vault-core/encoding";
import { openEnvelopeBlob } from "@cryptex-industries/vault-core/vault-utils/vault-envelope-ops";
import { createLinkedVaultEnvelope } from "@/utils/linked-vault-envelope";
import {
    clearSecureDek,
    enableBiometricUnlock,
    isSecureDekEnrolled,
    unlockWithBiometric,
} from "@/lib/secure-dek";

beforeEach(() => {
    mockStoredValues.clear();
    mockInvalidatedServices.clear();
});

afterEach(() => {
    jest.restoreAllMocks();
});

const silentLog = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
};

const byteView = (value: BufferSource): Uint8Array =>
    value instanceof ArrayBuffer
        ? new Uint8Array(value)
        : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);

const wrapKeyA = "cryptex.biometric-device-wrap-key.7";
const payloadA = "cryptex.biometric-wrapped-dek.7";
const wrapKeyB = "cryptex.biometric-device-wrap-key.8";
const payloadB = "cryptex.biometric-wrapped-dek.8";
const storeOptionsA = { keychainService: "cryptex.biometric.7" };
const storeOptionsB = { keychainService: "cryptex.biometric.8" };

async function createDek(byte: number): Promise<CryptoKey> {
    return crypto.subtle.importKey(
        "raw",
        new Uint8Array(32).fill(byte),
        "AES-GCM",
        true,
        ["encrypt", "decrypt"],
    );
}

async function expectUnlocks(vaultDbIndex: number, originalDek: CryptoKey) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = new Uint8Array([vaultDbIndex, 1, 2, 3]);
    const ciphertext = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        originalDek,
        plaintext,
    );
    const result = await unlockWithBiometric(vaultDbIndex);
    if (result.isErr()) throw new Error(result.error);
    expect(result.value.vaultDbIndex).toBe(vaultDbIndex);
    expect(result.value.dek.extractable).toBe(false);
    const decrypted = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv },
        result.value.dek,
        ciphertext,
    );
    expect(new Uint8Array(decrypted)).toEqual(plaintext);
}

function deferred() {
    let resolve = () => {};
    const promise = new Promise<void>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

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

describe("biometric enrollment key export", () => {
    it("keeps session keys non-exportable and enrolls after reopening the primary slot", async () => {
        const password = "enrollment test password";
        const vaultId = "biometric-enrollment-test";
        const plaintext = new TextEncoder().encode("test vault contents");
        const created = await createLinkedVaultEnvelope(plaintext, {
            vaultId,
            masterPassword: password,
            additionalKeyProtection: { kind: AdditionalKeyProtectionKind.NONE },
            kdfConfig: new KeyDerivationConfig_Argon2ID(19, 2),
        });
        const session = await openEnvelopeBlob(created.blob, vaultId, {
            masterPassword: password,
        });
        if (session.isErr()) throw new Error(session.error);
        expect(session.value.dek.extractable).toBe(false);
        const failed = await enableBiometricUnlock(session.value.dek, 7);
        expect(failed.isErr() && failed.error).toBe("VAULT_KEY_EXPORT_FAILED");

        const slot = created.blob.Envelope?.Slots.find(isPrimarySlot);
        if (!slot) throw new Error("Primary slot missing");
        const wrong = await openPrimarySlot(
            slot,
            "incorrect password",
            vaultId,
            null,
            true,
        );
        expect(wrong.isErr()).toBe(true);
        const enrollment = await openPrimarySlot(
            slot,
            password,
            vaultId,
            null,
            true,
        );
        if (enrollment.isErr()) throw new Error(enrollment.error);
        expect((await enableBiometricUnlock(enrollment.value, 7)).isOk()).toBe(
            true,
        );
        const unlocked = await unlockWithBiometric(7);
        if (unlocked.isErr()) throw new Error(unlocked.error);
        expect(unlocked.value.vaultDbIndex).toBe(7);
        const decrypted = await decryptWithDEK(
            unlocked.value.dek,
            created.blob.Blob,
            created.blob.HeaderIV,
        );
        if (decrypted.isErr()) throw new Error(decrypted.error);
        expect(decrypted.value).toEqual(plaintext);
        expect(unlocked.value.dek.extractable).toBe(false);
    });
});

describe("biometric key buffer lifetime", () => {
    it.each([false, true])(
        "wipes enrollment DEK bytes after encryption settles, failure=%s",
        async (fail) => {
            const dek = await crypto.subtle.generateKey(
                { name: "AES-GCM", length: 256 },
                true,
                ["encrypt", "decrypt"],
            );
            const rawDek = new Uint8Array(32).fill(7);
            jest.spyOn(crypto.subtle, "exportKey").mockResolvedValueOnce(
                rawDek.buffer,
            );
            const importKey = jest.spyOn(crypto.subtle, "importKey");
            let encryptedBytes: Uint8Array | undefined;
            let observedRaw: Uint8Array | undefined;
            let wrapExportable: boolean | undefined;
            const encrypt = jest
                .spyOn(crypto.subtle, "encrypt")
                .mockImplementationOnce(async (_algorithm, wrapKey, data) => {
                    wrapExportable = wrapKey.extractable;
                    encryptedBytes = byteView(data);
                    await Promise.resolve();
                    observedRaw = encryptedBytes.slice();
                    if (fail) throw new Error("encryption failed");
                    return new Uint8Array(48).fill(8).buffer;
                });
            const result = await enableBiometricUnlock(dek, 7);
            expect(result.isErr()).toBe(fail);
            if (result.isErr()) expect(result.error).toBe("WRAP_FAILED");
            expect(encrypt).toHaveBeenCalledTimes(1);
            expect(wrapExportable).toBe(false);
            expect(observedRaw).toEqual(new Uint8Array(32).fill(7));
            expect(encryptedBytes).toEqual(new Uint8Array(32));
            expect(rawDek).toEqual(new Uint8Array(32));
            expect(
                importKey.mock.calls.map(([, data]) => byteView(data)),
            ).toEqual([new Uint8Array(32)]);
        },
    );

    it.each([false, true])(
        "wipes decrypted DEK bytes after import settles, failure=%s",
        async (fail) => {
            await SecureStore.setItemAsync(
                wrapKeyA,
                Buffer.alloc(32, 3).toString("base64"),
                { ...storeOptionsA, requireAuthentication: true },
            );
            await SecureStore.setItemAsync(
                payloadA,
                JSON.stringify({
                    iv: Buffer.alloc(12).toString("base64"),
                    ciphertext: "AA==",
                }),
                storeOptionsA,
            );
            const rawDek = new Uint8Array(32).fill(7);
            jest.spyOn(crypto.subtle, "decrypt").mockResolvedValueOnce(
                rawDek.buffer,
            );
            const originalImport = crypto.subtle.importKey.bind(crypto.subtle);
            let imports = 0;
            let observedRaw: Uint8Array | undefined;
            jest.spyOn(crypto.subtle, "importKey").mockImplementation(
                async (...args) => {
                    imports += 1;
                    if (imports === 2) {
                        await Promise.resolve();
                        observedRaw = rawDek.slice();
                        if (fail) throw new Error("import failed");
                    }
                    return originalImport(...args);
                },
            );
            const result = await unlockWithBiometric(7);
            expect(result.isErr()).toBe(fail);
            if (result.isErr()) expect(result.error).toBe("UNWRAP_FAILED");
            else expect(result.value.dek.extractable).toBe(false);
            expect(imports).toBe(2);
            expect(observedRaw).toEqual(new Uint8Array(32).fill(7));
            expect(rawDek).toEqual(new Uint8Array(32));
        },
    );

    it.each<["stored" | "new", boolean]>([
        ["stored", false],
        ["stored", true],
        ["new", false],
        ["new", true],
    ])(
        "wipes %s wrapping-key bytes after import settles, failure=%s",
        async (source, fail) => {
            const decoded = new Uint8Array(32).fill(3);
            if (source === "stored") {
                await SecureStore.setItemAsync(
                    wrapKeyA,
                    Buffer.alloc(32, 3).toString("base64"),
                    { ...storeOptionsA, requireAuthentication: true },
                );
                jest.spyOn(vaultEncoding, "base64ToUint8").mockReturnValueOnce(
                    decoded,
                );
            }
            const dek = await crypto.subtle.generateKey(
                { name: "AES-GCM", length: 256 },
                true,
                ["encrypt", "decrypt"],
            );
            const originalImport = crypto.subtle.importKey.bind(crypto.subtle);
            const imported: Uint8Array[] = [];
            const observed: [Uint8Array, Uint8Array][] = [];
            jest.spyOn(crypto.subtle, "importKey").mockImplementationOnce(
                async (...args) => {
                    const data = byteView(args[1]);
                    imported.push(data);
                    const expected = data.slice();
                    await Promise.resolve();
                    observed.push([expected, data.slice()]);
                    if (fail) throw new Error("import failed");
                    return originalImport(...args);
                },
            );
            const result = await enableBiometricUnlock(dek, 7);
            expect(result.isErr()).toBe(fail);
            if (result.isErr()) expect(result.error).toBe("AUTH_KEY_FAILED");
            expect(observed).toHaveLength(1);
            for (const [before, after] of observed)
                expect(after).toEqual(before);
            expect(imported).toEqual([new Uint8Array(32)]);
            if (source === "stored")
                expect(decoded).toEqual(new Uint8Array(32));
        },
    );

    it("wipes a newly generated wrapping key when SecureStore rejects it", async () => {
        const dek = await crypto.subtle.generateKey(
            { name: "AES-GCM", length: 256 },
            true,
            ["encrypt", "decrypt"],
        );
        const generated: ArrayBufferView[] = [];
        const originalRandom = crypto.getRandomValues.bind(crypto);
        jest.spyOn(crypto, "getRandomValues").mockImplementation((bytes) => {
            const result = originalRandom(bytes);
            if (result) generated.push(result);
            return result;
        });
        jest.mocked(SecureStore.setItemAsync).mockRejectedValueOnce(
            new Error("store failed"),
        );
        const result = await enableBiometricUnlock(dek, 7);
        expect(result.isErr() && result.error).toBe("AUTH_KEY_FAILED");
        expect(generated).toEqual([new Uint8Array(32)]);
    });
});

describe("vault-scoped biometric enrollment", () => {
    it("keeps different vault keys enrolled and removes only the selected vault", async () => {
        const dekA = await createDek(7);
        const dekB = await createDek(8);
        expect((await enableBiometricUnlock(dekA, 7)).isOk()).toBe(true);
        const storedWrapA = await SecureStore.getItemAsync(
            wrapKeyA,
            storeOptionsA,
        );
        const storedPayloadA = await SecureStore.getItemAsync(
            payloadA,
            storeOptionsA,
        );

        expect((await enableBiometricUnlock(dekB, 8)).isOk()).toBe(true);
        expect(await isSecureDekEnrolled(7)).toBe(true);
        expect(await isSecureDekEnrolled(8)).toBe(true);
        expect(await SecureStore.getItemAsync(wrapKeyA, storeOptionsA)).toBe(
            storedWrapA,
        );
        expect(await SecureStore.getItemAsync(payloadA, storeOptionsA)).toBe(
            storedPayloadA,
        );
        const storedWrapB = await SecureStore.getItemAsync(
            wrapKeyB,
            storeOptionsB,
        );
        const storedPayloadB = await SecureStore.getItemAsync(
            payloadB,
            storeOptionsB,
        );
        expect(storedWrapB).not.toBe(storedWrapA);
        expect(storedPayloadB).not.toBe(storedPayloadA);
        for (const [key, options] of [
            [wrapKeyA, storeOptionsA],
            [wrapKeyB, storeOptionsB],
        ] as const) {
            expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
                key,
                expect.any(String),
                expect.objectContaining({
                    ...options,
                    requireAuthentication: true,
                }),
            );
        }
        await expectUnlocks(7, dekA);
        await expectUnlocks(8, dekB);
        await expectUnlocks(7, dekA);

        await clearSecureDek(7);
        expect(await isSecureDekEnrolled(7)).toBe(false);
        expect(await isSecureDekEnrolled(8)).toBe(true);
        expect(
            await SecureStore.getItemAsync(wrapKeyA, storeOptionsA),
        ).toBeNull();
        expect(
            await SecureStore.getItemAsync(payloadA, storeOptionsA),
        ).toBeNull();
        expect(await SecureStore.getItemAsync(wrapKeyB, storeOptionsB)).toBe(
            storedWrapB,
        );
        expect(await SecureStore.getItemAsync(payloadB, storeOptionsB)).toBe(
            storedPayloadB,
        );
        expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(
            wrapKeyA,
            expect.objectContaining(storeOptionsA),
        );
        expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(
            payloadA,
            expect.objectContaining(storeOptionsA),
        );
        const removed = await unlockWithBiometric(7);
        expect(removed.isErr() && removed.error).toBe("NOT_ENABLED");
        await expectUnlocks(8, dekB);
    });

    it("replaces A's DEK without changing B's enrollment", async () => {
        const oldDekA = await createDek(7);
        const newDekA = await createDek(9);
        const dekB = await createDek(8);
        expect((await enableBiometricUnlock(oldDekA, 7)).isOk()).toBe(true);
        expect((await enableBiometricUnlock(dekB, 8)).isOk()).toBe(true);
        const storedWrapB = await SecureStore.getItemAsync(
            wrapKeyB,
            storeOptionsB,
        );
        const storedPayloadB = await SecureStore.getItemAsync(
            payloadB,
            storeOptionsB,
        );
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const oldCiphertext = await crypto.subtle.encrypt(
            { name: "AES-GCM", iv },
            oldDekA,
            new Uint8Array([7]),
        );

        expect((await enableBiometricUnlock(newDekA, 7)).isOk()).toBe(true);
        await expectUnlocks(7, newDekA);
        await expectUnlocks(8, dekB);
        expect(await SecureStore.getItemAsync(wrapKeyB, storeOptionsB)).toBe(
            storedWrapB,
        );
        expect(await SecureStore.getItemAsync(payloadB, storeOptionsB)).toBe(
            storedPayloadB,
        );
        const unlocked = await unlockWithBiometric(7);
        if (unlocked.isErr()) throw new Error(unlocked.error);
        await expect(
            crypto.subtle.decrypt(
                { name: "AES-GCM", iv },
                unlocked.value.dek,
                oldCiphertext,
            ),
        ).rejects.toMatchObject({ name: "OperationError" });
    });

    it("recreates A's invalidated native key without invalidating B", async () => {
        const dekA = await createDek(7);
        const newDekA = await createDek(9);
        const dekB = await createDek(8);
        expect((await enableBiometricUnlock(dekA, 7)).isOk()).toBe(true);
        expect((await enableBiometricUnlock(dekB, 8)).isOk()).toBe(true);
        const storedWrapA = await SecureStore.getItemAsync(
            wrapKeyA,
            storeOptionsA,
        );
        const storedWrapB = await SecureStore.getItemAsync(
            wrapKeyB,
            storeOptionsB,
        );
        mockInvalidatedServices.add(storeOptionsA.keychainService);

        expect((await enableBiometricUnlock(newDekA, 7)).isOk()).toBe(true);
        expect(
            await SecureStore.getItemAsync(wrapKeyA, storeOptionsA),
        ).not.toBe(storedWrapA);
        expect(await SecureStore.getItemAsync(wrapKeyB, storeOptionsB)).toBe(
            storedWrapB,
        );
        await expectUnlocks(7, newDekA);
        await expectUnlocks(8, dekB);
    });

    it.each([
        ["cancelled authentication", "BIOMETRIC_CANCELLED"],
        ["wrap-key import", "AUTH_KEY_FAILED"],
        ["DEK export", "VAULT_KEY_EXPORT_FAILED"],
        ["encryption", "WRAP_FAILED"],
        ["payload write", "ENROLLMENT_SAVE_FAILED"],
    ])(
        "preserves both enrolled vaults after a failed A replacement at %s",
        async (stage, error) => {
            const dekA = await createDek(7);
            const newDekA = await createDek(9);
            const dekB = await createDek(8);
            expect((await enableBiometricUnlock(dekA, 7)).isOk()).toBe(true);
            expect((await enableBiometricUnlock(dekB, 8)).isOk()).toBe(true);
            const getItem = jest.mocked(SecureStore.getItemAsync);
            const originalGet = getItem.getMockImplementation();
            if (!originalGet) throw new Error("SecureStore read mock missing");
            if (stage === "cancelled authentication") {
                getItem.mockImplementation(async (...args) => {
                    if (args[0] === wrapKeyA)
                        throw new Error("User cancelled authentication");
                    return originalGet(...args);
                });
            } else if (stage === "wrap-key import") {
                jest.spyOn(crypto.subtle, "importKey").mockRejectedValueOnce(
                    new Error("import failed"),
                );
            } else if (stage === "DEK export") {
                jest.spyOn(crypto.subtle, "exportKey").mockRejectedValueOnce(
                    new Error("export failed"),
                );
            } else if (stage === "encryption") {
                jest.spyOn(crypto.subtle, "encrypt").mockRejectedValueOnce(
                    new Error("encryption failed"),
                );
            } else {
                jest.mocked(SecureStore.setItemAsync).mockRejectedValueOnce(
                    new Error("payload save failed"),
                );
            }
            try {
                const failed = await enableBiometricUnlock(newDekA, 7);
                expect(failed.isErr() && failed.error).toBe(error);
            } finally {
                getItem.mockImplementation(originalGet);
            }
            await expectUnlocks(7, dekA);
            await expectUnlocks(8, dekB);
        },
    );

    it.each([
        ["wrap-key write", "AUTH_KEY_FAILED"],
        ["wrap-key import", "AUTH_KEY_FAILED"],
        ["encryption", "WRAP_FAILED"],
        ["payload write", "ENROLLMENT_SAVE_FAILED"],
    ])(
        "cleans a partial A enrollment after %s fails and preserves B",
        async (stage, error) => {
            const dekA = await createDek(7);
            const dekB = await createDek(8);
            expect((await enableBiometricUnlock(dekB, 8)).isOk()).toBe(true);
            const setItem = jest.mocked(SecureStore.setItemAsync);
            const originalSet = setItem.getMockImplementation();
            if (!originalSet) throw new Error("SecureStore write mock missing");
            if (stage === "wrap-key import") {
                jest.spyOn(crypto.subtle, "importKey").mockRejectedValueOnce(
                    new Error("import failed"),
                );
            } else if (stage === "encryption") {
                jest.spyOn(crypto.subtle, "encrypt").mockRejectedValueOnce(
                    new Error("encryption failed"),
                );
            } else {
                const failedKey =
                    stage === "wrap-key write" ? wrapKeyA : payloadA;
                setItem.mockImplementation(async (...args) => {
                    if (args[0] === failedKey) throw new Error("store failed");
                    return originalSet(...args);
                });
            }
            try {
                const failed = await enableBiometricUnlock(dekA, 7);
                expect(failed.isErr() && failed.error).toBe(error);
            } finally {
                setItem.mockImplementation(originalSet);
            }
            expect(await isSecureDekEnrolled(7)).toBe(false);
            expect(
                await SecureStore.getItemAsync(wrapKeyA, storeOptionsA),
            ).toBeNull();
            expect(
                await SecureStore.getItemAsync(payloadA, storeOptionsA),
            ).toBeNull();
            await expectUnlocks(8, dekB);
            expect((await enableBiometricUnlock(dekA, 7)).isOk()).toBe(true);
            await expectUnlocks(7, dekA);
        },
    );

    it("finishes deletion before replacing the same vault's enrollment", async () => {
        const dekA = await createDek(7);
        const newDekA = await createDek(9);
        const dekB = await createDek(8);
        expect((await enableBiometricUnlock(dekA, 7)).isOk()).toBe(true);
        expect((await enableBiometricUnlock(dekB, 8)).isOk()).toBe(true);
        const started = deferred();
        const resume = deferred();
        const deleteItem = jest.mocked(SecureStore.deleteItemAsync);
        const originalDelete = deleteItem.getMockImplementation();
        if (!originalDelete) throw new Error("SecureStore delete mock missing");
        deleteItem.mockImplementationOnce(async (...args) => {
            started.resolve();
            await resume.promise;
            return originalDelete(...args);
        });
        const clearing = clearSecureDek(7);
        await started.promise;
        const reads = jest.mocked(SecureStore.getItemAsync).mock.calls.length;
        const replacement = enableBiometricUnlock(newDekA, 7);
        await new Promise<void>(setImmediate);
        const readsBeforeRelease = jest.mocked(SecureStore.getItemAsync).mock
            .calls.length;
        resume.resolve();
        await clearing;
        expect((await replacement).isOk()).toBe(true);
        expect(readsBeforeRelease).toBe(reads);
        await expectUnlocks(7, newDekA);
        await expectUnlocks(8, dekB);
    });

    it.each(["clear A", "replace A", "clear B"])(
        "rejects only stale vault unlocks racing %s",
        async (operation) => {
            const dekA = await createDek(7);
            const newDekA = await createDek(9);
            const dekB = await createDek(8);
            expect((await enableBiometricUnlock(dekA, 7)).isOk()).toBe(true);
            expect((await enableBiometricUnlock(dekB, 8)).isOk()).toBe(true);
            const started = deferred();
            const resume = deferred();
            const originalDecrypt = crypto.subtle.decrypt.bind(crypto.subtle);
            let rawDek: Uint8Array | undefined;
            jest.spyOn(crypto.subtle, "decrypt").mockImplementationOnce(
                async (...args) => {
                    const decrypted = await originalDecrypt(...args);
                    rawDek = new Uint8Array(decrypted);
                    started.resolve();
                    await resume.promise;
                    return decrypted;
                },
            );
            const unlocking = unlockWithBiometric(7);
            await started.promise;
            if (operation === "replace A") {
                expect((await enableBiometricUnlock(newDekA, 7)).isOk()).toBe(
                    true,
                );
            } else {
                await clearSecureDek(operation === "clear A" ? 7 : 8);
            }
            const writes = jest.mocked(SecureStore.setItemAsync).mock.calls
                .length;
            resume.resolve();
            const result = await unlocking;
            expect(rawDek).toEqual(new Uint8Array(32));
            expect(
                jest.mocked(SecureStore.setItemAsync).mock.calls,
            ).toHaveLength(writes);
            if (operation === "clear B") {
                expect(result.isOk()).toBe(true);
                await expectUnlocks(7, dekA);
            } else {
                expect(result.isErr() && result.error).toBe("NOT_ENABLED");
                await expectUnlocks(8, dekB);
                if (operation === "replace A") await expectUnlocks(7, newDekA);
                else expect(await isSecureDekEnrolled(7)).toBe(false);
            }
        },
    );
});
