import { describe, expect, it, jest } from "@jest/globals";

import {
    flushManagedBackupBeforeLock,
    markManagedBackupDirty,
    queueManagedBackupNow,
    registerManagedBackupHooks,
    stopManagedBackup,
    VAULT_SECURITY_BACKUP_EVENT,
    type VaultSecurityBackupEventDetail,
} from "../../src/app_lib/managed-backup-hooks";
import { ManagedBackupError } from "../../src/app_lib/managed-backup-errors";

describe("managed backup persistence hooks", () => {
    it("delegates mutation, lock flush, and stop without exposing vault material", async () => {
        const markDirty = jest.fn();
        const backupNow = jest.fn(async () => undefined);
        const flushBeforeLock = jest.fn(async () => undefined);
        const stop = jest.fn();
        registerManagedBackupHooks({
            markDirty,
            backupNow,
            flushBeforeLock,
            stop,
        });

        markManagedBackupDirty();
        queueManagedBackupNow(true);
        await flushManagedBackupBeforeLock();
        stopManagedBackup();

        expect(markDirty).toHaveBeenCalledTimes(1);
        expect(backupNow).toHaveBeenCalledWith(true);
        expect(flushBeforeLock).toHaveBeenCalledTimes(1);
        expect(stop).toHaveBeenCalledTimes(1);
    });

    it("waits for the pre-lock flush to finish", async () => {
        let release!: () => void;
        let finished = false;
        const flushBeforeLock = jest.fn(
            () =>
                new Promise<void>((resolve) => {
                    release = () => {
                        finished = true;
                        resolve();
                    };
                }),
        );

        registerManagedBackupHooks({
            markDirty: jest.fn(),
            backupNow: jest.fn(async () => undefined),
            flushBeforeLock,
            stop: jest.fn(),
        });

        const pending = flushManagedBackupBeforeLock();
        await Promise.resolve();
        expect(finished).toBe(false);

        release();
        await expect(pending).resolves.toBeUndefined();
        expect(finished).toBe(true);
    });

    it("propagates a pre-lock flush failure", async () => {
        const error = new Error("flush failed");
        registerManagedBackupHooks({
            markDirty: jest.fn(),
            backupNow: jest.fn(async () => undefined),
            flushBeforeLock: jest.fn(async () => {
                throw error;
            }),
            stop: jest.fn(),
        });

        await expect(flushManagedBackupBeforeLock()).rejects.toBe(error);
    });

    it("uses the most recently registered hooks", async () => {
        const first = {
            markDirty: jest.fn(),
            backupNow: jest.fn(async () => undefined),
            flushBeforeLock: jest.fn(async () => undefined),
            stop: jest.fn(),
        };
        const second = {
            markDirty: jest.fn(),
            backupNow: jest.fn(async () => undefined),
            flushBeforeLock: jest.fn(async () => undefined),
            stop: jest.fn(),
        };

        registerManagedBackupHooks(first);
        registerManagedBackupHooks(second);

        markManagedBackupDirty();
        await flushManagedBackupBeforeLock();
        stopManagedBackup();

        expect(first.markDirty).not.toHaveBeenCalled();
        expect(first.flushBeforeLock).not.toHaveBeenCalled();
        expect(first.stop).not.toHaveBeenCalled();
        expect(second.markDirty).toHaveBeenCalledTimes(1);
        expect(second.flushBeforeLock).toHaveBeenCalledTimes(1);
        expect(second.stop).toHaveBeenCalledTimes(1);
    });

    it("reports a security-change backup failure without rejecting the local change", async () => {
        registerManagedBackupHooks({
            markDirty: jest.fn(),
            backupNow: jest.fn(async () => {
                throw new ManagedBackupError("BACKUP_UPLOAD_NETWORK");
            }),
            flushBeforeLock: jest.fn(async () => undefined),
            stop: jest.fn(),
        });
        const listener = jest.fn<(event: Event) => void>();
        window.addEventListener(VAULT_SECURITY_BACKUP_EVENT, listener);

        queueManagedBackupNow(false);
        await Promise.resolve();
        await Promise.resolve();

        expect(listener).toHaveBeenCalledTimes(1);
        const event = listener.mock.calls[0]?.[0];
        if (!(event instanceof CustomEvent)) {
            throw new Error("Expected a security backup event");
        }
        const detail = event.detail as VaultSecurityBackupEventDetail;
        expect(detail.status).toBe("error");
        expect(detail.message).toContain("Could not reach");
        window.removeEventListener(VAULT_SECURITY_BACKUP_EVENT, listener);
    });

    it("reports disabled managed backups as skipped rather than a local failure", async () => {
        registerManagedBackupHooks({
            markDirty: jest.fn(),
            backupNow: jest.fn(async () => {
                throw new ManagedBackupError("BACKUP_NOT_ENABLED");
            }),
            flushBeforeLock: jest.fn(async () => undefined),
            stop: jest.fn(),
        });
        const listener = jest.fn<(event: Event) => void>();
        window.addEventListener(VAULT_SECURITY_BACKUP_EVENT, listener);

        queueManagedBackupNow(false);
        await Promise.resolve();
        await Promise.resolve();

        const event = listener.mock.calls[0]?.[0];
        if (!(event instanceof CustomEvent)) {
            throw new Error("Expected a security backup event");
        }
        const detail = event.detail as VaultSecurityBackupEventDetail;
        expect(detail.status).toBe("skipped");
        window.removeEventListener(VAULT_SECURITY_BACKUP_EVENT, listener);
    });
});
