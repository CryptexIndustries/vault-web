import { describe, it, expect } from "@jest/globals";
import type { LinkedDevice } from "@cryptex-industries/vault-core/vault-utils/vault";
import { ONLINE_SERVICES_SELECTION_ID } from "@cryptex-industries/vault-core/consts";
import {
    buildDeviceRelationshipMap,
    type DeviceTopology,
} from "@/components/vault-dashboard/account-dialog/device-topology";
import { layoutDevices } from "@/components/vault-dashboard/device-layout";
const seen = new Date("2026-09-14T10:00:00Z");
const server = (id: string, current = false) => ({
    id,
    current,
    root: current,
    createdAt: new Date(0),
    lastSeen: seen,
});
const link = (syncId: string, fromDeviceId: string, toDeviceId: string) => ({
    syncId,
    fromDeviceId,
    toDeviceId,
    createdAt: new Date(0),
});
const local = (ID: string, SyncID: string, custom = false): LinkedDevice => ({
    ID,
    SyncID,
    Name: "Pixel 9",
    SignalingServerID: custom ? "custom-server" : ONLINE_SERVICES_SELECTION_ID,
    STUNServerIDs: [],
    TURNServerIDs: [],
    LinkedAtTimestamp: 0,
    LastSync: undefined,
    AutoConnect: true,
    AutoSync: true,
    SyncTimeout: false,
    SyncTimeoutPeriod: 30,
    RemoteSyncPublicKey: "",
    RemoteSyncKemPublicKey: "",
});
const topology: DeviceTopology = {
    devices: [server("a", true), server("b"), server("c"), server("isolated")],
    relationships: [link("ab", "a", "b"), link("bc", "b", "c")],
};
describe("device relationship reconciliation", () => {
    it("names only the direct peer, retaining server timestamps for every registered device", () => {
        const map = buildDeviceRelationshipMap(
            topology,
            [local("local-b", "ab")],
            "a",
            { topologyVerified: true },
        );
        expect(map.nodes.find((n) => n.current)?.displayName).toBe(
            "This device",
        );
        expect(map.nodes.find((n) => n.serverId === "b")?.displayName).toBe(
            "Pixel 9",
        );
        expect(map.nodes.find((n) => n.serverId === "c")?.displayName).toBe(
            "c",
        );
        expect(
            map.nodes
                .filter((n) => n.serverId)
                .every((n) => n.lastSeen === seen),
        ).toBe(true);
        expect(
            map.nodes.find((n) => n.serverId === "isolated")?.localDevices,
        ).toEqual([]);
        expect(map.relationships).toHaveLength(2);
    });
    it("keeps custom signaling first class even with official STUN/TURN defaults", () => {
        const map = buildDeviceRelationshipMap(
            topology,
            [local("custom", "custom-link", true)],
            "a",
            { topologyVerified: true },
        );
        const edge = map.relationships.find((r) => r.localDevice);
        expect(edge).toMatchObject({
            custom: true,
            missingOnServer: false,
            recordedOnServer: false,
        });
        expect(
            map.nodes.find((n) => n.id === "local:custom")?.serverId,
        ).toBeUndefined();
    });
    it("can match a custom-signaling link if the server actually records its relationship", () => {
        const map = buildDeviceRelationshipMap(
            topology,
            [local("custom", "ab", true)],
            "a",
            { topologyVerified: true },
        );
        expect(map.nodes).toHaveLength(4);
        expect(map.relationships[0]).toMatchObject({
            custom: true,
            recordedOnServer: true,
            missingOnServer: false,
        });
    });
    it("does not infer a direct peer from a relationship between other devices", () => {
        const map = buildDeviceRelationshipMap(
            topology,
            [local("unknown-peer", "bc")],
            "a",
            { topologyVerified: true },
        );
        expect(map.nodes.find((n) => n.serverId === "b")?.displayName).toBe(
            "b",
        );
        expect(map.nodes.find((n) => n.serverId === "c")?.displayName).toBe(
            "c",
        );
        expect(
            map.relationships.find((r) => r.id === "server:bc")?.localDevice,
        ).toBeUndefined();
    });
    it("works without root topology and never guesses which registered device is current", () => {
        const map = buildDeviceRelationshipMap(
            undefined,
            [local("b", "ab"), local("custom", "x", true)],
            "a",
        );
        expect(map.nodes).toHaveLength(3);
        expect(map.relationships.every((r) => !r.missingOnServer)).toBe(true);
        const noIdentity = buildDeviceRelationshipMap(
            { devices: [server("root")], relationships: [] },
            [],
            null,
        );
        expect(
            noIdentity.nodes.find((n) => n.current)?.serverId,
        ).toBeUndefined();
    });
    it("warns only after verified topology and preserves the unmatched local record", () => {
        expect(
            buildDeviceRelationshipMap(
                topology,
                [local("b", "missing")],
                "a",
            ).relationships.at(-1)?.missingOnServer,
        ).toBe(false);
        const map = buildDeviceRelationshipMap(
            topology,
            [local("b", "missing")],
            "a",
            { topologyVerified: true },
        );
        expect(map.relationships.at(-1)?.missingOnServer).toBe(true);
        expect(
            map.nodes.find((n) => n.id === "local:b")?.localDevices,
        ).toHaveLength(1);
    });
    it("retains all 124 devices in a deterministic finite layout including isolated records", () => {
        const large: DeviceTopology = {
            devices: Array.from({ length: 124 }, (_, i) =>
                server(String(i), i === 0),
            ),
            relationships: Array.from({ length: 100 }, (_, i) =>
                link(String(i), "0", String(i + 1)),
            ),
        };
        const map = buildDeviceRelationshipMap(large, [], "0");
        const layout = layoutDevices(map);
        expect(layout.positions.size).toBe(124);
        expect(layout.isolated).toHaveLength(23);
        expect(
            [...layout.positions.values()].every(
                (p) =>
                    Number.isFinite(p.x) &&
                    Number.isFinite(p.y) &&
                    p.x >= 0 &&
                    p.y >= 0,
            ),
        ).toBe(true);
        expect(
            layoutDevices({ ...map, nodes: [...map.nodes].reverse() })
                .positions,
        ).toEqual(layout.positions);
    });
});
