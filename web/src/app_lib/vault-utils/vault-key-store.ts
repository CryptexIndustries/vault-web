/**
 * Local IndexedDB storage for device-bound 2FA keys.
 * Never synced; cleared on lock.
 */

import Dexie from "dexie";
import * as VaultUtilTypes from "@cryptex-industries/vault-core/proto";
import { db as vaultDb } from "./storage";

export interface DeviceSecondFactorRecord {
    id: string;
    vaultDbIndex: number;
    kind: VaultUtilTypes.SecondFactorKind;
    /** Null for WebAuthn PRF: key reproduced via authenticator each unlock. */
    factorHkdfKey: CryptoKey | null;
    webauthnCredentialId?: string;
    /** Base64 PRF salt; required to reproduce PRF output on unlock. Not secret. */
    webauthnPrfSalt?: string;
}

const secondFactorId = (vaultDbIndex: number) => `sf:${vaultDbIndex}`;

export class VaultKeyStoreDatabase extends Dexie {
    public deviceSecondFactors!: Dexie.Table<DeviceSecondFactorRecord, string>;

    constructor() {
        super("vaultKeyStore");
        this.version(1).stores({
            deviceSecondFactors: "id, vaultDbIndex",
        });
    }
}

export const keyStoreDb = new VaultKeyStoreDatabase();

export async function setDeviceSecondFactorKey(
    vaultDbIndex: number,
    factorHkdfKey: CryptoKey | null,
    kind: VaultUtilTypes.SecondFactorKind,
    webauthnCredentialId?: string,
    webauthnPrfSalt?: string,
): Promise<void> {
    await keyStoreDb.deviceSecondFactors.put({
        id: secondFactorId(vaultDbIndex),
        vaultDbIndex,
        kind,
        factorHkdfKey,
        webauthnCredentialId,
        webauthnPrfSalt,
    });
}

export async function getDeviceSecondFactorKey(
    vaultDbIndex: number,
): Promise<CryptoKey | null> {
    const rec = await keyStoreDb.deviceSecondFactors.get(
        secondFactorId(vaultDbIndex),
    );
    return rec?.factorHkdfKey ?? null;
}

export async function getDeviceSecondFactorKind(
    vaultDbIndex: number,
): Promise<VaultUtilTypes.SecondFactorKind | null> {
    const rec = await keyStoreDb.deviceSecondFactors.get(
        secondFactorId(vaultDbIndex),
    );
    return rec?.kind ?? null;
}

export async function clearDeviceSecondFactor(
    vaultDbIndex: number,
): Promise<void> {
    await keyStoreDb.deviceSecondFactors.delete(secondFactorId(vaultDbIndex));
}

/** Re-export vault DB for callers that need both. */
export { vaultDb };
