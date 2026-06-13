/**
 * @jest-environment node
 */
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { webcrypto } from "crypto";

Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    writable: true,
});

jest.mock("dexie", () => {
    class DexieMock {
        public name: string;

        constructor(name: string) {
            this.name = name;
        }

        public version() {
            return { stores: () => undefined };
        }
    }

    return { __esModule: true, default: DexieMock };
});

const mockVaultDb = { vaults: {} };

jest.mock("../../src/app_lib/vault-utils/storage", () => ({
    db: mockVaultDb,
}));

import * as VaultUtilTypes from "../../src/app_lib/proto/vault";
import {
    clearDeviceSecondFactor,
    getDeviceSecondFactorKey,
    getDeviceSecondFactorKind,
    keyStoreDb,
    setDeviceSecondFactorKey,
    vaultDb,
    VaultKeyStoreDatabase,
    type DeviceSecondFactorRecord,
} from "../../src/app_lib/vault-utils/vault-key-store";

describe("vault-key-store", () => {
    const records = new Map<string, DeviceSecondFactorRecord>();
    const table = {
        put: jest.fn(async (record: DeviceSecondFactorRecord) => {
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
            keyStoreDb as unknown as { deviceSecondFactors: typeof table }
        ).deviceSecondFactors = table;
    });

    it("constructs the key-store database and re-exports the vault database", () => {
        const db = new VaultKeyStoreDatabase() as unknown as { name: string };

        expect(db.name).toBe("vaultKeyStore");
        expect(vaultDb).toBe(mockVaultDb);
    });

    it("stores, reads, and clears passphrase second-factor keys by vault DB index", async () => {
        const key = await crypto.subtle.importKey(
            "raw",
            new Uint8Array(32),
            { name: "HKDF" },
            false,
            ["deriveKey"],
        );

        await setDeviceSecondFactorKey(
            42,
            key,
            VaultUtilTypes.SecondFactorKind.PASSPHRASE_128,
        );

        expect(table.put).toHaveBeenCalledWith({
            id: "sf:42",
            vaultDbIndex: 42,
            kind: VaultUtilTypes.SecondFactorKind.PASSPHRASE_128,
            factorHkdfKey: key,
            webauthnCredentialId: undefined,
            webauthnPrfSalt: undefined,
        });
        await expect(getDeviceSecondFactorKey(42)).resolves.toBe(key);
        await expect(getDeviceSecondFactorKind(42)).resolves.toBe(
            VaultUtilTypes.SecondFactorKind.PASSPHRASE_128,
        );

        await clearDeviceSecondFactor(42);
        await expect(getDeviceSecondFactorKey(42)).resolves.toBeNull();
        await expect(getDeviceSecondFactorKind(42)).resolves.toBeNull();
    });

    it("stores WebAuthn metadata with a null local key", async () => {
        await setDeviceSecondFactorKey(
            9,
            null,
            VaultUtilTypes.SecondFactorKind.WEBAUTHN_PRF,
            "credential-id",
            "prf-salt",
        );

        expect(records.get("sf:9")).toEqual({
            id: "sf:9",
            vaultDbIndex: 9,
            kind: VaultUtilTypes.SecondFactorKind.WEBAUTHN_PRF,
            factorHkdfKey: null,
            webauthnCredentialId: "credential-id",
            webauthnPrfSalt: "prf-salt",
        });
        await expect(getDeviceSecondFactorKey(9)).resolves.toBeNull();
        await expect(getDeviceSecondFactorKind(9)).resolves.toBe(
            VaultUtilTypes.SecondFactorKind.WEBAUTHN_PRF,
        );
    });
});
