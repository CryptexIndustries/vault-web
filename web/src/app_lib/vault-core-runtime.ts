/**
 * Wire vault-core sync/link runtime to web platform adapters.
 * Import once from app entry (_app) and sync-controller entry points.
 */
import {
    configureVaultCoreRuntime,
    createWebCryptoEnvelopeCrypto,
} from "@cryptex-industries/vault-core/runtime";
import { env } from "@/env/public";
import { onlineServicesSessionPort } from "@/app_lib/online-services-session";
import {
    getDeviceSecondFactorKey,
    setDeviceSecondFactorKey,
} from "@/app_lib/vault-utils/vault-key-store";
import { syncLog, signalingLog, webrtcLog } from "@/utils/logging";
import { trpc } from "@/utils/trpc";

let configured = false;

export function ensureWebVaultCoreRuntime(): void {
    if (configured) return;
    configureVaultCoreRuntime({
        envelopeCrypto: createWebCryptoEnvelopeCrypto(),
        env: {
            NEXT_PUBLIC_PUSHER_APP_KEY: env.NEXT_PUBLIC_PUSHER_APP_KEY,
            NEXT_PUBLIC_PUSHER_APP_HOST: env.NEXT_PUBLIC_PUSHER_APP_HOST,
            NEXT_PUBLIC_PUSHER_APP_PORT: env.NEXT_PUBLIC_PUSHER_APP_PORT,
            NEXT_PUBLIC_PUSHER_APP_TLS: env.NEXT_PUBLIC_PUSHER_APP_TLS,
        },
        onlineServicesSessionPort,
        onlineServicesApi: {
            getTurnCredentials: (syncId) =>
                trpc.v1.device.turnCredentials.mutate({ syncId }),
            authorizeSignalingChannel: ({ channelName, socketId }) =>
                trpc.v1.device.signalingAuthChannel.mutate({
                    channel_name: channelName,
                    socket_id: socketId,
                }),
        },
        syncLog,
        signalingLog,
        webrtcLog,
        secondFactorStore: {
            setDeviceSecondFactorKey,
            getDeviceSecondFactorKey,
        },
    });
    configured = true;
}

ensureWebVaultCoreRuntime();
