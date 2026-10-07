import { expect, it } from "@jest/globals";
import { LinkedDevice } from "@cryptex-industries/vault-core/vault-utils/vault";
import {
    buildDeviceRelationshipMap,
    type DeviceTopology,
} from "@/components/account/device-topology";

const createdAt = new Date("2026-01-01T12:34:00Z");
const topology: DeviceTopology = {
    devices: ["phone", "peer", "remote"].map((id) => ({
        id,
        createdAt,
        lastSeen: null,
        current: id === "phone",
        root: id === "phone",
    })),
    relationships: [
        {
            syncId: "direct",
            fromDeviceId: "phone",
            toDeviceId: "peer",
            createdAt,
        },
        {
            syncId: "remote",
            fromDeviceId: "peer",
            toDeviceId: "remote",
            createdAt,
        },
    ],
};

it("keeps fully custom connections separate from a coincidental account sync ID", () => {
    const local = new LinkedDevice("Custom laptop", "direct", "key", "kem");
    local.ID = "custom-peer";
    local.SignalingServerID = "custom-signaling";
    local.STUNServerIDs = ["custom-stun"];
    local.TURNServerIDs = ["custom-turn"];
    const map = buildDeviceRelationshipMap(topology, [local], "phone", {
        topologyVerified: true,
    });
    expect(map.nodes.find((node) => node.serverId === "peer")).toMatchObject({
        displayName: "peer",
        localDevices: [],
    });
    expect(
        map.nodes.find((node) => node.id === "local:custom-peer"),
    ).toMatchObject({ displayName: "Custom laptop", localDevices: [local] });
    expect(
        map.nodes.find((node) => node.id === "local:custom-peer")?.serverId,
    ).toBeUndefined();
    expect(
        map.relationships.find((edge) => edge.id === "server:direct"),
    ).toMatchObject({ recordedOnServer: true, custom: false, createdAt });
    expect(
        map.relationships.find((edge) => edge.id === "server:direct")
            ?.localDevice,
    ).toBeUndefined();
    expect(
        map.relationships.find((edge) => edge.id === "local-link:custom-peer"),
    ).toMatchObject({
        recordedOnServer: false,
        custom: true,
        missingOnServer: false,
        localDevice: local,
    });
});

it.each(["STUN", "TURN"])(
    "merges custom signaling with Online Services %s into its one authoritative relationship",
    (service) => {
        const local = new LinkedDevice("Custom laptop", "direct", "key", "kem");
        local.ID = "custom-peer";
        local.SignalingServerID = "custom-signaling";
        local.STUNServerIDs = service === "STUN" ? [] : ["custom-stun"];
        local.TURNServerIDs = service === "TURN" ? [] : ["custom-turn"];
        const map = buildDeviceRelationshipMap(topology, [local], "phone", {
            topologyVerified: true,
        });
        expect(map.nodes).toHaveLength(topology.devices.length);
        expect(map.relationships).toHaveLength(topology.relationships.length);
        expect(
            map.nodes.find((node) => node.serverId === "peer"),
        ).toMatchObject({
            displayName: "Custom laptop",
            localDevices: [local],
        });
        expect(
            map.relationships.filter((edge) => edge.syncId === "direct"),
        ).toEqual([
            expect.objectContaining({
                id: "server:direct",
                recordedOnServer: true,
                custom: true,
                missingOnServer: false,
                localDevice: local,
                createdAt,
            }),
        ]);
    },
);

it("marks an unmatched Online Services ICE relationship missing only after verified account lookup", () => {
    const local = new LinkedDevice("Custom laptop", "missing", "key", "kem");
    local.SignalingServerID = "custom-signaling";
    local.STUNServerIDs = ["custom-stun"];
    local.TURNServerIDs = [];
    const verified = buildDeviceRelationshipMap(topology, [local], "phone", {
        topologyVerified: true,
    });
    expect(
        verified.relationships.find((edge) => edge.localDevice === local),
    ).toMatchObject({
        custom: true,
        recordedOnServer: false,
        missingOnServer: true,
    });
    const unavailable = buildDeviceRelationshipMap(undefined, [local], "phone");
    expect(
        unavailable.relationships.find((edge) => edge.localDevice === local)
            ?.missingOnServer,
    ).toBe(false);
});

it("matches Online Services signaling even when STUN and TURN are custom", () => {
    const local = new LinkedDevice("Work laptop", "direct", "key", "kem");
    local.STUNServerIDs = ["custom-stun"];
    local.TURNServerIDs = ["custom-turn"];
    const map = buildDeviceRelationshipMap(topology, [local], "phone", {
        topologyVerified: true,
    });
    expect(map.nodes).toHaveLength(3);
    expect(map.nodes.find((node) => node.serverId === "peer")).toMatchObject({
        displayName: "Work laptop",
        localDevices: [local],
    });
    expect(
        map.relationships.find((edge) => edge.id === "server:direct"),
    ).toMatchObject({
        recordedOnServer: true,
        custom: false,
        localDevice: local,
        createdAt,
    });
});

it("does not attach a saved peer to another devices' relationship", () => {
    const local = new LinkedDevice("Saved peer", "remote", "key", "kem");
    const map = buildDeviceRelationshipMap(topology, [local], "phone", {
        topologyVerified: true,
    });
    expect(
        map.relationships.find((edge) => edge.id === "server:remote")
            ?.localDevice,
    ).toBeUndefined();
    expect(
        map.nodes
            .filter((node) => node.serverId && !node.current)
            .every((node) => node.localDevices.length === 0),
    ).toBe(true);
    expect(
        map.nodes.find((node) => node.id === `local:${local.ID}`)?.serverId,
    ).toBeUndefined();
});

it("preserves the recorded creation date while never inventing a local creation date", () => {
    const local = new LinkedDevice("Missing link", "missing", "key", "kem");
    const map = buildDeviceRelationshipMap(topology, [local], "phone", {
        topologyVerified: true,
    });
    expect(
        map.relationships.find((edge) => edge.id === "server:remote")
            ?.createdAt,
    ).toBe(createdAt);
    expect(
        map.relationships.find((edge) => edge.localDevice)?.createdAt,
    ).toBeUndefined();
});
