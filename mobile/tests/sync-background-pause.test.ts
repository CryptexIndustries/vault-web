import { expect, it, jest } from "@jest/globals";
import { SyncConnectionController } from "@cryptex-industries/vault-core/synchronization";
import {
    SignalingStatus,
    WebRTCStatus,
} from "@cryptex-industries/vault-core/synchronization-utils";

jest.mock("@cryptex-industries/vault-core/runtime", () => {
    const log = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
    return {
        getVaultCoreRuntime: () => ({
            syncLog: log,
            signalingLog: log,
            webrtcLog: log,
        }),
    };
});
jest.mock("@cryptex-industries/vault-core/vault-utils/post-quantum-kem", () => ({}));
jest.mock("@cryptex-industries/vault-core/vault-utils/sync-signing", () => ({}));
jest.mock("@cryptex-industries/vault-core/vault-utils/sync-crypto", () => ({}));

it("closes background connections but keeps listeners for resumed status events", () => {
    const controller = new SyncConnectionController({} as never);
    const signalingStatus = jest.fn();
    const webRTCStatus = jest.fn();
    const signalingHandlerId = controller.registerSyncSignalingHandler(
        "server",
        signalingStatus,
    );
    controller.registerSyncWebRTCHandler("peer", webRTCStatus);

    const internals = controller as unknown as {
        _lifecycleGeneration: number;
        _connectAttempts: Map<string, Promise<boolean>>;
        _syncOnOpen: Set<string>;
        _signalingServers: Map<string, unknown>;
        _webRTConnections: Map<string, unknown>;
        _webRTCStatus: Map<string, WebRTCStatus>;
        _teardownSignalingConnection: (id: string) => void;
        _teardownWebRTCConnection: (id: string) => void;
        broadcastSignalingServerEvent: (id: string, status: SignalingStatus) => void;
        broadcastWebRTCConnectionEvent: (id: string, status: WebRTCStatus) => void;
    };
    const oldGeneration = internals._lifecycleGeneration;
    internals._connectAttempts.set("peer", Promise.resolve(true));
    internals._syncOnOpen.add("peer");
    internals._signalingServers.set("server", {});
    internals._webRTConnections.set("peer", {});
    internals._teardownSignalingConnection = jest.fn((id: string) => {
        internals._signalingServers.delete(id);
    });
    internals._teardownWebRTCConnection = jest.fn((id: string) => {
        internals._webRTConnections.delete(id);
    });

    controller.pauseConnections();
    expect(internals._lifecycleGeneration).toBe(oldGeneration + 1);
    expect(internals._connectAttempts.size).toBe(0);
    expect(internals._syncOnOpen.size).toBe(0);
    expect(internals._signalingServers.size).toBe(0);
    expect(internals._webRTConnections.size).toBe(0);

    internals.broadcastSignalingServerEvent("server", SignalingStatus.Connected);
    internals._webRTCStatus.set("peer", WebRTCStatus.Connected);
    internals.broadcastWebRTCConnectionEvent("peer", WebRTCStatus.Connected);
    expect(signalingStatus).toHaveBeenCalledTimes(1);
    expect(webRTCStatus).toHaveBeenCalledTimes(1);
    controller.removeSyncSignalingHandler("server", signalingHandlerId!);
});
