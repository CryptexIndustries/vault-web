import { expect, it, jest } from "@jest/globals";
import {
    SyncConnectionController,
    type VaultOperations,
} from "@cryptex-industries/vault-core/synchronization";
import {
    LinkedDevices,
    LinkedDevice,
} from "@cryptex-industries/vault-core/vault-utils/vault";

jest.mock(
    "@cryptex-industries/vault-core/vault-utils/post-quantum-kem",
    () => ({}),
);
jest.mock(
    "@cryptex-industries/vault-core/vault-utils/sync-signing",
    () => ({}),
);
jest.mock("@cryptex-industries/vault-core/runtime", () => {
    const logger = {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
    };
    return {
        getVaultCoreRuntime: () => ({
            syncLog: logger,
            signalingLog: logger,
            webrtcLog: logger,
        }),
    };
});

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((r) => {
        resolve = r;
    });
    return { promise, resolve };
}

it("deduplicates concurrent connection attempts and abandons setup after teardown", async () => {
    const pending = deferred<LinkedDevices>();
    const getSynchronizationConfig = jest.fn(() => pending.promise);
    const controller = new SyncConnectionController({
        getSynchronizationConfig,
    } as unknown as VaultOperations);
    const first = controller.connectDevice("peer");
    expect(controller.connectDevice("peer")).toBe(first);
    controller.teardown();
    pending.resolve(new LinkedDevices());
    await expect(first).resolves.toBe(false);
    expect(getSynchronizationConfig).toHaveBeenCalledTimes(1);
});

it("closes a native peer whose setup finishes after teardown", async () => {
    const config = new LinkedDevices();
    config.Devices = [
        Object.assign(Object.create(LinkedDevice.prototype) as LinkedDevice, {
            ID: "peer",
            SignalingServerID: "server",
        }),
    ];
    config.SignalingServers = [{ ID: "server" } as never];
    const controller = new SyncConnectionController({
        getSynchronizationConfig: async () => config,
    } as unknown as VaultOperations);
    const boundary = controller as unknown as {
        _connectSignalingServer: () => unknown;
        _setupSignalingSubscriptions: () => unknown;
        _setupWebRTCConnection: () => Promise<unknown>;
    };
    const pending = deferred<{ close: ReturnType<typeof jest.fn> }>();
    const channel = { unsubscribe: jest.fn(), unbind: jest.fn() };
    jest.spyOn(boundary, "_connectSignalingServer").mockReturnValue({
        connection: { state: "connected" },
    });
    jest.spyOn(boundary, "_setupSignalingSubscriptions").mockReturnValue(
        channel,
    );
    jest.spyOn(boundary, "_setupWebRTCConnection").mockReturnValue(
        pending.promise,
    );
    const attempt = controller.connectDevice("peer");
    await Promise.resolve();
    controller.teardown();
    const peer = { close: jest.fn() };
    pending.resolve(peer);
    await expect(attempt).resolves.toBe(false);
    expect(peer.close).toHaveBeenCalledTimes(1);
    expect(channel.unsubscribe).toHaveBeenCalled();
});

it("manual sync sends a hello over an already-open channel", async () => {
    const controller = new SyncConnectionController({} as VaultOperations);
    const boundary = controller as unknown as {
        _webRTConnections: Map<string, unknown>;
    };
    boundary._webRTConnections.set("peer", {
        dataChannel: { readyState: "open" },
    });
    jest.spyOn(controller, "connectDevice").mockResolvedValue(false);
    const hello = jest
        .spyOn(controller, "transmitSyncHello")
        .mockImplementation(() => {});
    await expect(controller.synchronizeDevice("peer")).resolves.toBe(true);
    expect(hello).toHaveBeenCalledWith("peer");
});
