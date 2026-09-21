/**
 * Local IndexedDB storage for device-bound additional key protection.
 * Never synced. Protection-phrase keys survive ordinary lock/unlock in the
 * same browser profile and are replaced or cleared when protection changes.
 */

import Dexie from "dexie";
import * as VaultUtilTypes from "@cryptex-industries/vault-core/proto";
import type { VaultHkdfKey } from "@cryptex-industries/vault-core/envelope-crypto";
import { db as vaultDb } from "./storage";

export interface DeviceAdditionalKeyProtectionRecord {
    id: string;
    vaultDbIndex: number;
    kind: VaultUtilTypes.AdditionalKeyProtectionKind;
    /** Null for WebAuthn PRF: key reproduced via authenticator each unlock. */
    protectionHkdfKey: VaultHkdfKey | null;
    webauthnCredentialId?: string;
    /** Base64 PRF salt; required to reproduce PRF output on unlock. Not secret. */
    webauthnPrfSalt?: string;
}

type LegacyDeviceProtectionRecord = Omit<
    DeviceAdditionalKeyProtectionRecord,
    "id" | "protectionHkdfKey"
> & {
    id: string;
    factorHkdfKey: VaultHkdfKey | null;
};

// IndexedDB store names are persistent data. Keep the v1 name only long enough
// to copy existing device-local keys into the correctly named v2 store.
const LEGACY_DEVICE_PROTECTION_STORE = "deviceSecondFactors";
const DEVICE_PROTECTION_STORE = "deviceAdditionalKeyProtections";
const additionalKeyProtectionId = (vaultDbIndex: number) =>
    `akp:${vaultDbIndex}`;

export class VaultKeyStoreDatabase extends Dexie {
    public deviceAdditionalKeyProtections!: Dexie.Table<
        DeviceAdditionalKeyProtectionRecord,
        string
    >;

    constructor() {
        super("vaultKeyStore");
        this.version(1).stores({
            [LEGACY_DEVICE_PROTECTION_STORE]: "id, vaultDbIndex",
        });
        this.version(2)
            .stores({
                [LEGACY_DEVICE_PROTECTION_STORE]: "id, vaultDbIndex",
                [DEVICE_PROTECTION_STORE]: "id, vaultDbIndex",
            })
            .upgrade(async (transaction) => {
                const existing = await transaction
                    .table<LegacyDeviceProtectionRecord>(
                        LEGACY_DEVICE_PROTECTION_STORE,
                    )
                    .toArray();
                if (existing.length === 0) return;

                await transaction
                    .table<DeviceAdditionalKeyProtectionRecord>(
                        DEVICE_PROTECTION_STORE,
                    )
                    .bulkPut(
                        existing.map(
                            ({ factorHkdfKey, vaultDbIndex, ...record }) => ({
                                ...record,
                                id: additionalKeyProtectionId(vaultDbIndex),
                                vaultDbIndex,
                                protectionHkdfKey: factorHkdfKey,
                            }),
                        ),
                    );
            });
        this.version(3).stores({
            [LEGACY_DEVICE_PROTECTION_STORE]: null,
            [DEVICE_PROTECTION_STORE]: "id, vaultDbIndex",
        });
    }
}

export const keyStoreDb = new VaultKeyStoreDatabase();

export async function setDeviceAdditionalKeyProtectionKey(
    vaultDbIndex: number,
    protectionHkdfKey: VaultHkdfKey | null,
    kind: VaultUtilTypes.AdditionalKeyProtectionKind,
    webauthnCredentialId?: string,
    webauthnPrfSalt?: string,
): Promise<void> {
    await keyStoreDb.deviceAdditionalKeyProtections.put({
        id: additionalKeyProtectionId(vaultDbIndex),
        vaultDbIndex,
        kind,
        protectionHkdfKey,
        webauthnCredentialId,
        webauthnPrfSalt,
    });
}

export async function getDeviceAdditionalKeyProtectionKey(
    vaultDbIndex: number,
): Promise<VaultHkdfKey | null> {
    const rec = await keyStoreDb.deviceAdditionalKeyProtections.get(
        additionalKeyProtectionId(vaultDbIndex),
    );
    return rec?.protectionHkdfKey ?? null;
}

export async function getDeviceAdditionalKeyProtectionKind(
    vaultDbIndex: number,
): Promise<VaultUtilTypes.AdditionalKeyProtectionKind | null> {
    const rec = await keyStoreDb.deviceAdditionalKeyProtections.get(
        additionalKeyProtectionId(vaultDbIndex),
    );
    return rec?.kind ?? null;
}

export async function clearDeviceAdditionalKeyProtection(
    vaultDbIndex: number,
): Promise<void> {
    await keyStoreDb.deviceAdditionalKeyProtections.delete(
        additionalKeyProtectionId(vaultDbIndex),
    );
}

/** Re-export vault DB for callers that need both. */
export { vaultDb };
