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
    createShareLink,
    dismissShareLink,
    refreshShareStatuses,
    revokeShareLink,
    ShareSetupError,
    ticketAudience,
    type ShareServiceDeps,
} from "../vault-utils/share-service";
import { openSharePayload, parseShareLink } from "../vault-utils/share-link";
import { base64UrlToUint8, uint8ToBase64Url } from "../encoding";

/** Same shape as a backend ticket; the client never checks the signature. */
const ticketFor = (claims: object) =>
    `${uint8ToBase64Url(new TextEncoder().encode(JSON.stringify(claims)))}.c2ln`;

type Call = { path: string; body: any; authorization?: string };

function fakeServer(
    auth: "ticket" | "token",
    options: { maxTtl?: number; extraStatus?: object[] } = {},
) {
    const calls: Call[] = [];
    const shares = new Map<string, { ciphertext: string; status: string }>();
    const fetchImpl = (async (url: string, init: RequestInit) => {
        const path = new URL(url).pathname.replace("/share-api/v1", "");
        const body = init.body ? JSON.parse(init.body as string) : undefined;
        calls.push({
            path,
            body,
            authorization: (init.headers as Record<string, string>)
                .Authorization,
        });
        const json = (status: number, value: unknown) =>
            new Response(value === null ? null : JSON.stringify(value), {
                status,
            });
        if (path === "/info") {
            return json(200, {
                version: 1,
                auth,
                maxBytes: 4096,
                maxTtl: options.maxTtl ?? 604800,
            });
        }
        if (path === "/shares") {
            const id = `share${shares.size}`.padEnd(22, "x");
            shares.set(id, { ciphertext: body.ciphertext, status: "active" });
            return json(201, { id, expiresAt: Date.now() + body.ttl * 1000 });
        }
        if (path === "/shares/status") {
            return json(200, {
                shares: [
                    ...body.shares.map((share: { id: string }) => ({
                        id: share.id,
                        status: shares.get(share.id)?.status ?? "unknown",
                        expiresAt: null,
                        viewedAt: null,
                    })),
                    ...(options.extraStatus ?? []),
                ],
            });
        }
        const revoke = path.match(/^\/shares\/(.+)\/revoke$/);
        if (revoke) {
            const share = shares.get(revoke[1]!)!;
            if (share.status === "active") share.status = "revoked";
            return json(200, {
                id: revoke[1],
                status: share.status,
                expiresAt: null,
                viewedAt: share.status === "viewed" ? 4_000 : null,
            });
        }
        return json(404, { error: "gone" });
    }) as unknown as typeof fetch;
    return { calls, shares, fetch: fetchImpl };
}

function memoryStore(settings?: VaultUtilTypes.ShareSettings) {
    let records: VaultUtilTypes.ShareLink[] = [];
    return {
        get records() {
            return records;
        },
        failNextSave: false,
        getShareLinks: async () => records,
        async updateShareLinks(
            update: (
                current: VaultUtilTypes.ShareLink[],
            ) => Promise<VaultUtilTypes.ShareLink[]>,
        ) {
            if (this.failNextSave) {
                this.failNextSave = false;
                throw new Error("save failed");
            }
            records = await update(records);
        },
        getShareSettings: async () => settings,
    };
}

const payload = {
    v: 1 as const,
    title: "Wi-Fi",
    fields: [{ label: "Secret", value: "hunter2", kind: "secret" as const }],
};

describe("share service", () => {
    it("creates a link with a ticket and stores the record", async () => {
        const server = fakeServer("ticket");
        const store = memoryStore();
        const ticket = ticketFor({
            v: 1,
            aud: "https://www.cryptex-vault.com",
        });
        const deps: ShareServiceDeps = {
            store,
            defaultOrigin: "https://www.cryptex-vault.com/app",
            fetch: server.fetch,
            getTicket: async () => ticket,
        };

        const { link, record } = await createShareLink(deps, {
            payload,
            label: "Wi-Fi",
            credentialId: "",
            ttlSeconds: 3600,
        });

        const create = server.calls.find((call) => call.path === "/shares")!;
        expect(create.authorization).toBe(`Ticket ${ticket}`);
        expect(create.body.passphrase).toBe(false);
        expect(store.records).toEqual([record]);

        const parsed = parseShareLink(link)!;
        expect(parsed.id).toBe(record.ID);
        const ciphertext = base64UrlToUint8(
            server.shares.get(record.ID)!.ciphertext,
        );
        await expect(
            openSharePayload(ciphertext, parsed.secret),
        ).resolves.toEqual(payload);
        // The manage token is stored; only its hash went to the server.
        expect(JSON.stringify(create.body)).not.toContain(record.ManageToken);
    });

    it("never hands a ticket to a server it wasn't issued for", async () => {
        for (const ticket of [
            ticketFor({ v: 1, aud: "https://www.cryptex-vault.com" }),
            ticketFor({ v: 1 }),
            "not-a-ticket",
            "bm90IGpzb24.c2ln",
        ]) {
            // A custom server that claims ticket auth.
            const server = fakeServer("ticket");
            await expect(
                createShareLink(
                    {
                        store: memoryStore({
                            ServerOrigin: "https://share.example.net",
                            CreationToken: "",
                        }),
                        defaultOrigin: "https://www.cryptex-vault.com",
                        fetch: server.fetch,
                        getTicket: async () => ticket,
                    },
                    {
                        payload,
                        label: "",
                        credentialId: "",
                        ttlSeconds: 3600,
                    },
                ),
            ).rejects.toEqual(
                new ShareSetupError("not_online_services_server"),
            );
            expect(server.calls.map((call) => call.path)).toEqual(["/info"]);
        }
    });

    it("doesn't spend a ticket on a share the server would refuse", async () => {
        let tickets = 0;
        await expect(
            createShareLink(
                {
                    store: memoryStore(),
                    defaultOrigin: "https://www.cryptex-vault.com",
                    fetch: fakeServer("ticket", { maxTtl: 3600 }).fetch,
                    getTicket: async () => {
                        tickets++;
                        return ticketFor({
                            aud: "https://www.cryptex-vault.com",
                        });
                    },
                },
                { payload, label: "", credentialId: "", ttlSeconds: 86400 },
            ),
        ).rejects.toEqual(new ShareSetupError("expiry_too_long"));
        expect(tickets).toBe(0);
    });

    it("cancels a link when the vault changes while it's created", async () => {
        const server = fakeServer("token");
        const vaults = ["vault-a", "vault-b"];
        const store = {
            ...memoryStore({ ServerOrigin: "", CreationToken: "operator" }),
            vaultKey: async () => vaults.shift(),
        };
        await expect(
            createShareLink(
                {
                    store,
                    defaultOrigin: "https://vault.example.com",
                    fetch: server.fetch,
                },
                { payload, label: "", credentialId: "", ttlSeconds: 3600 },
            ),
        ).rejects.toEqual(new ShareSetupError("vault_changed"));
        expect(store.records).toEqual([]);
        // The share was revoked on the server instead of being left behind.
        expect([...server.shares.values()].map((s) => s.status)).toEqual([
            "revoked",
        ]);
    });

    it("refuses a share ID that's already in the list", async () => {
        const server = fakeServer("token");
        const store = memoryStore({
            ServerOrigin: "https://share.example.net",
            CreationToken: "operator",
        });
        const deps: ShareServiceDeps = {
            store,
            defaultOrigin: "https://vault.example.com",
            fetch: server.fetch,
        };
        // A record for another server that happens to use the next ID.
        const first = await createShareLink(
            {
                ...deps,
                store: memoryStore({ ServerOrigin: "", CreationToken: "t" }),
            },
            { payload, label: "", credentialId: "", ttlSeconds: 3600 },
        );
        store.records.push(first.record);
        server.shares.clear();

        await expect(
            createShareLink(deps, {
                payload,
                label: "",
                credentialId: "",
                ttlSeconds: 3600,
            }),
        ).rejects.toEqual(new ShareSetupError("share_id_conflict"));
        expect(store.records).toEqual([first.record]);
    });

    it("reads the audience from a ticket", () => {
        expect(ticketAudience(ticketFor({ aud: "https://a.example" }))).toBe(
            "https://a.example",
        );
        expect(ticketAudience(ticketFor({ aud: 7 }))).toBeUndefined();
        expect(ticketAudience(ticketFor([]))).toBeUndefined();
        expect(ticketAudience("a.b.c")).toBeUndefined();
        expect(ticketAudience("")).toBeUndefined();
    });

    it("needs a sign-in for ticket servers and a token for token servers", async () => {
        await expect(
            createShareLink(
                {
                    store: memoryStore(),
                    defaultOrigin: "https://www.cryptex-vault.com",
                    fetch: fakeServer("ticket").fetch,
                },
                { payload, label: "", credentialId: "", ttlSeconds: 3600 },
            ),
        ).rejects.toEqual(new ShareSetupError("sign_in_required"));
        await expect(
            createShareLink(
                {
                    store: memoryStore(),
                    defaultOrigin: "https://vault.example.com",
                    fetch: fakeServer("token").fetch,
                },
                { payload, label: "", credentialId: "", ttlSeconds: 3600 },
            ),
        ).rejects.toEqual(new ShareSetupError("token_required"));
    });

    it("uses the self-hosted server and token from the settings", async () => {
        const server = fakeServer("token");
        await createShareLink(
            {
                store: memoryStore({
                    ServerOrigin: "https://vault.example.com",
                    CreationToken: "operator-token",
                }),
                defaultOrigin: "https://www.cryptex-vault.com",
                fetch: server.fetch,
            },
            { payload, label: "", credentialId: "", ttlSeconds: 3600 },
        );

        expect(
            server.calls.find((call) => call.path === "/shares")!.authorization,
        ).toBe("Bearer operator-token");
    });

    it("revokes the share when the record can't be saved", async () => {
        const server = fakeServer("token");
        const store = memoryStore({
            ServerOrigin: "",
            CreationToken: "operator-token",
        });
        store.failNextSave = true;

        await expect(
            createShareLink(
                {
                    store,
                    defaultOrigin: "https://vault.example.com",
                    fetch: server.fetch,
                },
                { payload, label: "", credentialId: "", ttlSeconds: 3600 },
            ),
        ).rejects.toThrow("save failed");
        expect([...server.shares.values()][0]!.status).toBe("revoked");
    });

    it("refreshes status and dismisses links", async () => {
        const server = fakeServer("token");
        const store = memoryStore({
            ServerOrigin: "",
            CreationToken: "operator-token",
        });
        const deps = {
            store,
            defaultOrigin: "https://vault.example.com",
            fetch: server.fetch,
        };
        const { record } = await createShareLink(deps, {
            payload,
            label: "Router",
            credentialId: "cred-1",
            ttlSeconds: 3600,
        });

        server.shares.get(record.ID)!.status = "viewed";
        await refreshShareStatuses(deps);
        expect(store.records[0]).toMatchObject({
            Status: "viewed",
            Version: 1,
        });

        await dismissShareLink(deps, record.ID);
        expect(store.records[0]).toMatchObject({
            Deleted: true,
            ManageToken: "",
        });
        // Already viewed, so dismissing doesn't call revoke.
        expect(server.calls.some((call) => call.path.endsWith("/revoke"))).toBe(
            false,
        );
    });

    it("ignores status reports for links the server wasn't asked about", async () => {
        const server = fakeServer("token", {
            extraStatus: [
                {
                    id: "someone-elses-link-id",
                    status: "revoked",
                    expiresAt: null,
                    viewedAt: null,
                },
            ],
        });
        const store = memoryStore({ ServerOrigin: "", CreationToken: "t" });
        // Only vault.example.com answers; it also claims another server's link.
        const fetchImpl = ((url: string, init: RequestInit) =>
            url.startsWith("https://other.example.com")
                ? Promise.reject(new TypeError("offline"))
                : server.fetch(url, init)) as unknown as typeof fetch;
        const deps = {
            store,
            defaultOrigin: "https://vault.example.com",
            fetch: fetchImpl,
        };
        const { record } = await createShareLink(deps, {
            payload,
            label: "",
            credentialId: "",
            ttlSeconds: 3600,
        });
        store.records.push({
            ...record,
            ID: "someone-elses-link-id",
            ServerOrigin: "https://other.example.com",
        });
        await refreshShareStatuses(deps);
        expect(store.records.map((item) => item.Status)).toEqual([
            "active",
            "active",
        ]);
    });

    it("still revokes on the server when the local clock says expired", async () => {
        const server = fakeServer("token");
        const store = memoryStore({ ServerOrigin: "", CreationToken: "t" });
        const deps = {
            store,
            defaultOrigin: "https://vault.example.com",
            fetch: server.fetch,
        };
        const { record } = await createShareLink(deps, {
            payload,
            label: "",
            credentialId: "",
            ttlSeconds: 3600,
        });
        // Pretend this device's clock is far ahead.
        store.records[0] = { ...record, ExpiresAtTimestamp: 1 };

        await revokeShareLink(deps, record.ID);

        expect(server.shares.get(record.ID)!.status).toBe("revoked");
        expect(store.records[0]).toMatchObject({ Status: "revoked" });
    });

    it("records a view that happened just before the revoke", async () => {
        const server = fakeServer("token");
        const store = memoryStore({ ServerOrigin: "", CreationToken: "t" });
        const deps = {
            store,
            defaultOrigin: "https://vault.example.com",
            fetch: server.fetch,
        };
        const { record } = await createShareLink(deps, {
            payload,
            label: "",
            credentialId: "",
            ttlSeconds: 3600,
        });
        server.shares.get(record.ID)!.status = "viewed";

        await revokeShareLink(deps, record.ID);

        expect(store.records[0]).toMatchObject({
            Status: "viewed",
            ViewedAtTimestamp: 4_000,
        });
    });

    it("refuses an expiry the server doesn't allow", async () => {
        const server = fakeServer("token", { maxTtl: 1800 });
        await expect(
            createShareLink(
                {
                    store: memoryStore({
                        ServerOrigin: "",
                        CreationToken: "t",
                    }),
                    defaultOrigin: "https://vault.example.com",
                    fetch: server.fetch,
                },
                { payload, label: "", credentialId: "", ttlSeconds: 3600 },
            ),
        ).rejects.toEqual(new ShareSetupError("expiry_too_long"));
        expect(server.calls.some((call) => call.path === "/shares")).toBe(
            false,
        );
    });
});
