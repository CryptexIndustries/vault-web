import { beforeEach, describe, expect, it } from "@jest/globals";
import { webcrypto } from "node:crypto";
import { TextDecoder, TextEncoder } from "node:util";

Object.defineProperties(globalThis, {
    crypto: { value: webcrypto, configurable: true },
    TextEncoder: { value: TextEncoder, configurable: true },
    TextDecoder: { value: TextDecoder, configurable: true },
});

import {
    BACKUP_REMINDER_AFTER_MS,
    formatBackupAge,
    getBackupOverview,
    getLocalBackupReceipt,
    recordLocalBackupCompleted,
} from "../../src/app_lib/backup-status";

describe("backup status", () => {
    beforeEach(() => localStorage.clear());

    it("uses the newest local or managed backup", () => {
        const localBackupAt = new Date("2026-07-01T10:00:00.000Z");
        const managedBackupAt = new Date("2026-07-02T10:00:00.000Z");

        expect(
            getBackupOverview({
                localBackupAt,
                managedBackupAt,
                managedEnabled: true,
                managedEntitled: true,
            }),
        ).toMatchObject({
            latestBackupAt: managedBackupAt,
            latestSource: "managed",
            needsReminder: false,
        });
    });

    it("reminds users after 30 days when managed backups are off", () => {
        const now = new Date("2026-08-08T10:00:00.000Z");
        const localBackupAt = new Date(
            now.getTime() - BACKUP_REMINDER_AFTER_MS,
        );

        expect(
            getBackupOverview({
                localBackupAt,
                managedBackupAt: null,
                managedEnabled: false,
                managedEntitled: true,
                now,
            }).needsReminder,
        ).toBe(true);
    });

    it("does not show the age reminder while managed backups are active", () => {
        expect(
            getBackupOverview({
                localBackupAt: null,
                managedBackupAt: null,
                managedEnabled: true,
                managedEntitled: true,
            }).needsReminder,
        ).toBe(false);
    });

    it("does not remind users without confirmed Premium entitlement", () => {
        expect(
            getBackupOverview({
                localBackupAt: null,
                managedBackupAt: null,
                managedEnabled: false,
                managedEntitled: false,
            }).needsReminder,
        ).toBe(false);
    });

    it("authenticates backup completion for its vault state", async () => {
        const completedAt = new Date("2026-08-08T10:00:00.000Z");
        const source = new Uint8Array([1, 2, 3]);
        const dek = await crypto.subtle.generateKey(
            { name: "AES-GCM", length: 256 },
            false,
            ["encrypt", "decrypt"],
        );

        await recordLocalBackupCompleted("vault-one", source, dek, completedAt);

        await expect(
            getLocalBackupReceipt("vault-one", source, dek),
        ).resolves.toEqual({ completedAt, isCurrent: true });
        await expect(
            getLocalBackupReceipt("vault-one", new Uint8Array([9]), dek),
        ).resolves.toEqual({ completedAt, isCurrent: false });
    });

    it("rejects a forged local receipt", async () => {
        const source = new Uint8Array([1, 2, 3]);
        const dek = await crypto.subtle.generateKey(
            { name: "AES-GCM", length: 256 },
            false,
            ["encrypt", "decrypt"],
        );
        await recordLocalBackupCompleted("vault-one", source, dek);
        const key = "cryptex:local-backup-receipt:vault-one";
        const stored = localStorage.getItem(key)!;
        const last = stored.at(-1) === "A" ? "B" : "A";
        localStorage.setItem(key, `${stored.slice(0, -1)}${last}`);

        await expect(
            getLocalBackupReceipt("vault-one", source, dek),
        ).resolves.toBeNull();
    });

    it("formats recent backup ages for compact status labels", () => {
        const now = new Date("2026-08-08T10:00:00.000Z");

        expect(formatBackupAge(new Date(now.getTime() - 45_000), now)).toBe(
            "just now",
        );
        expect(
            formatBackupAge(new Date(now.getTime() - 3 * 60 * 60 * 1000), now),
        ).toBe("3h ago");
    });
});
