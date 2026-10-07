/**
 * Wire vault-core sync/link runtime for React Native.
 */
import "./polyfills";

import { configureVaultCoreRuntime } from "@cryptex-industries/vault-core/runtime";
import { createMobileEnvelopeCrypto } from "@/crypto/envelope-crypto";
import { env } from "@/env";
import { onlineServicesSessionPort } from "@/app_lib/online-services-session";
import {
    getDeviceAdditionalKeyProtectionKey,
    setDeviceAdditionalKeyProtectionKey,
    setDeviceAdditionalKeyProtectionRawKey,
} from "@/app_lib/vault-utils/vault-key-store";
import { syncLog, signalingLog, webrtcLog } from "@/utils/logging";
import { trpc } from "@/utils/trpc";

let configured = false;

export function ensureMobileVaultCoreRuntime(): void {
    if (configured) return;
    const envelopeCrypto = createMobileEnvelopeCrypto();
    configureVaultCoreRuntime({
        envelopeCrypto,
        env: {
            NEXT_PUBLIC_PUSHER_APP_KEY: env.PUSHER_APP_KEY,
            NEXT_PUBLIC_PUSHER_APP_HOST: env.PUSHER_APP_HOST,
            NEXT_PUBLIC_PUSHER_APP_PORT: env.PUSHER_APP_PORT,
            NEXT_PUBLIC_PUSHER_APP_TLS: env.PUSHER_APP_TLS,
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
        additionalKeyProtectionStore: {
            setDeviceAdditionalKeyProtectionKey,
            setDeviceAdditionalKeyProtectionRawKey,
            getDeviceAdditionalKeyProtectionKey,
        },
    });
    // Start the native known-answer test immediately. Every crypto operation
    // also awaits the same cached result and therefore fails closed.
    void envelopeCrypto.selfTest().catch(() => undefined);
    configured = true;
}

ensureMobileVaultCoreRuntime();
