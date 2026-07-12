import {
    parseJwkFromString,
    signChallenge,
} from "@/app_lib/vault-utils/passkey";

export const SESSION_REFRESH_LEAD_MS = 60_000;
export const FORCED_REAUTH_COOLDOWN_MS = 30_000;

export type OnlineServicesSessionTokens = {
    sessionToken: string;
    refreshToken: string;
    expiresAt: number;
    refreshExpiresAt: number;
};

export type OnlineServicesAuthApi = {
    challenge(deviceId: string): Promise<{
        challengeId: string;
        challenge: string;
    }>;
    verify(input: {
        challengeId: string;
        signature: string;
        deviceId: string;
    }): Promise<OnlineServicesSessionTokens>;
    refresh(refreshToken: string): Promise<OnlineServicesSessionTokens>;
};

export function shouldRefreshOnlineServicesSession(
    expiresAtMs: number,
    nowMs: number = Date.now(),
): boolean {
    return expiresAtMs - nowMs <= SESSION_REFRESH_LEAD_MS;
}

export async function performOnlineServicesPasskeyAuth(
    api: OnlineServicesAuthApi,
    args: { deviceId: string; privateKeyJWK: string },
): Promise<OnlineServicesSessionTokens> {
    const challenge = await api.challenge(args.deviceId);
    const challengeBytes = Uint8Array.fromBase64(challenge.challenge);
    const signature = await signChallenge(
        parseJwkFromString(args.privateKeyJWK),
        challengeBytes,
    );

    return api.verify({
        challengeId: challenge.challengeId,
        signature,
        deviceId: args.deviceId,
    });
}

export async function refreshOnlineServicesSessionTokens(
    api: OnlineServicesAuthApi,
    refreshToken: string,
): Promise<OnlineServicesSessionTokens | null> {
    try {
        return await api.refresh(refreshToken);
    } catch {
        return null;
    }
}

export function createRefreshInFlightRunner(): {
    run<T>(task: () => Promise<T>): Promise<T>;
} {
    let refreshInFlight: Promise<unknown> | null = null;

    return {
        run<T>(task: () => Promise<T>): Promise<T> {
            if (refreshInFlight) {
                return refreshInFlight as Promise<T>;
            }

            refreshInFlight = task().finally(() => {
                refreshInFlight = null;
            });

            return refreshInFlight as Promise<T>;
        },
    };
}

export function createForcedReauthGate(
    cooldownMs: number = FORCED_REAUTH_COOLDOWN_MS,
): {
    tryEnter(nowMs?: number): boolean;
} {
    let nextForcedReauthAtMs = 0;

    return {
        tryEnter(nowMs: number = Date.now()): boolean {
            if (nowMs < nextForcedReauthAtMs) {
                return false;
            }

            nextForcedReauthAtMs = nowMs + cooldownMs;
            return true;
        },
    };
}
