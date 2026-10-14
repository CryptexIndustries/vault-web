/**
 * @jest-environment node
 */
import { describe, expect, it } from "@jest/globals";
import { webcrypto } from "crypto";

Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    writable: true,
});

import type * as VaultUtilTypes from "../proto/vault";
import {
    countShareListRows,
    pruneEndedShareLinks,
    queryShareListRows,
    SHARE_LINK_RETENTION_MS,
    toShareListRows,
} from "../vault-utils/share-list";
import {
    createShareLinkRecord,
    SHARE_TOMBSTONE_VERSION_BUMP,
} from "../vault-utils/share-records";
import {
    refreshShareStatuses,
    SHARE_STATUS_BATCH_SIZE,
} from "../vault-utils/share-service";

const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

const id = (n: number) => `share-${String(n).padStart(16, "0")}`;

async function record(
    n: number,
    overrides: Partial<VaultUtilTypes.ShareLink> = {},
): Promise<VaultUtilTypes.ShareLink> {
    const base = await createShareLinkRecord({
        id: id(n),
        serverOrigin:
            n % 2
                ? "https://www.cryptex-vault.com"
                : "https://vault.example.com",
        manageToken: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        credentialId: n % 3 ? `cred-${n}` : "",
        label: n % 5 ? "" : `Label ${n}`,
        expiresAt: NOW + (n + 1) * 60_000,
        passphrase: false,
        now: NOW - n * 60_000,
    });
    return { ...base, ...overrides };
}

const names = new Map(
    Array.from({ length: 1000 }, (_, n) => [`cred-${n}`, `Item ${n}`]),
);

describe("shared links list", () => {
    it("counts, filters, searches and sorts 1000 mixed records", async () => {
        const records = await Promise.all(
            Array.from({ length: 1000 }, (_, n) =>
                record(
                    n,
                    n % 4 === 0
                        ? { Status: "viewed", ViewedAtTimestamp: NOW - DAY }
                        : n % 4 === 1
                          ? { Status: "revoked" }
                          : n % 4 === 2
                            ? { ExpiresAtTimestamp: NOW - 1 }
                            : {},
                ),
            ),
        );
        const rows = toShareListRows(records, names, NOW);

        expect(countShareListRows(rows)).toEqual({
            active: 250,
            viewed: 250,
            expired: 250,
            revoked: 250,
            burned: 0,
        });
        expect(
            queryShareListRows(rows, {
                query: "",
                statuses: [],
                sort: "newest",
            }),
        ).toHaveLength(1000);
        const ended = queryShareListRows(rows, {
            query: "",
            statuses: ["expired", "revoked"],
            sort: "newest",
        });
        expect(ended).toHaveLength(500);
        expect(
            ended.every(
                (row) => row.status === "expired" || row.status === "revoked",
            ),
        ).toBe(true);

        const started = performance.now();
        const active = queryShareListRows(rows, {
            query: "",
            statuses: ["active"],
            sort: "expiring",
        });
        expect(performance.now() - started).toBeLessThan(100);
        expect(active).toHaveLength(250);
        expect(active.map((row) => row.record.ExpiresAtTimestamp)).toEqual(
            [...active.map((row) => row.record.ExpiresAtTimestamp)].sort(
                (a, b) => a - b,
            ),
        );

        const search = queryShareListRows(rows, {
            query: "item 99 example",
            statuses: [],
            sort: "name",
        });
        // Items 992, 994 and 998: unlabelled, on the example host.
        expect(search.map((row) => row.name)).toEqual([
            "Item 992",
            "Item 994",
            "Item 998",
        ]);
        expect(search.every((row) => row.host === "vault.example.com")).toBe(
            true,
        );
        expect(search.every((row) => row.name.includes("Item 99"))).toBe(true);
        expect(search.map((row) => row.name)).toEqual(
            [...search.map((row) => row.name)].sort((a, b) =>
                a.localeCompare(b),
            ),
        );

        const newest = queryShareListRows(rows, {
            query: "",
            statuses: [],
            sort: "newest",
        });
        expect(newest[0]!.record.ID).toBe(id(0));
        const oldest = queryShareListRows(rows, {
            query: "",
            statuses: [],
            sort: "oldest",
        });
        expect(oldest[0]!.record.ID).toBe(id(999));
    });

    it("names rows by label, item, or what they were", async () => {
        const rows = toShareListRows(
            [
                await record(5),
                await record(1),
                await record(3, { CredentialID: "gone" }),
                await record(6),
            ],
            names,
            NOW,
        );
        expect(rows.map((row) => row.name)).toEqual([
            "Label 5",
            "Item 1",
            "Deleted item",
            "Secret",
        ]);
    });

    it("hides tombstones", async () => {
        const rows = toShareListRows(
            [await record(1, { Deleted: true })],
            names,
            NOW,
        );
        expect(rows).toEqual([]);
    });
});

describe("retention", () => {
    it("turns links that ended over 90 days ago into tombstones", async () => {
        const old = NOW - SHARE_LINK_RETENTION_MS - DAY;
        const recent = NOW - DAY;
        const records = [
            await record(1, { Status: "viewed", ViewedAtTimestamp: old }),
            await record(2, { Status: "viewed", ViewedAtTimestamp: recent }),
            await record(3, { ExpiresAtTimestamp: old }),
            await record(4, { Status: "revoked", DateModifiedTimestamp: old }),
            await record(5),
        ];

        const pruned = await pruneEndedShareLinks(records, NOW);

        expect(pruned.map((item) => item.Deleted)).toEqual([
            true,
            false,
            true,
            true,
            false,
        ]);
        expect(pruned[0]).toMatchObject({
            ManageToken: "",
            CredentialID: "",
            Label: "",
            Version: records[0]!.Version + SHARE_TOMBSTONE_VERSION_BUMP,
        });
        expect(pruned[1]).toBe(records[1]);
        expect(pruned[4]).toBe(records[4]);
    });

    it("returns the same array when nothing is old enough", async () => {
        const records = [await record(1), await record(2)];
        expect(await pruneEndedShareLinks(records, NOW)).toBe(records);
    });
});

describe("status refresh", () => {
    it("asks in batches the server accepts and skips writes when nothing changed", async () => {
        const records = await Promise.all(
            Array.from({ length: 450 }, (_, n) =>
                record(n * 2 + 1, {
                    ServerOrigin: "https://vault.example.com",
                }),
            ),
        );
        const batchSizes: number[] = [];
        let writes = 0;
        const fetchImpl = (async (_url: string, init: RequestInit) => {
            const body = JSON.parse(init.body as string) as {
                shares: { id: string }[];
            };
            batchSizes.push(body.shares.length);
            return new Response(
                JSON.stringify({
                    shares: body.shares.map((share) => ({
                        id: share.id,
                        status: "active",
                        expiresAt: null,
                        viewedAt: null,
                    })),
                }),
            );
        }) as unknown as typeof fetch;

        await refreshShareStatuses(
            {
                store: {
                    getShareLinks: async () => records,
                    updateShareLinks: async () => {
                        writes += 1;
                    },
                    getShareSettings: async () => undefined,
                },
                defaultOrigin: "https://vault.example.com",
                fetch: fetchImpl,
            },
            NOW,
        );

        expect(batchSizes).toEqual([
            SHARE_STATUS_BATCH_SIZE,
            SHARE_STATUS_BATCH_SIZE,
            50,
        ]);
        expect(writes).toBe(0);
    });
});
