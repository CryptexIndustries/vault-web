/**
 * @jest-environment node
 */
import { describe, expect, it } from "@jest/globals";
import { webcrypto } from "crypto";

Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    writable: true,
});

import { SyncItemType } from "../proto/vault";
import { selectSyncItems } from "../sync-operations";
import {
    applyShareStatusReports,
    createShareLinkRecord,
    dismissShareLinkRecord,
    displayShareStatus,
    isValidShareServerOrigin,
    mergeReceivedShareLinks,
    SHARE_TOMBSTONE_VERSION_BUMP,
    updateShareLinkRecord,
    visibleShareLinks,
} from "../vault-utils/share-records";

const record = (id: string, now = 1_000) =>
    createShareLinkRecord({
        id,
        serverOrigin: "https://www.cryptex-vault.com/app",
        manageToken: "manage",
        credentialId: "cred",
        label: "Router",
        expiresAt: now + 3_600_000,
        passphrase: false,
        now,
    });

describe("share link records", () => {
    it("starts active and stores only the origin", async () => {
        const created = await record("share-a");

        expect(created).toMatchObject({
            ServerOrigin: "https://www.cryptex-vault.com",
            Status: "active",
            Version: 0,
            Deleted: false,
        });
        expect(created.Hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("bumps the version only when something changes", async () => {
        const created = await record("share-a");

        expect(await updateShareLinkRecord(created, { Status: "active" })).toBe(
            created,
        );
        const viewed = await updateShareLinkRecord(
            created,
            { Status: "viewed", ViewedAtTimestamp: 5_000 },
            6_000,
        );
        expect(viewed).toMatchObject({
            Version: 1,
            DateModifiedTimestamp: 6_000,
            Status: "viewed",
        });
        expect(viewed.Hash).not.toBe(created.Hash);
    });

    it("never moves a final status back to active", async () => {
        const viewed = await updateShareLinkRecord(await record("share-a"), {
            Status: "viewed",
        });
        const [unchanged] = await applyShareStatusReports(
            [viewed],
            [
                {
                    origin: "https://www.cryptex-vault.com",
                    id: "share-a",
                    status: "revoked",
                    viewedAt: null,
                },
            ],
        );

        expect(unchanged).toBe(viewed);
    });

    it("applies server reports and maps unknown to expired", async () => {
        const [a, b, c] = await applyShareStatusReports(
            [await record("a"), await record("b"), await record("c")],
            [
                {
                    origin: "https://www.cryptex-vault.com",
                    id: "a",
                    status: "viewed",
                    viewedAt: 2_000,
                },
                {
                    origin: "https://www.cryptex-vault.com",
                    id: "b",
                    status: "unknown",
                    viewedAt: null,
                },
                {
                    origin: "https://www.cryptex-vault.com",
                    id: "c",
                    status: "active",
                    viewedAt: null,
                },
            ],
        );

        expect(a).toMatchObject({ Status: "viewed", ViewedAtTimestamp: 2_000 });
        expect(b).toMatchObject({ Status: "expired" });
        expect(c).toMatchObject({ Status: "active", Version: 0 });
    });

    it("shows a passed expiry as expired before the server confirms it", async () => {
        const created = await record("share-a", 1_000);

        expect(displayShareStatus(created, 2_000)).toBe("active");
        expect(displayShareStatus(created, 1_000 + 3_600_000)).toBe("expired");
    });

    it("drops the manage token when dismissed", async () => {
        const dismissed = await dismissShareLinkRecord(await record("share-a"));

        expect(dismissed).toMatchObject({
            Deleted: true,
            ManageToken: "",
            Label: "",
            CredentialID: "",
            Version: SHARE_TOMBSTONE_VERSION_BUMP,
        });
        expect(visibleShareLinks([dismissed])).toEqual([]);
    });

    it("merges synced records by version", async () => {
        const local = await record("a");
        const newer = await updateShareLinkRecord(local, { Status: "revoked" });
        const remoteOnly = await record("b", 5_000);

        const merged = mergeReceivedShareLinks([local], [newer, remoteOnly]);

        expect(merged).toEqual([newer, remoteOnly]);
        expect(mergeReceivedShareLinks([newer], [local])).toEqual([newer]);
        expect(visibleShareLinks(merged).map((item) => item.ID)).toEqual([
            "b",
            "a",
        ]);
    });

    it("only applies a report to the server that sent it", async () => {
        const [a] = await applyShareStatusReports(
            [await record("a")],
            [
                {
                    origin: "https://evil.example.com",
                    id: "a",
                    status: "revoked",
                    viewedAt: null,
                },
            ],
        );
        expect(a).toMatchObject({ Status: "active", Version: 0 });
    });

    it("keeps a removal even when another device refreshed the link", async () => {
        const base = await record("a");
        const removed = await dismissShareLinkRecord(base);
        const refreshedElsewhere = await updateShareLinkRecord(
            base,
            { Status: "expired" },
            base.DateModifiedTimestamp + 60_000,
        );

        // Both directions converge on the tombstone.
        expect(
            mergeReceivedShareLinks([removed], [refreshedElsewhere]),
        ).toEqual([removed]);
        expect(
            mergeReceivedShareLinks([refreshedElsewhere], [removed]),
        ).toEqual([removed]);
    });

    it("refuses synced records that move a link or swap its token", async () => {
        const local = await record("a");
        const moved = await updateShareLinkRecord(
            { ...local, ServerOrigin: "https://evil.example.com" },
            { Status: "active", Label: "x" },
        );
        const swapped = await updateShareLinkRecord(
            { ...local, ManageToken: "other" },
            { Label: "x" },
        );

        expect(mergeReceivedShareLinks([local], [moved])).toEqual([local]);
        expect(mergeReceivedShareLinks([local], [swapped])).toEqual([local]);
        const unsafe = {
            ...(await record("b")),
            ServerOrigin: "http://evil.example.com",
        };
        expect(mergeReceivedShareLinks([], [unsafe])).toEqual([]);
    });

    it("accepts HTTPS share servers and local development hosts only", () => {
        expect(isValidShareServerOrigin("https://vault.example.com")).toBe(
            true,
        );
        expect(isValidShareServerOrigin("http://localhost:3000")).toBe(true);
        expect(isValidShareServerOrigin("http://10.0.2.2:3000")).toBe(true);
        expect(isValidShareServerOrigin("http://vault.example.com")).toBe(
            false,
        );
        expect(isValidShareServerOrigin("https://vault.example.com/x")).toBe(
            false,
        );
        expect(isValidShareServerOrigin("javascript:alert(1)")).toBe(false);
    });

    it("selects requested share records for sync", async () => {
        const a = await record("a");
        const b = await record("b");

        expect(
            selectSyncItems(
                { Credentials: [], Directories: [], ShareLinks: [a, b] },
                [{ Type: SyncItemType.ShareLinkItem, ID: "b" }],
            ),
        ).toEqual({
            Credentials: [],
            Directories: [],
            ShareLinks: [b],
            ConnectedAgents: [],
            BackupDestinations: [],
        });
    });
});
