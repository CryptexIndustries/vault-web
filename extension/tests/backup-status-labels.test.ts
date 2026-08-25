import { describe, expect, it } from "@jest/globals";

import {
    accountRecoveryProtectionLabel,
    backupStorageUsage,
    hasBackupHistoryAccess,
} from "../src/utils/backup-status-labels";

describe("backup history access", () => {
    const now = new Date("2026-08-08T10:00:00.000Z");

    it("allows entitled accounts", () => {
        expect(
            hasBackupHistoryAccess(
                { entitled: true, graceExpiresAt: null },
                now,
            ),
        ).toBe(true);
    });

    it("allows downloads during the grace window", () => {
        expect(
            hasBackupHistoryAccess(
                {
                    entitled: false,
                    graceExpiresAt: new Date("2026-08-09T00:00:00.000Z"),
                },
                now,
            ),
        ).toBe(true);
    });

    it("hides history after grace expires", () => {
        expect(
            hasBackupHistoryAccess(
                {
                    entitled: false,
                    graceExpiresAt: new Date("2026-08-07T00:00:00.000Z"),
                },
                now,
            ),
        ).toBe(false);
    });
});

describe("backup status labels", () => {
    it("labels account recovery protection states", () => {
        expect(accountRecoveryProtectionLabel("protected")).toBe("Protected");
        expect(accountRecoveryProtectionLabel("pending")).toBe(
            "Pending first root backup",
        );
        expect(accountRecoveryProtectionLabel("degraded")).toBe("Degraded");
        expect(accountRecoveryProtectionLabel("none")).toBe("Unavailable");
    });

    it("formats encrypted storage usage", () => {
        expect(backupStorageUsage(512 * 1024, 1024 * 1024)).toEqual({
            percent: 50,
            percentLabel: "50",
            sizeLabel: "512.0 KiB",
        });
    });
});
