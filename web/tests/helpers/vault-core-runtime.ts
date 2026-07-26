import { configureVaultCoreRuntime } from "@cryptex-industries/vault-core/runtime";
import type { OnlineServicesSessionPort } from "@cryptex-industries/vault-core/online-services-session/port";

const noopLog = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
};

type TestTrpcClient = {
    v1: {
        device: {
            turnCredentials: {
                mutate(input: { syncId: string }): Promise<{
                    iceServers: RTCIceServer[];
                    expiresAt: number;
                }>;
            };
            signalingAuthChannel: {
                mutate(input: {
                    channel_name: string;
                    socket_id: string;
                }): Promise<{
                    auth: string;
                    channel_data?: string;
                    shared_secret?: string;
                }>;
            };
        };
    };
};

export type TestVaultCoreRuntimeOpts = {
    trpc?: unknown;
    onlineServicesSessionPort?: OnlineServicesSessionPort;
};

/**
 * Configure vault-core runtime for Jest. Sync/link modules no longer import
 * web env/trpc directly.
 */
export function configureTestVaultCoreRuntime(
    opts: TestVaultCoreRuntimeOpts = {},
): void {
    const trpc = (opts.trpc ?? {
        v1: {
            device: {
                signalingAuthChannel: {
                    mutate: async () => ({ auth: "stub-auth" }),
                },
                turnCredentials: {
                    mutate: async () => ({
                        iceServers: [],
                        expiresAt: Date.now() + 300_000,
                    }),
                },
            },
        },
    }) as TestTrpcClient;

    configureVaultCoreRuntime({
        env: {
            NEXT_PUBLIC_PUSHER_APP_KEY: "test-key",
            NEXT_PUBLIC_PUSHER_APP_HOST: "localhost",
            NEXT_PUBLIC_PUSHER_APP_PORT: "6001",
            NEXT_PUBLIC_PUSHER_APP_TLS: false,
        },
        onlineServicesSessionPort: opts.onlineServicesSessionPort ?? {
            ensureFresh: async () => true,
            forceReauthenticate: async () => false,
        },
        onlineServicesApi: {
            getTurnCredentials: (syncId) =>
                trpc.v1.device.turnCredentials.mutate({ syncId }),
            authorizeSignalingChannel: ({ channelName, socketId }) =>
                trpc.v1.device.signalingAuthChannel.mutate({
                    channel_name: channelName,
                    socket_id: socketId,
                }),
        },
        syncLog: noopLog,
        signalingLog: noopLog,
        webrtcLog: noopLog,
        secondFactorStore: {
            setDeviceSecondFactorKey: async () => undefined,
            getDeviceSecondFactorKey: async () => null,
        },
    });
}
