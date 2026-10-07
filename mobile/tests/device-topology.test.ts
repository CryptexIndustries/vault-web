import { afterEach, beforeEach, expect, it, jest } from "@jest/globals";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { useDeviceTopology } from "@/components/devices/use-device-topology";
import { ONLINE_SERVICES_SELECTION_ID } from "@cryptex-industries/vault-core/consts";
import { DeviceActionError } from "@/components/devices/device-action-error";

jest.mock("jotai", () => ({
    useAtomValue: (atom: string) =>
        atom === "vault" ? mockVault : mockSession,
}));
jest.mock("@/utils/atoms", () => ({
    unlockedVaultAtom: "vault",
    onlineServicesDataAtom: "session",
    onlineServicesStore: {},
    vaultStore: { get: () => mockVault },
}));
jest.mock("@/utils/online-services-api-url", () => ({
    isCloudServicesEnabled: () => true,
}));
jest.mock("@/utils/vault-session", () => ({
    getVaultSessionGeneration: () => mockGeneration,
    isSameActiveVaultSession: (generation: number) =>
        generation === mockGeneration,
}));
jest.mock("@/app_lib/auth-session", () => ({
    establishOnlineServicesSession: (...args: unknown[]) =>
        mockEstablish(...args),
    syncOnlineServicesRemoteConfiguration: () => mockSyncConfig(),
}));
jest.mock("@/components/devices/use-device-actions", () => ({
    useDeviceActions: () => ({ removeLocalDevices: mockRemoveLocal }),
}));
jest.mock("@/utils/trpc", () => ({
    trpcReact: {
        useUtils: () => ({
            v1: {
                device: { invalidate: mockInvalidate },
                payment: { subscription: { invalidate: mockInvalidate } },
            },
        }),
        v1: {
            user: { configuration: { useQuery: () => mockConfig } },
            device: {
                topology: {
                    useQuery: (_input: unknown, options: unknown) => {
                        mockTopologyOptions(options);
                        return mockTopology;
                    },
                },
                remove: { useMutation: () => ({ mutateAsync: mockRemove }) },
                breakLink: {
                    useMutation: () => ({ mutateAsync: mockBreakLink }),
                },
                setRoot: { useMutation: () => ({ mutateAsync: mockSetRoot }) },
            },
        },
    },
}));

const mockRemove = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockBreakLink = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockSetRoot = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockRemoveLocal = jest.fn<(...args: unknown[]) => Promise<void>>();
const mockEstablish = jest.fn<(...args: unknown[]) => Promise<void>>();
const mockSyncConfig = jest.fn<() => Promise<void>>();
const mockInvalidate = jest.fn<() => Promise<void>>();
const mockTopologyOptions = jest.fn();
let mockGeneration = 1;
let mockVault: any;
let mockSession: any;
let mockConfig: any;
let mockTopology: any;
let hook: ReturnType<typeof useDeviceTopology>;
let renderer: ReactTestRenderer | undefined;

function Consumer() {
    hook = useDeviceTopology();
    return null;
}
async function render() {
    await act(async () => {
        if (renderer) renderer.update(createElement(Consumer));
        else renderer = create(createElement(Consumer));
    });
}
async function rejection(action: () => Promise<unknown>, message: string) {
    await act(async () => {
        await expect(action()).rejects.toThrow(message);
    });
}

beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    (globalThis as any).IS_REACT_NATIVE_TEST_ENVIRONMENT = true;
    jest.clearAllMocks();
    mockGeneration = 1;
    mockRemove.mockResolvedValue(undefined);
    mockBreakLink.mockReset().mockResolvedValue(undefined);
    mockSetRoot.mockResolvedValue(undefined);
    mockRemoveLocal.mockResolvedValue(undefined);
    mockEstablish.mockResolvedValue(undefined);
    mockSyncConfig.mockResolvedValue(undefined);
    mockInvalidate.mockResolvedValue(undefined);
    mockVault = {
        OnlineServices: {
            DeviceId: "phone",
            UserID: "user",
            PrivateKeyJWK: "key",
        },
        LinkedDevices: {
            Devices: [
                {
                    ID: "local-peer",
                    Name: "Laptop",
                    SyncID: "sync",
                    SignalingServerID: ONLINE_SERVICES_SELECTION_ID,
                    STUNServerIDs: [],
                    TURNServerIDs: [],
                },
            ],
        },
    };
    mockSession = { deviceId: "phone", sessionToken: "session" };
    mockConfig = {
        data: { deviceId: "phone", root: true, canPromoteDevices: true },
        isSuccess: true,
        isError: false,
        isFetching: false,
        refetch: jest
            .fn<() => Promise<unknown>>()
            .mockImplementation(async () => ({ data: mockConfig.data })),
    };
    mockTopology = {
        data: {
            devices: [
                {
                    id: "phone",
                    current: true,
                    root: true,
                    lastSeen: null,
                    createdAt: new Date(0),
                },
                {
                    id: "peer",
                    current: false,
                    root: false,
                    lastSeen: null,
                    createdAt: new Date(0),
                },
            ],
            relationships: [
                {
                    syncId: "sync",
                    fromDeviceId: "phone",
                    toDeviceId: "peer",
                    createdAt: new Date(0),
                },
            ],
        },
        isSuccess: true,
        isError: false,
        isFetching: false,
        refetch: jest.fn<() => Promise<unknown>>().mockResolvedValue({}),
    };
});
afterEach(async () => {
    await act(async () => renderer?.unmount());
    renderer = undefined;
    delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
    delete (globalThis as any).IS_REACT_NATIVE_TEST_ENVIRONMENT;
});

it("hides cached account topology on a non-root phone and preserves saved links", async () => {
    mockConfig.data.root = false;
    await render();
    expect(mockTopologyOptions).toHaveBeenLastCalledWith({ enabled: false });
    expect(hook.map.nodes.map((n) => n.id)).toEqual([
        "account:phone",
        "local:local-peer",
    ]);
    expect(hook.map.topologyVerified).toBe(false);
    expect(hook.map.relationships[0]?.missingOnServer).toBe(false);
    await rejection(() => hook.removeAccountDevice("peer"), "root device");
    expect(mockRemove).not.toHaveBeenCalled();
});

it.each([
    "fetching",
    "error",
    "mismatched configuration",
    "mismatched topology",
    "mismatched session",
])("does not classify local links as missing with %s", async (state) => {
    mockTopology.data.relationships = [];
    if (state === "fetching") mockTopology.isFetching = true;
    if (state === "error") mockTopology.isError = true;
    if (state === "mismatched configuration")
        mockConfig.data.deviceId = "another";
    if (state === "mismatched topology")
        mockTopology.data.devices = [mockTopology.data.devices[1]];
    if (state === "mismatched session") mockSession.deviceId = "another";
    await render();
    expect(hook.map.topologyVerified).toBe(false);
    expect(hook.map.relationships[0]?.missingOnServer).toBe(false);
});

it("marks a missing managed link only after a matching successful root lookup", async () => {
    mockTopology.data.relationships = [];
    await render();
    expect(hook.map.topologyVerified).toBe(true);
    expect(hook.map.relationships[0]?.missingOnServer).toBe(true);
});

it("keeps local links when removing the account device fails", async () => {
    mockRemove.mockRejectedValue(new Error("Denied"));
    await render();
    await rejection(() => hook.removeAccountDevice("peer"), "Denied");
    expect(mockRemoveLocal).not.toHaveBeenCalled();
});

it("captures matching local links before removal and cleans them only after server success", async () => {
    let finish!: () => void;
    mockRemove.mockImplementation(
        () =>
            new Promise<void>((resolve) => {
                finish = resolve;
            }),
    );
    await render();
    let action!: Promise<void>;
    await act(async () => {
        action = hook.removeAccountDevice("peer");
    });
    expect(mockRemoveLocal).not.toHaveBeenCalled();
    mockTopology.data = { ...mockTopology.data, relationships: [] };
    await render();
    await act(async () => {
        finish();
        await action;
    });
    expect(mockRemoveLocal).toHaveBeenCalledWith(["local-peer"]);
    expect(mockInvalidate).toHaveBeenCalledTimes(2);
});

it("reports server success separately when local cleanup fails", async () => {
    mockRemoveLocal.mockRejectedValue(new Error("Disk error"));
    await render();
    await rejection(
        () => hook.removeAccountDevice("peer"),
        "Account device removed",
    );
    expect(mockInvalidate).toHaveBeenCalledTimes(2);
});

it("does not clean another vault after the session changes during removal", async () => {
    mockRemove.mockImplementation(async () => {
        mockGeneration += 1;
    });
    await render();
    await rejection(
        () => hook.removeAccountDevice("peer"),
        "vault session changed",
    );
    expect(mockRemoveLocal).not.toHaveBeenCalled();
});

it("rejects removing the current device, another root, or the last root permission", async () => {
    await render();
    await rejection(
        () => hook.removeAccountDevice("phone"),
        "Only another device",
    );
    await rejection(
        () => hook.toggleRoot("phone", false),
        "At least one device",
    );
    mockTopology.data = {
        ...mockTopology.data,
        devices: mockTopology.data.devices.map((device: { id: string }) =>
            device.id === "peer" ? { ...device, root: true } : device,
        ),
    };
    await render();
    await rejection(
        () => hook.removeAccountDevice("peer"),
        "Only another device",
    );
    expect(mockRemove).not.toHaveBeenCalled();
    expect(mockSetRoot).not.toHaveBeenCalled();
});

it("allows a current root to step down when another root remains", async () => {
    mockTopology.data = {
        ...mockTopology.data,
        devices: mockTopology.data.devices.map((device: { id: string }) =>
            device.id === "peer" ? { ...device, root: true } : device,
        ),
    };
    await render();
    await act(async () => hook.toggleRoot("phone", false));
    expect(mockSetRoot).toHaveBeenCalledWith({ id: "phone", root: false });
    expect(mockSyncConfig).toHaveBeenCalled();
});

it("requires the promotion entitlement before changing root permissions", async () => {
    mockConfig.data.canPromoteDevices = false;
    await render();
    await rejection(() => hook.toggleRoot("peer", true), "cannot change root");
    expect(mockSetRoot).not.toHaveBeenCalled();
});

it("refreshes a non-root account without invoking the root-only topology endpoint", async () => {
    mockConfig.data.root = false;
    await render();
    await act(async () => hook.refresh());
    expect(mockConfig.refetch).toHaveBeenCalled();
    expect(mockTopology.refetch).not.toHaveBeenCalled();
});

it("reconnects through the existing session flow before refreshing account devices", async () => {
    mockSession.sessionToken = null;
    await render();
    expect(hook.hasSession).toBe(false);
    await act(async () => hook.refresh());
    expect(mockEstablish).toHaveBeenCalledWith({
        deviceId: "phone",
        privateKeyJWK: "key",
    });
    expect(mockConfig.refetch).toHaveBeenCalled();
    expect(mockTopology.refetch).toHaveBeenCalled();
});

it("surfaces refresh errors without pretending a saved relationship is missing", async () => {
    mockConfig.refetch.mockRejectedValue(new Error("Network unavailable"));
    mockTopology.isSuccess = false;
    mockTopology.data.relationships = [];
    await render();
    await act(async () => hook.refresh());
    expect(hook.error).toBe("Network unavailable");
    expect(hook.map.relationships[0]?.missingOnServer).toBe(false);
});

it("reports changed permissions separately when the refresh after promotion fails", async () => {
    mockSyncConfig.mockRejectedValue(new Error("Offline"));
    await render();
    await rejection(() => hook.toggleRoot("peer", true), "Root access changed");
    expect(mockSetRoot).toHaveBeenCalledWith({ id: "peer", root: true });
});

it("rejects concurrent account writes", async () => {
    let finish!: () => void;
    mockRemove.mockImplementation(
        () =>
            new Promise<void>((resolve) => {
                finish = resolve;
            }),
    );
    await render();
    let action!: Promise<void>;
    await act(async () => {
        action = hook.removeAccountDevice("peer");
    });
    await rejection(() => hook.toggleRoot("peer", true), "already in progress");
    await act(async () => {
        finish();
        await action;
    });
    expect(mockSetRoot).not.toHaveBeenCalled();
});

it("unlinks a server-only relationship while retaining both account identities", async () => {
    mockVault.LinkedDevices.Devices = [];
    await render();
    const identities = hook.map.nodes.map((node) => node.serverId);
    await act(async () => hook.unlinkRelationship("server:sync"));
    expect(mockBreakLink).toHaveBeenCalledWith({ syncId: "sync" });
    expect(mockRemove).not.toHaveBeenCalled();
    expect(mockRemoveLocal).not.toHaveBeenCalled();
    expect(hook.map.nodes.map((node) => node.serverId)).toEqual(identities);
    expect(mockInvalidate).toHaveBeenCalledTimes(2);
});

it("keeps saved links and account identities when relationship unlink is denied", async () => {
    mockBreakLink.mockRejectedValueOnce(new Error("Permission denied"));
    await render();
    const nodes = hook.map.nodes;
    await rejection(
        () => hook.unlinkRelationship("server:sync"),
        "Permission denied",
    );
    expect(mockRemoveLocal).not.toHaveBeenCalled();
    expect(mockRemove).not.toHaveBeenCalled();
    expect(hook.map.nodes).toEqual(nodes);
    expect(mockVault.LinkedDevices.Devices[0].ID).toBe("local-peer");
});

it.each(["non-root", "unverified", "local-only", "unknown"])(
    "rejects relationship unlink for %s evidence before calling the server",
    async (state) => {
        if (state === "non-root") mockConfig.data.root = false;
        if (state === "unverified") mockTopology.isFetching = true;
        if (state === "local-only") mockTopology.data.relationships = [];
        await render();
        const id =
            state === "local-only"
                ? "local-link:local-peer"
                : state === "unknown"
                  ? "server:unknown"
                  : "server:sync";
        await rejection(
            () => hook.unlinkRelationship(id),
            state === "non-root" || state === "unverified"
                ? "root device"
                : "no longer available",
        );
        expect(mockBreakLink).not.toHaveBeenCalled();
        expect(mockRemoveLocal).not.toHaveBeenCalled();
    },
);

it("captures only Online Services saved links and waits for server unlink before cleanup", async () => {
    mockVault.LinkedDevices.Devices.push(
        {
            ID: "mixed",
            Name: "Mixed",
            SyncID: "sync",
            SignalingServerID: "custom",
            STUNServerIDs: [],
            TURNServerIDs: ["turn"],
        },
        {
            ID: "all-custom",
            Name: "Custom",
            SyncID: "sync",
            SignalingServerID: "custom",
            STUNServerIDs: ["stun"],
            TURNServerIDs: ["turn"],
        },
        {
            ID: "unrelated",
            Name: "Other",
            SyncID: "another-sync",
            SignalingServerID: ONLINE_SERVICES_SELECTION_ID,
            STUNServerIDs: [],
            TURNServerIDs: [],
        },
    );
    let finish!: () => void;
    mockBreakLink.mockImplementationOnce(
        () =>
            new Promise<void>((resolve) => {
                finish = resolve;
            }),
    );
    await render();
    let action!: Promise<void>;
    await act(async () => {
        action = hook.unlinkRelationship("server:sync");
    });
    expect(mockRemoveLocal).not.toHaveBeenCalled();
    mockTopology.data = { ...mockTopology.data, relationships: [] };
    await render();
    await act(async () => {
        finish();
        await action;
    });
    expect(mockRemoveLocal).toHaveBeenCalledWith(["local-peer", "mixed"]);
    expect(mockRemove).not.toHaveBeenCalled();
});

it("does not clean links from another vault after a late server unlink response", async () => {
    mockBreakLink.mockImplementationOnce(async () => {
        mockGeneration += 1;
    });
    await render();
    await rejection(
        () => hook.unlinkRelationship("server:sync"),
        "vault session changed",
    );
    expect(mockRemoveLocal).not.toHaveBeenCalled();
});

it("reports completed server unlink separately from failed saved-link cleanup", async () => {
    mockRemoveLocal.mockRejectedValueOnce(new Error("Disk error"));
    await render();
    await rejection(
        () => hook.unlinkRelationship("server:sync"),
        "Account connection unlinked",
    );
    expect(mockInvalidate).toHaveBeenCalledTimes(2);
    expect(mockRemove).not.toHaveBeenCalled();
});

it("does not clean an ambiguous saved ID when unlinking between two other account devices", async () => {
    mockTopology.data.devices.push({
        id: "remote",
        current: false,
        root: false,
        lastSeen: null,
        createdAt: new Date(0),
    });
    mockTopology.data.relationships.push({
        syncId: "remote-sync",
        fromDeviceId: "peer",
        toDeviceId: "remote",
        createdAt: new Date(0),
    });
    mockVault.LinkedDevices.Devices[0].SyncID = "remote-sync";
    await render();
    await act(async () => hook.unlinkRelationship("server:remote-sync"));
    expect(mockBreakLink).toHaveBeenCalledWith({ syncId: "remote-sync" });
    expect(mockRemoveLocal).not.toHaveBeenCalled();
    expect(mockRemove).not.toHaveBeenCalled();
    expect(mockVault.LinkedDevices.Devices[0].ID).toBe("local-peer");
});

it.each(["connection", "device"])(
    "preserves the completed %s outcome when account invalidation fails",
    async (scope) => {
        mockInvalidate.mockRejectedValueOnce(
            new Error("Account refresh failed"),
        );
        await render();
        await act(async () => {
            const action =
                scope === "device"
                    ? hook.removeAccountDevice("peer")
                    : hook.unlinkRelationship("server:sync");
            await expect(action).rejects.toMatchObject({
                name: "DeviceActionError",
                completedAction:
                    scope === "device"
                        ? "device-removed"
                        : "connection-unlinked",
                localCleanupRequired: false,
            });
        });
        expect(mockRemoveLocal).toHaveBeenCalledWith(["local-peer"]);
    },
);

it("retains local cleanup facts when cleanup and account invalidation both fail", async () => {
    mockRemoveLocal.mockRejectedValueOnce(new Error("Disk error"));
    mockInvalidate.mockRejectedValueOnce(new Error("Account refresh failed"));
    await render();
    let failure: unknown;
    await act(async () => {
        try {
            await hook.unlinkRelationship("server:sync");
        } catch (error) {
            failure = error;
        }
    });
    expect(failure).toBeInstanceOf(DeviceActionError);
    expect(failure).toMatchObject({
        completedAction: "connection-unlinked",
        localCleanupRequired: true,
    });
    expect((failure as Error).message).toContain("remaining saved link");
});
