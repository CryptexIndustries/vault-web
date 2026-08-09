import { describe, expect, it, jest } from "@jest/globals";

import {
    flushManagedBackupBeforeLock,
    markManagedBackupDirty,
    registerManagedBackupHooks,
    stopManagedBackup,
} from "../../src/app_lib/managed-backup-hooks";

describe("managed backup persistence hooks", () => {
    it("delegates mutation, lock flush, and stop without exposing vault material", async () => {
        const markDirty = jest.fn();
        const flushBeforeLock = jest.fn(async () => undefined);
        const stop = jest.fn();
        registerManagedBackupHooks({ markDirty, flushBeforeLock, stop });

        markManagedBackupDirty();
        await flushManagedBackupBeforeLock();
        stopManagedBackup();

        expect(markDirty).toHaveBeenCalledTimes(1);
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
            flushBeforeLock: jest.fn(async () => undefined),
            stop: jest.fn(),
        };
        const second = {
            markDirty: jest.fn(),
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
});
