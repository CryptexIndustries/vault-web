/**
 * Platform runtime ports for sync/link modules that still need env, logging,
 * tRPC, and Online Services session lifecycle. Configure once at app startup.
 */
import type { OnlineServicesSessionPort } from "./online-services-session/port";
import type * as VaultUtilTypes from "./proto/vault";
import type { VaultEnvelopeCrypto, VaultHkdfKey } from "./envelope-crypto";
export { createWebCryptoEnvelopeCrypto } from "./internal/envelope-crypto";
export type {
    VaultEnvelopeCrypto,
    VaultEnvelopeCryptoBackend,
    VaultHkdfKey,
    VaultKek,
} from "./envelope-crypto";

export type VaultCorePusherEnv = {
    NEXT_PUBLIC_PUSHER_APP_KEY: string;
    NEXT_PUBLIC_PUSHER_APP_HOST: string;
    NEXT_PUBLIC_PUSHER_APP_PORT: string;
    NEXT_PUBLIC_PUSHER_APP_TLS: boolean;
};

export type VaultCoreLogger = {
    debug: (message: string, context?: Record<string, unknown>) => void;
    info: (message: string, context?: Record<string, unknown>) => void;
    warn: (message: string, context?: Record<string, unknown>) => void;
    error: (message: string, context?: Record<string, unknown>) => void;
};

export type VaultCoreOnlineServicesApi = {
    getTurnCredentials: (syncId: string) => Promise<{
        iceServers: RTCIceServer[];
        expiresAt: number;
    }>;
    authorizeSignalingChannel: (input: {
        channelName: string;
        socketId: string;
    }) => Promise<{
        auth: string;
        channel_data?: string;
        shared_secret?: string;
    }>;
};

/** Platform local key store for device-bound second-factor HKDF keys. */
export type VaultCoreSecondFactorStore = {
    setDeviceSecondFactorKey: (
        vaultDbIndex: number,
        factorHkdfKey: VaultHkdfKey | null,
        kind: VaultUtilTypes.SecondFactorKind,
        webauthnCredentialId?: string,
        webauthnPrfSalt?: string,
    ) => Promise<void>;
    /**
     * Native stores should prefer raw IKM because HKDF CryptoKeys are
     * deliberately imported as non-extractable.
     */
    setDeviceSecondFactorRawKey?: (
        vaultDbIndex: number,
        factorIkm: Uint8Array,
        kind: VaultUtilTypes.SecondFactorKind,
        webauthnCredentialId?: string,
        webauthnPrfSalt?: string,
    ) => Promise<void>;
    getDeviceSecondFactorKey: (
        vaultDbIndex: number,
    ) => Promise<VaultHkdfKey | null>;
};

export type VaultCoreRuntime = {
    env: VaultCorePusherEnv;
    onlineServicesSessionPort: OnlineServicesSessionPort;
    onlineServicesApi: VaultCoreOnlineServicesApi;
    syncLog: VaultCoreLogger;
    signalingLog: VaultCoreLogger;
    webrtcLog: VaultCoreLogger;
    envelopeCrypto: VaultEnvelopeCrypto;
    /** Optional until a vault unlock/create path needs device 2FA cache. */
    secondFactorStore?: VaultCoreSecondFactorStore;
};

let runtime: VaultCoreRuntime | null = null;

export function configureVaultCoreRuntime(next: VaultCoreRuntime): void {
    runtime = next;
}

export function getVaultCoreRuntime(): VaultCoreRuntime {
    if (!runtime) {
        throw new Error(
            "Vault core runtime is not configured. Call configureVaultCoreRuntime() at app startup.",
        );
    }
    return runtime;
}

export function getSecondFactorStore(): VaultCoreSecondFactorStore {
    const store = getVaultCoreRuntime().secondFactorStore;
    if (!store) {
        throw new Error(
            "Vault core second-factor store is not configured on this platform runtime.",
        );
    }
    return store;
}

export function getEnvelopeCrypto(): VaultEnvelopeCrypto {
    return getVaultCoreRuntime().envelopeCrypto;
}

export function isVaultCoreRuntimeConfigured(): boolean {
    return runtime !== null;
}
