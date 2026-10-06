/**
 * @jest-environment node
 */
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { webcrypto } from "crypto";

Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    writable: true,
});

const registeredUpgrades: Array<(transaction: unknown) => Promise<void>> = [];

jest.mock("dexie", () => {
    class DexieMock {
        public name: string;

        constructor(name: string) {
            this.name = name;
        }

        public version() {
            return {
                stores: () => ({
                    upgrade: (
                        callback: (transaction: unknown) => Promise<void>,
                    ) => registeredUpgrades.push(callback),
                }),
            };
        }
    }

    return { __esModule: true, default: DexieMock };
});

const mockVaultDb = { vaults: {} };

jest.mock("../../src/app_lib/vault-utils/storage", () => ({
    db: mockVaultDb,
}));

import * as VaultUtilTypes from "@cryptex-industries/vault-core/proto";
import { createWebCryptoEnvelopeCrypto } from "@cryptex-industries/vault-core/runtime";
import {
    clearDeviceAdditionalKeyProtection,
    getDeviceAdditionalKeyProtectionKey,
    getDeviceAdditionalKeyProtectionKind,
    keyStoreDb,
    setDeviceAdditionalKeyProtectionKey,
    vaultDb,
    VaultKeyStoreDatabase,
    type DeviceAdditionalKeyProtectionRecord,
} from "../../src/app_lib/vault-utils/vault-key-store";

describe("vault-key-store", () => {
    const records = new Map<string, DeviceAdditionalKeyProtectionRecord>();
    const table = {
        put: jest.fn(async (record: DeviceAdditionalKeyProtectionRecord) => {
            records.set(record.id, record);
        }),
        get: jest.fn(async (id: string) => records.get(id)),
        delete: jest.fn(async (id: string) => {
            records.delete(id);
        }),
    };

    beforeEach(() => {
        jest.clearAllMocks();
        records.clear();
        (
            keyStoreDb as unknown as {
                deviceAdditionalKeyProtections: typeof table;
            }
        ).deviceAdditionalKeyProtections = table;
    });

    it("constructs the key-store database and re-exports the vault database", () => {
        const db = new VaultKeyStoreDatabase() as unknown as { name: string };

        expect(db.name).toBe("vaultKeyStore");
        expect(vaultDb).toBe(mockVaultDb);
    });

    it("stores, reads, and clears protection-phrase keys by vault DB index", async () => {
        const key = await createWebCryptoEnvelopeCrypto().importHkdfKey(
            new Uint8Array(32),
        );

        await setDeviceAdditionalKeyProtectionKey(
            42,
            key,
            VaultUtilTypes.AdditionalKeyProtectionKind.PROTECTION_PHRASE_128,
        );

        expect(table.put).toHaveBeenCalledWith({
            id: "akp:42",
            vaultDbIndex: 42,
            kind: VaultUtilTypes.AdditionalKeyProtectionKind
                .PROTECTION_PHRASE_128,
            protectionHkdfKey: key,
            webauthnCredentialId: undefined,
            webauthnPrfSalt: undefined,
        });
        await expect(getDeviceAdditionalKeyProtectionKey(42)).resolves.toBe(
            key,
        );
        await expect(getDeviceAdditionalKeyProtectionKind(42)).resolves.toBe(
            VaultUtilTypes.AdditionalKeyProtectionKind.PROTECTION_PHRASE_128,
        );

        await clearDeviceAdditionalKeyProtection(42);
        await expect(
            getDeviceAdditionalKeyProtectionKey(42),
        ).resolves.toBeNull();
        await expect(
            getDeviceAdditionalKeyProtectionKind(42),
        ).resolves.toBeNull();
    });

    it("stores WebAuthn metadata with a null local key", async () => {
        await setDeviceAdditionalKeyProtectionKey(
            9,
            null,
            VaultUtilTypes.AdditionalKeyProtectionKind.WEBAUTHN_PRF,
            "credential-id",
            "prf-salt",
        );

        expect(records.get("akp:9")).toEqual({
            id: "akp:9",
            vaultDbIndex: 9,
            kind: VaultUtilTypes.AdditionalKeyProtectionKind.WEBAUTHN_PRF,
            protectionHkdfKey: null,
            webauthnCredentialId: "credential-id",
            webauthnPrfSalt: "prf-salt",
        });
        await expect(
            getDeviceAdditionalKeyProtectionKey(9),
        ).resolves.toBeNull();
        await expect(getDeviceAdditionalKeyProtectionKind(9)).resolves.toBe(
            VaultUtilTypes.AdditionalKeyProtectionKind.WEBAUTHN_PRF,
        );
    });

    it("migrates existing device protection keys into the renamed store", async () => {
        const key = await createWebCryptoEnvelopeCrypto().importHkdfKey(
            new Uint8Array(32),
        );
        const bulkPut = jest.fn(async () => undefined);
        const transaction = {
            table: jest.fn((name: string) =>
                name === "deviceSecondFactors"
                    ? {
                          toArray: async () => [
                              {
                                  id: "sf:7",
                                  vaultDbIndex: 7,
                                  kind: VaultUtilTypes
                                      .AdditionalKeyProtectionKind
                                      .PROTECTION_PHRASE_128,
                                  factorHkdfKey: key,
                              },
                          ],
                      }
                    : { bulkPut },
            ),
        };

        const migration = registeredUpgrades[0];
        expect(migration).toBeDefined();
        await migration!(transaction);

        expect(bulkPut).toHaveBeenCalledWith([
            {
                id: "akp:7",
                vaultDbIndex: 7,
                kind: VaultUtilTypes.AdditionalKeyProtectionKind
                    .PROTECTION_PHRASE_128,
                protectionHkdfKey: key,
            },
        ]);
    });
});
