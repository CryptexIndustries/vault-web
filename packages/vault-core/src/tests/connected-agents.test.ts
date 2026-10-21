/**
 * @jest-environment node
 */
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    jest,
} from "@jest/globals";
import { webcrypto } from "crypto";

Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    writable: true,
});

import * as VaultUtilTypes from "../proto/vault";
import { getSyncVersionVectors, selectSyncItems } from "../sync-operations";
import { SynchronizationEnvelope } from "../synchronization-utils";
import {
    appendConnectedAgentHistory,
    CONNECTED_AGENT_HISTORY_MAX_AGE_MS,
    CONNECTED_AGENT_HISTORY_MAX_ENTRIES,
    CONNECTED_AGENT_TOMBSTONE_VERSION_BUMP,
    connectedAgentID,
    connectedAgentsFromTransport,
    connectedAgentsToTransport,
    CONNECTED_AGENT_MAX_KNOWN_HOSTS,
    createConnectedAgentRecord,
    hashConnectedAgentSync,
    markConnectedAgentDeleted,
    mergeReceivedConnectedAgents,
    updateConnectedAgentRecord,
    visibleConnectedAgents,
} from "../vault-utils/connected-agents";
import { packageForLinking, Vault } from "../vault-utils/vault";

const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

const toArrayBuffer = (data: Uint8Array): ArrayBuffer =>
    data.buffer.slice(
        data.byteOffset,
        data.byteOffset + data.byteLength,
    ) as ArrayBuffer;

const bytes = (size: number, fill: number) => new Uint8Array(size).fill(fill);

const agent = (fill = 1, now = NOW) =>
    createConnectedAgentRecord(
        {
            Name: "build box",
            AgentSignPublicKey: bytes(32, fill),
            AgentKEMPublicKey: bytes(1216, fill + 1),
            Hostname: "build",
            OS: "linux",
            Arch: "amd64",
            AgentVersion: "0.1.0",
            ApproverSignPublicKey: bytes(32, 200),
            ApproverKEMPublicKey: bytes(1216, 201),
            ApproverName: "Phone",
            RevocationSeed: bytes(32, fill + 2),
            RelayOrigin: "",
            CredentialIDs: ["ssh-key"],
            KeysRevision: 1,
        },
        now,
    );

const request = (
    timestamp: number,
    outcome = VaultUtilTypes.AgentRequestOutcome.AgentOutcomeApproved,
): VaultUtilTypes.AgentRequestRecord => ({
    Timestamp: timestamp,
    Kind: VaultUtilTypes.AgentRequestKind.AgentRequestLogin,
    Outcome: outcome,
    Namespace: "",
    Host: "github.com",
    HostKeyFingerprint: "SHA256:abc",
    Forwarded: false,
    DestinationUnknown: false,
    CredentialID: "ssh-key",
    Process: "git push",
});

let warn: ReturnType<typeof jest.spyOn>;
beforeEach(() => {
    warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
    warn.mockRestore();
});

describe("connected agent records", () => {
    it("derives the ID from the agent key and starts at version 0", async () => {
        const created = await agent();

        expect(created).toMatchObject({
            ID: connectedAgentID(bytes(32, 1)),
            Version: 0,
            DateModifiedTimestamp: NOW,
            PairedAtTimestamp: NOW,
            Deleted: false,
            History: [],
        });
        expect(created.ID).not.toMatch(/[=+/]/);
        expect(created.Hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("bumps the version only when something changes", async () => {
        const created = await agent();

        expect(
            await updateConnectedAgentRecord(created, { Name: "build box" }),
        ).toBe(created);
        const renamed = await updateConnectedAgentRecord(
            created,
            { Name: "ci" },
            NOW + 5,
        );
        expect(renamed).toMatchObject({
            Name: "ci",
            Version: 1,
            DateModifiedTimestamp: NOW + 5,
        });
        expect(renamed.Hash).not.toBe(created.Hash);
    });

    it("keeps history newest first and moves the last use on approvals", async () => {
        const created = await agent();
        const first = await appendConnectedAgentHistory(
            created,
            request(NOW + 1),
            NOW + 1,
        );
        const denied = await appendConnectedAgentHistory(
            first,
            request(
                NOW + 2,
                VaultUtilTypes.AgentRequestOutcome.AgentOutcomeDenied,
            ),
            NOW + 2,
        );

        expect(denied.History.map((entry) => entry.Timestamp)).toEqual([
            NOW + 2,
            NOW + 1,
        ]);
        expect(denied.LastUsedTimestamp).toBe(NOW + 1);
        expect(denied.Version).toBe(2);
        expect(denied.Hash).not.toBe(first.Hash);
    });

    it("drops history older than 90 days and beyond 200 entries", async () => {
        const created = await agent();
        const old = await updateConnectedAgentRecord(created, {
            History: [
                ...Array.from({ length: 250 }, (_, index) =>
                    request(NOW - index * 1000),
                ),
                request(NOW - CONNECTED_AGENT_HISTORY_MAX_AGE_MS - DAY),
            ],
        });
        const next = await appendConnectedAgentHistory(
            old,
            request(NOW + 1),
            NOW + 1,
        );

        expect(next.History).toHaveLength(CONNECTED_AGENT_HISTORY_MAX_ENTRIES);
        expect(next.History[0]?.Timestamp).toBe(NOW + 1);
        expect(
            next.History.every(
                (entry) =>
                    entry.Timestamp >=
                    NOW + 1 - CONNECTED_AGENT_HISTORY_MAX_AGE_MS,
            ),
        ).toBe(true);

        const aged = await appendConnectedAgentHistory(
            await updateConnectedAgentRecord(created, {
                History: [request(NOW - 89 * DAY), request(NOW - 91 * DAY)],
            }),
            request(NOW),
            NOW,
        );
        expect(aged.History.map((entry) => entry.Timestamp)).toEqual([
            NOW,
            NOW - 89 * DAY,
        ]);
    });

    it("turns a deleted agent into a tombstone that keeps its keys", async () => {
        const created = await appendConnectedAgentHistory(
            await agent(),
            request(NOW),
        );
        const deleted = await markConnectedAgentDeleted(created, NOW + 10);

        expect(deleted).toMatchObject({
            Deleted: true,
            CredentialIDs: [],
            History: [],
            Version: created.Version + CONNECTED_AGENT_TOMBSTONE_VERSION_BUMP,
            DateModifiedTimestamp: NOW + 10,
        });
        expect(deleted.RevocationSeed).toEqual(created.RevocationSeed);
        expect(deleted.AgentSignPublicKey).toEqual(created.AgentSignPublicKey);
        expect(await markConnectedAgentDeleted(deleted)).toBe(deleted);
        expect(visibleConnectedAgents([deleted])).toEqual([]);
    });
});

describe("merging synced connected agents", () => {
    it("accepts newer versions and new agents, and ignores older ones", async () => {
        const local = await agent(1);
        const newer = await updateConnectedAgentRecord(local, {
            Name: "renamed",
        });
        const remoteOnly = await agent(9);

        const merged = mergeReceivedConnectedAgents(
            [local],
            [newer, remoteOnly],
        );

        expect(merged).toEqual([newer, remoteOnly]);
        expect(merged[0]).not.toBe(newer);
        expect(mergeReceivedConnectedAgents([newer], [local])).toEqual([newer]);
    });

    it("breaks version ties by date, then by hash", async () => {
        const local = await agent(1);
        const later = {
            ...(await updateConnectedAgentRecord(local, { Name: "a" })),
            Version: local.Version,
            DateModifiedTimestamp: local.DateModifiedTimestamp + 1,
        };
        expect(mergeReceivedConnectedAgents([local], [later])).toEqual([later]);

        const sameTime = { ...later, DateModifiedTimestamp: NOW };
        const [winner, loser] =
            sameTime.Hash < local.Hash ? [sameTime, local] : [local, sameTime];
        expect(mergeReceivedConnectedAgents([loser], [winner])).toEqual([
            winner,
        ]);
        expect(mergeReceivedConnectedAgents([winner], [loser])).toEqual([
            winner,
        ]);
    });

    it.each([
        "AgentSignPublicKey",
        "AgentKEMPublicKey",
        "ApproverSignPublicKey",
        "ApproverKEMPublicKey",
        "RevocationSeed",
    ] as const)("rejects an update that changes %s", async (field) => {
        const local = await agent(1);
        const changed = local[field].slice();
        changed[0] = changed[0]! ^ 0xff;
        const tampered = {
            ...(await updateConnectedAgentRecord(local, { Name: "x" })),
            [field]: changed,
        };

        expect(mergeReceivedConnectedAgents([local], [tampered])).toEqual([
            local,
        ]);
        expect(warn).toHaveBeenCalledWith(
            "Rejected a synced connected agent record",
            { agentId: local.ID, reason: `${field} changed` },
        );
    });

    it("rejects new agents whose ID doesn't match their key", async () => {
        const record = { ...(await agent(1)), ID: "someone-else" };
        const shortKey = {
            ...(await agent(2)),
            ApproverKEMPublicKey: bytes(8, 1),
        };

        expect(mergeReceivedConnectedAgents([], [record, shortKey])).toEqual(
            [],
        );
    });

    it("keeps tombstones, whichever side has them", async () => {
        const base = await agent(1);
        const deleted = await markConnectedAgentDeleted(base);
        const editedElsewhere = {
            ...(await updateConnectedAgentRecord(base, { Name: "x" })),
            Version: deleted.Version + 1,
        };

        expect(
            mergeReceivedConnectedAgents([deleted], [editedElsewhere]),
        ).toEqual([deleted]);
        // A tombstone wins even over a live record with a higher version.
        expect(
            mergeReceivedConnectedAgents([editedElsewhere], [deleted]),
        ).toEqual([deleted]);
        expect(mergeReceivedConnectedAgents([], [deleted])).toEqual([deleted]);
    });
});

describe("connected agent sync", () => {
    it("includes agents and their tombstones in version vectors", async () => {
        const live = await agent(1);
        const deleted = await markConnectedAgentDeleted(await agent(2));

        expect(getSyncVersionVectors([live, deleted])).toEqual([
            {
                ID: live.ID,
                Hash: live.Hash,
                Version: 0,
                DateModifiedTimestamp: NOW,
                Deleted: false,
            },
            expect.objectContaining({
                ID: deleted.ID,
                Version: CONNECTED_AGENT_TOMBSTONE_VERSION_BUMP,
                Deleted: true,
            }),
        ]);
    });

    it("returns requested agents in a data request", async () => {
        const a = await agent(1);
        const b = await agent(2);

        expect(
            selectSyncItems(
                {
                    Credentials: [],
                    Directories: [],
                    ShareLinks: [],
                    ConnectedAgents: [a, b],
                },
                [
                    {
                        Type: VaultUtilTypes.SyncItemType.ConnectedAgentItem,
                        ID: b.ID,
                    },
                    {
                        Type: VaultUtilTypes.SyncItemType.ShareLinkItem,
                        ID: a.ID,
                    },
                ],
            ),
        ).toEqual({
            Credentials: [],
            Directories: [],
            ShareLinks: [],
            ConnectedAgents: [b],
        });
    });

    it("carries agent vectors in hello and echo messages", async () => {
        const vectors = getSyncVersionVectors([await agent(1)]);
        const hello = await SynchronizationEnvelope.createSyncHelloMessage(
            [],
            [],
            [],
            vectors,
        );
        const echo = await SynchronizationEnvelope.createSyncHelloEchoMessage(
            [],
            [],
            [],
            vectors,
        );

        for (const { data } of [hello, echo]) {
            const message = (
                await SynchronizationEnvelope.deserialize(toArrayBuffer(data))
            )._unsafeUnwrap();
            expect(
                (message.data as VaultUtilTypes.SyncHelloMessage)
                    .ConnectedAgentVersionVectors,
            ).toEqual(vectors);
        }
    });

    it("carries agents in a data response", async () => {
        const record = await appendConnectedAgentHistory(
            await agent(1),
            request(NOW),
        );
        const data =
            await SynchronizationEnvelope.createSyncDataResponseMessage(
                "request-id",
                [],
                [],
                [],
                [record],
            );
        const message = (
            await SynchronizationEnvelope.deserialize(toArrayBuffer(data))
        )._unsafeUnwrap();

        expect(
            (message.data as VaultUtilTypes.SyncDataResponseMessage)
                .ConnectedAgents,
        ).toEqual([record]);
    });
});

describe("connected agents in the vault", () => {
    it("keeps agents through a vault encode and decode", async () => {
        const vault = new Vault();
        vault.ConnectedAgents = [
            await appendConnectedAgentHistory(await agent(1), request(NOW)),
            await markConnectedAgentDeleted(await agent(2)),
        ];

        const decoded = VaultUtilTypes.Vault.decode(
            VaultUtilTypes.Vault.encode(vault).finish(),
        );
        const restored = Object.assign(new Vault(), decoded);

        expect(restored.ConnectedAgents).toEqual(vault.ConnectedAgents);
        expect(restored.ConnectedAgents[0]?.AgentSignPublicKey).toBeInstanceOf(
            Uint8Array,
        );
    });

    it("reads vaults saved before agents existed as having none", () => {
        const decoded = VaultUtilTypes.Vault.decode(new Uint8Array(0));
        expect(Object.assign(new Vault(), decoded).ConnectedAgents).toEqual([]);
    });

    it("sends agents along when linking a new device", async () => {
        const vault = new Vault();
        vault.ConnectedAgents = [await agent(1)];

        const packaged = packageForLinking(
            vault,
            "sync-id",
            [],
            [],
            "",
            "sign-key",
            "kem-key",
        );
        const received = VaultUtilTypes.Vault.decode(
            VaultUtilTypes.Vault.encode(packaged).finish(),
        );

        expect(received.ConnectedAgents).toEqual(vault.ConnectedAgents);
    });

    it("survives JSON channels as base64 protobuf", async () => {
        const records = [await agent(1), await agent(2)];
        const json = JSON.parse(
            JSON.stringify(connectedAgentsToTransport(records)),
        ) as unknown;

        expect(connectedAgentsFromTransport(json)).toEqual(records);
        expect(
            connectedAgentsFromTransport([
                "not base64 protobuf!",
                42,
                ...connectedAgentsToTransport([records[0]!]),
            ]),
        ).toEqual([records[0]]);
        expect(connectedAgentsFromTransport(undefined)).toEqual([]);
    });
});

describe("approved server names (KnownHosts)", () => {
    const login = (
        outcome: VaultUtilTypes.AgentRequestOutcome,
        host = "github.com",
        fingerprint = "SHA256:abc",
        timestamp = NOW,
    ) => ({
        ...request(timestamp, outcome),
        Host: host,
        HostKeyFingerprint: fingerprint,
    });

    it("records a name only when the user approves a login with it", async () => {
        const {
            AgentOutcomeApproved,
            AgentOutcomeApprovedByRule,
            AgentOutcomeDenied,
        } = VaultUtilTypes.AgentRequestOutcome;
        let record = await agent(1);
        record = await appendConnectedAgentHistory(
            record,
            login(AgentOutcomeDenied, "prod-db"),
            NOW,
        );
        record = await appendConnectedAgentHistory(
            record,
            login(AgentOutcomeApprovedByRule, "rule-name"),
            NOW,
        );
        expect(record.KnownHosts).toEqual([]);
        record = await appendConnectedAgentHistory(
            record,
            login(AgentOutcomeApproved),
            NOW,
        );
        expect(record.KnownHosts).toEqual([
            {
                Fingerprint: "SHA256:abc",
                Name: "github.com",
                FirstSeenTimestamp: NOW,
            },
        ]);
    });

    it("merges as a union on both sides and caps the list", async () => {
        const { AgentOutcomeApproved } = VaultUtilTypes.AgentRequestOutcome;
        const base = await agent(1);
        // Two devices approve different servers from the same version.
        const here = await appendConnectedAgentHistory(
            base,
            login(AgentOutcomeApproved, "github.com", "SHA256:gh", NOW),
            NOW,
        );
        const there = await appendConnectedAgentHistory(
            base,
            login(AgentOutcomeApproved, "gitlab.com", "SHA256:gl", NOW + 1),
            NOW + 1,
        );
        const names = (records: VaultUtilTypes.ConnectedAgent[]) =>
            records[0]!.KnownHosts.map((entry) => entry.Name);
        const a = mergeReceivedConnectedAgents([here], [there]);
        const b = mergeReceivedConnectedAgents([there], [here]);
        expect(names(a)).toEqual(["github.com", "gitlab.com"]);
        expect(a).toEqual(b);
        expect(a[0]!.Hash).toBe(hashConnectedAgentSync(a[0]!));

        const flood = {
            ...there,
            Version: there.Version + 1,
            KnownHosts: Array.from({ length: 500 }, (_, index) => ({
                Fingerprint: `SHA256:${index}`,
                Name: `host-${index}`,
                FirstSeenTimestamp: NOW + 10 + index,
            })),
        };
        const capped = mergeReceivedConnectedAgents([here], [flood]);
        expect(capped[0]!.KnownHosts).toHaveLength(
            CONNECTED_AGENT_MAX_KNOWN_HOSTS,
        );
        // The oldest go first.
        expect(capped[0]!.KnownHosts.at(-1)!.Name).toBe("host-499");
    });
});

describe("merging records from a tampered linked device", () => {
    it("keeps the relay the agent was paired on", async () => {
        const local = await agent(1);
        const moved = {
            ...(await updateConnectedAgentRecord(local, { Name: "renamed" })),
            RelayOrigin: "http://attacker.example",
        };
        const [merged] = mergeReceivedConnectedAgents([local], [moved]);
        expect(merged!.Name).toBe("renamed");
        expect(merged!.RelayOrigin).toBe("");
        expect(merged!.Hash).toBe(hashConnectedAgentSync(merged!));
    });

    it("refuses new records that point at a plain http relay", async () => {
        const http = { ...(await agent(1)), RelayOrigin: "http://relay.evil" };
        const local = {
            ...(await agent(2)),
            RelayOrigin: "http://127.0.0.1:43112",
        };
        const path = {
            ...(await agent(3)),
            RelayOrigin: "https://example.com/relay",
        };
        expect(
            mergeReceivedConnectedAgents([], [http, local, path]).map(
                (record) => record.ID,
            ),
        ).toEqual([local.ID, path.ID]);
    });

    it("prunes received history and recomputes the hash", async () => {
        const local = await agent(1);
        const now = Date.now();
        const huge = {
            ...local,
            Version: local.Version + 1,
            Hash: "",
            History: Array.from({ length: 5000 }, (_, index) =>
                request(now - index),
            ),
        };
        const [merged] = mergeReceivedConnectedAgents([local], [huge], now);
        expect(merged!.History).toHaveLength(
            CONNECTED_AGENT_HISTORY_MAX_ENTRIES,
        );
        expect(merged!.Hash).toBe(hashConnectedAgentSync(merged!));
        // A made-up hash doesn't win a version tie either.
        const tie = { ...local, Name: "evil", Hash: "" };
        const [kept] = mergeReceivedConnectedAgents([local], [tie], now);
        const realTieHash = hashConnectedAgentSync(tie);
        expect(kept!.Name).toBe(realTieHash < local.Hash ? "evil" : local.Name);
    });
});
