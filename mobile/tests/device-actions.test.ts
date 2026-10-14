import { afterEach, beforeEach, expect, it, jest } from "@jest/globals";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { err, ok } from "neverthrow";
import {
    LinkedDevice,
    OnlineServices,
    Vault,
} from "@cryptex-industries/vault-core/vault-utils/vault";
import { WebRTCStatus } from "@cryptex-industries/vault-core/synchronization-utils";
import { useDeviceActions } from "@/components/devices/use-device-actions";
import { persistVaultMutation } from "@/utils/vault-mutations";
import { DeviceActionError } from "@/components/devices/device-action-error";

jest.mock("@/utils/atoms", () => ({
    getUnlockedVault: () => mockVault,
    onlineServicesDataAtom: "session",
    onlineServicesStore: { get: () => mockSession },
}));
jest.mock("@/utils/vault-mutations", () => ({
    persistVaultMutation: jest.fn(),
}));
jest.mock("@/utils/online-services-api-url", () => ({
    isCloudServicesEnabled: () => mockCloudEnabled,
}));
jest.mock("@/utils/vault-session", () => ({
    getVaultSessionGeneration: () => 1,
    isSameActiveVaultSession: () => mockActiveSession,
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
            device: {
                breakLink: {
                    useMutation: () => ({ mutateAsync: mockBreakLink }),
                },
            },
        },
    },
}));
jest.mock("@/components/sync-controller-provider", () => ({
    useSyncRuntime: () => ({
        controller: {
            disconnectDevice: mockDisconnect,
            connectDevice: mockConnect,
            getWebRTCStatus: () => mockWebRTCStatus,
        },
        connectionStatuses: {},
        runSyncQueue: mockRunSyncQueue,
    }),
}));

let mockVault: Vault;
let mockSession: { deviceId: string; sessionToken: string | null } | null;
let mockCloudEnabled = true;
let mockActiveSession = true;
let mockWebRTCStatus = WebRTCStatus.Disconnected;
const mockBreakLink = jest.fn<(input: { syncId: string }) => Promise<void>>();
const mockDisconnect = jest.fn<() => Promise<void>>();
const mockConnect = jest.fn<() => Promise<boolean>>();
const mockRunSyncQueue = jest.fn<() => Promise<void>>();
const mockInvalidate = jest.fn<() => Promise<void>>();
const persist = jest.mocked(persistVaultMutation);
let actions: ReturnType<typeof useDeviceActions>;
let renderer: ReactTestRenderer;
function Harness() {
    actions = useDeviceActions();
    return null;
}

beforeEach(async () => {
    (
        globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    (
        globalThis as { IS_REACT_NATIVE_TEST_ENVIRONMENT?: boolean }
    ).IS_REACT_NATIVE_TEST_ENVIRONMENT = true;
    mockVault = new Vault();
    mockVault.OnlineServices = new OnlineServices(
        "phone",
        "user",
        "public",
        "private",
    );
    mockSession = { deviceId: "phone", sessionToken: "session" };
    mockVault.LinkedDevices.Devices = [
        new LinkedDevice("Laptop", "sync-id", "key", "kem-key"),
    ];
    mockCloudEnabled = true;
    mockActiveSession = true;
    mockWebRTCStatus = WebRTCStatus.Disconnected;
    mockBreakLink.mockReset().mockResolvedValue(undefined);
    mockDisconnect.mockReset().mockResolvedValue(undefined);
    mockConnect.mockReset().mockResolvedValue(true);
    mockRunSyncQueue.mockReset().mockResolvedValue(undefined);
    mockInvalidate.mockReset().mockResolvedValue(undefined);
    persist.mockImplementation(async (_kind, mutate) => {
        const result = await mutate(mockVault);
        mockVault = result.vault;
        return ok(result.result);
    });
    await act(async () => {
        renderer = create(createElement(Harness));
    });
});
afterEach(async () => {
    await act(async () => renderer.unmount());
});

it("keeps the saved link and connection when the server rejects unlinking", async () => {
    const device = mockVault.LinkedDevices.Devices[0]!;
    mockBreakLink.mockRejectedValueOnce(new Error("Permission denied"));
    await act(async () => {
        await expect(actions.unlinkDevice(device)).rejects.toThrow(
            "Permission denied",
        );
    });
    expect(mockVault.LinkedDevices.Devices).toEqual([device]);
    expect(persist).not.toHaveBeenCalled();
    expect(mockDisconnect).not.toHaveBeenCalled();
    expect(actions.pendingId).toBeNull();
});

it("allows a signed-in non-root device to unlink its own saved Online Services connection", async () => {
    mockVault.OnlineServices!.IsRootDevice = false;
    const device = mockVault.LinkedDevices.Devices[0]!;
    await act(async () => {
        await actions.unlinkDevice(device);
    });
    expect(mockBreakLink).toHaveBeenCalledWith({ syncId: "sync-id" });
    expect(mockVault.LinkedDevices.Devices).toHaveLength(0);
});

it.each([
    "cleared session",
    "mismatched session",
    "unbound vault",
    "empty relationship ID",
])("keeps the saved link without server mutation for %s", async (state) => {
    const device = mockVault.LinkedDevices.Devices[0]!;
    if (state === "cleared session") mockSession!.sessionToken = null;
    if (state === "mismatched session") mockSession!.deviceId = "another-phone";
    if (state === "unbound vault") mockVault.OnlineServices = undefined;
    if (state === "empty relationship ID") device.SyncID = "";
    await act(async () => {
        await expect(actions.unlinkDevice(device)).rejects.toThrow(
            "saved link was kept",
        );
    });
    expect(mockBreakLink).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
    expect(mockDisconnect).not.toHaveBeenCalled();
    expect(mockVault.LinkedDevices.Devices).toEqual([device]);
});
it("removes the server relationship before persisting local removal", async () => {
    mockBreakLink.mockImplementationOnce(async () => {
        expect(persist).not.toHaveBeenCalled();
    });
    await act(async () => {
        await actions.unlinkDevice(mockVault.LinkedDevices.Devices[0]!);
    });
    expect(mockBreakLink).toHaveBeenCalledWith({ syncId: "sync-id" });
    expect(mockVault.LinkedDevices.Devices).toHaveLength(0);
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
});
it("retains the saved link when persistence fails after a successful server unlink", async () => {
    const device = mockVault.LinkedDevices.Devices[0]!;
    persist.mockResolvedValueOnce(err("VAULT_SAVE_FAILED"));
    await act(async () => {
        const unlink = actions.unlinkDevice(device);
        await expect(unlink).rejects.toBeInstanceOf(DeviceActionError);
        await expect(unlink).rejects.toMatchObject({
            message: expect.stringContaining("saved links were kept"),
            completedAction: "connection-unlinked",
            localCleanupRequired: true,
        });
    });
    expect(mockVault.LinkedDevices.Devices).toEqual([device]);
    expect(mockDisconnect).not.toHaveBeenCalled();
});
it("allows explicit local cleanup without contacting Online Services", async () => {
    mockCloudEnabled = false;
    await act(async () => renderer.update(createElement(Harness)));
    await act(async () => {
        await actions.unlinkDevice(mockVault.LinkedDevices.Devices[0]!, true);
    });
    expect(mockBreakLink).not.toHaveBeenCalled();
    expect(mockVault.LinkedDevices.Devices).toHaveLength(0);
});
it("does not silently downgrade an unavailable server unlink into local cleanup", async () => {
    mockCloudEnabled = false;
    await act(async () => renderer.update(createElement(Harness)));
    await act(async () => {
        await expect(
            actions.unlinkDevice(mockVault.LinkedDevices.Devices[0]!),
        ).rejects.toThrow("unavailable");
    });
    expect(mockVault.LinkedDevices.Devices).toHaveLength(1);
});
it("preserves a completed server unlink without removing saved links from another vault session", async () => {
    const originalVault = mockVault;
    const device = originalVault.LinkedDevices.Devices[0]!;
    const nextVault = new Vault();
    nextVault.LinkedDevices.Devices = [device];
    mockBreakLink.mockImplementationOnce(async () => {
        mockActiveSession = false;
        mockVault = nextVault;
    });
    await act(async () => {
        const unlink = actions.unlinkDevice(device);
        await expect(unlink).rejects.toBeInstanceOf(DeviceActionError);
        await expect(unlink).rejects.toMatchObject({
            message: expect.stringContaining("vault session changed"),
            completedAction: "connection-unlinked",
            localCleanupRequired: true,
        });
    });
    expect(mockBreakLink).toHaveBeenCalledWith({ syncId: "sync-id" });
    expect(persist).not.toHaveBeenCalled();
    expect(mockDisconnect).not.toHaveBeenCalled();
    expect(originalVault.LinkedDevices.Devices).toEqual([device]);
    expect(nextVault.LinkedDevices.Devices).toEqual([device]);
    expect(actions.pendingId).toBeNull();
});
it("unlinks fully custom connections without Online Services", async () => {
    const device = mockVault.LinkedDevices.Devices[0]!;
    device.SignalingServerID = "custom";
    device.STUNServerIDs = ["stun"];
    device.TURNServerIDs = ["turn"];
    await act(async () => {
        await actions.unlinkDevice(device);
    });
    expect(mockBreakLink).not.toHaveBeenCalled();
});
it("unlinks custom signaling with Online Services ICE through the server", async () => {
    const device = mockVault.LinkedDevices.Devices[0]!;
    device.SignalingServerID = "custom";
    await act(async () => {
        await actions.unlinkDevice(device);
    });
    expect(mockBreakLink).toHaveBeenCalledWith({ syncId: "sync-id" });
});
it("preserves link identity and the latest sync state when saving preferences", async () => {
    const device = mockVault.LinkedDevices.Devices[0]!;
    device.LastSync = "2026-10-02T12:00:00Z";
    await actions.saveDeviceConfig({
        ID: device.ID,
        Name: "Work laptop",
        AutoConnect: false,
        AutoSync: false,
        SyncTimeout: true,
        SyncTimeoutPeriod: 60,
    });
    expect(mockVault.LinkedDevices.Devices[0]).toMatchObject({
        Name: "Work laptop",
        SyncID: "sync-id",
        LastSync: device.LastSync,
        RemoteSyncPublicKey: "key",
        AutoConnect: false,
    });
});
it("connects a disconnected peer and syncs an established connection", async () => {
    await actions.connectDevice("peer");
    expect(mockConnect).toHaveBeenCalledWith("peer");
    mockWebRTCStatus = WebRTCStatus.Connected;
    await actions.connectDevice("peer");
    expect(mockRunSyncQueue).toHaveBeenCalledWith(["peer"]);
});

it("reports a connection that the runtime could not start", async () => {
    mockConnect.mockResolvedValueOnce(false);
    await expect(actions.connectDevice("peer")).rejects.toThrow(
        "Could not start the connection",
    );
});

it("rejects overlapping unlink requests", async () => {
    let finish: (() => void) | undefined;
    mockBreakLink.mockImplementationOnce(
        () =>
            new Promise<void>((resolve) => {
                finish = resolve;
            }),
    );
    const device = mockVault.LinkedDevices.Devices[0]!;
    await act(async () => {
        const first = actions.unlinkDevice(device);
        await expect(actions.unlinkDevice(device)).rejects.toThrow(
            "already in progress",
        );
        finish!();
        await first;
    });
    expect(mockBreakLink).toHaveBeenCalledTimes(1);
});
