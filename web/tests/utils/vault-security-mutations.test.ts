/** @jest-environment jsdom */
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { webcrypto } from "node:crypto";
import { err, ok } from "neverthrow";

Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: webcrypto,
});

import type { VaultMetadata } from "../../src/app_lib/vault-utils/storage";
import { registerManagedBackupHooks } from "../../src/app_lib/managed-backup-hooks";
import {
    unlockedVaultAtom,
    unlockedVaultMetadataAtom,
    vaultStore,
} from "../../src/utils/atoms";
import { persistVaultMutation } from "../../src/utils/vault-mutations";
import {
    reconfigureUnlockedVaultSecurity,
    rotateUnlockedVaultRecoveryCode,
} from "../../src/utils/vault-security-mutations";
import {
    clearVaultDEKFromSession,
    getVaultDEKFromSession,
    setVaultDEKInSession,
} from "../../src/utils/vault-session";
import { Vault } from "@cryptex-industries/vault-core/vault-utils/vault";
import { AdditionalKeyProtectionKind } from "@cryptex-industries/vault-core/proto";

const backupNowMock = jest.fn(async (_deleteOlder: boolean) => undefined);

const securityParams = {
    currentMasterPassword: "current",
    additionalKeyProtection: {
        kind: AdditionalKeyProtectionKind.NONE as const,
    },
};

describe("unlocked vault security mutations", () => {
    beforeEach(async () => {
        jest.clearAllMocks();
        clearVaultDEKFromSession();
        setVaultDEKInSession(
            await crypto.subtle.generateKey(
                { name: "AES-GCM", length: 256 },
                false,
                ["encrypt", "decrypt"],
            ),
        );
        vaultStore.set(unlockedVaultAtom, new Vault());
        vaultStore.set(unlockedVaultMetadataAtom, null);
        registerManagedBackupHooks({
            markDirty: jest.fn(),
            backupNow: backupNowMock,
            flushBeforeLock: jest.fn(async () => undefined),
            stop: jest.fn(),
        });
    });

    it("shares the single-writer queue with ordinary vault mutations", async () => {
        let releaseSave!: () => void;
        const saveGate = new Promise<void>((resolve) => {
            releaseSave = resolve;
        });
        let saveStarted!: () => void;
        const started = new Promise<void>((resolve) => {
            saveStarted = resolve;
        });
        const reconfigureSecurity = jest.fn(async () =>
            ok({
                dataKeyRotated: false,
                recoveryCode: "",
                additionalKeyProtectionKind: AdditionalKeyProtectionKind.NONE,
            }),
        );
        const metadata = {
            save: jest.fn(async () => {
                saveStarted();
                await saveGate;
            }),
            reconfigureSecurity,
        } as unknown as VaultMetadata;
        vaultStore.set(unlockedVaultMetadataAtom, metadata);

        const ordinaryWrite = persistVaultMutation(
            "credential.upsert",
            (vault) => ({ vault, result: undefined }),
        );
        const securityWrite = reconfigureUnlockedVaultSecurity(securityParams);
        await started;

        expect(reconfigureSecurity).not.toHaveBeenCalled();
        releaseSave();
        await ordinaryWrite;
        await securityWrite;

        expect(reconfigureSecurity).toHaveBeenCalledTimes(1);
        expect(backupNowMock).toHaveBeenCalledWith(false);
    });

    it("replaces the session DEK and publishes metadata only after success", async () => {
        const previousDek = getVaultDEKFromSession()._unsafeUnwrap();
        const nextDek = await crypto.subtle.generateKey(
            { name: "AES-GCM", length: 256 },
            false,
            ["encrypt", "decrypt"],
        );
        const metadata = {
            Name: "Vault",
            reconfigureSecurity: jest.fn(async () =>
                ok({
                    dataKeyRotated: true,
                    recoveryCode: "new-code",
                    additionalKeyProtectionKind:
                        AdditionalKeyProtectionKind.NONE,
                    sessionDek: nextDek,
                }),
            ),
        } as unknown as VaultMetadata;
        vaultStore.set(unlockedVaultMetadataAtom, metadata);

        const result = await reconfigureUnlockedVaultSecurity({
            ...securityParams,
            rotateDataKey: true,
            deleteOlderManagedBackups: true,
        });

        expect(result.isOk() && result.value).toEqual({
            dataKeyRotated: true,
            recoveryCode: "new-code",
            additionalKeyProtectionKind: AdditionalKeyProtectionKind.NONE,
        });
        expect(getVaultDEKFromSession()._unsafeUnwrap()).toBe(nextDek);
        expect(getVaultDEKFromSession()._unsafeUnwrap()).not.toBe(previousDek);
        expect(vaultStore.get(unlockedVaultMetadataAtom)).not.toBe(metadata);
        expect(vaultStore.get(unlockedVaultMetadataAtom)?.Name).toBe("Vault");
        expect(backupNowMock).toHaveBeenCalledWith(true);
    });

    it("does not publish, replace the key, or queue backup after failure", async () => {
        const currentDek = getVaultDEKFromSession()._unsafeUnwrap();
        const metadata = {
            reconfigureSecurity: jest.fn(async () => err("DEK_UNWRAP_FAILED")),
        } as unknown as VaultMetadata;
        vaultStore.set(unlockedVaultMetadataAtom, metadata);

        const result = await reconfigureUnlockedVaultSecurity(securityParams);

        expect(result.isErr() && result.error).toBe("DEK_UNWRAP_FAILED");
        expect(vaultStore.get(unlockedVaultMetadataAtom)).toBe(metadata);
        expect(getVaultDEKFromSession()._unsafeUnwrap()).toBe(currentDek);
        expect(backupNowMock).not.toHaveBeenCalled();
    });

    it("routes recovery-code changes through their dedicated write kind", async () => {
        const resetRecoveryCode = jest.fn(async () =>
            ok({
                dataKeyRotated: false,
                recoveryCode: "replacement",
                additionalKeyProtectionKind: AdditionalKeyProtectionKind.NONE,
            }),
        );
        vaultStore.set(unlockedVaultMetadataAtom, {
            resetRecoveryCode,
        } as unknown as VaultMetadata);

        const result = await rotateUnlockedVaultRecoveryCode({
            currentMasterPassword: "current",
        });

        expect(result.isOk() && result.value.recoveryCode).toBe("replacement");
        expect(resetRecoveryCode).toHaveBeenCalledWith({
            currentMasterPassword: "current",
        });
    });
});
