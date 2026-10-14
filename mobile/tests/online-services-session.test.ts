import { beforeEach, expect, it, jest } from "@jest/globals";
import {
    establishOnlineServicesSession,
    logoutOnlineServicesSession,
    refreshOnlineServicesSession,
    syncOnlineServicesRemoteConfiguration,
    ensureFreshOnlineServicesSession,
} from "@/app_lib/auth-session";
import {
    onlineServicesDataAtom,
    onlineServicesStore,
    setOnlineServicesData,
} from "@/utils/atoms";
import {
    performOnlineServicesDeviceSigningKeyAuth,
    refreshOnlineServicesSessionTokens,
} from "@cryptex-industries/vault-core/online-services-session/protocol";
import { getVaultSessionGeneration } from "@/utils/vault-session";
import { trpc } from "@/utils/trpc";

jest.mock("@/utils/online-services-transport", () => ({
    onlineServicesLinks: jest.fn(() => []),
}));
jest.mock("@trpc/client", () => ({
    createTRPCClient: () => ({
        v1: {
            auth: {
                challenge: { mutate: jest.fn() },
                verify: { mutate: jest.fn() },
                refresh: { mutate: jest.fn() },
                logout: { mutate: () => new Promise(() => {}) },
            },
        },
    }),
}));
jest.mock("@/utils/trpc", () => ({
    trpc: { v1: { user: { configuration: { query: jest.fn() } } } },
}));
jest.mock("@/utils/vault-session", () => ({
    getVaultSessionGeneration: jest.fn(() => 1),
}));
jest.mock("@/utils/online-services-api-url", () => ({
    isCloudServicesEnabled: () => true,
}));
jest.mock("@cryptex-industries/vault-core/vault-utils/vault", () => ({
    Vault: class {
        static isOnlineServicesBound() {
            return false;
        }
    },
}));
jest.mock(
    "@cryptex-industries/vault-core/online-services-session/protocol",
    () => ({
        performOnlineServicesDeviceSigningKeyAuth: jest.fn(),
        refreshOnlineServicesSessionTokens: jest.fn(),
        shouldRefreshOnlineServicesSession: (expires: number) =>
            expires < Date.now() + 60_000,
    }),
);

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((r) => {
        resolve = r;
    });
    return { promise, resolve };
}
const tokens = {
    sessionToken: "access",
    refreshToken: "refresh",
    expiresAt: Date.now() + 600_000,
    refreshExpiresAt: Date.now() + 900_000,
};
const options = { deviceId: "device-a", privateKeyJWK: "test-key" };
const current = () => onlineServicesStore.get(onlineServicesDataAtom);

beforeEach(async () => {
    await logoutOnlineServicesSession();
    jest.mocked(getVaultSessionGeneration).mockReturnValue(1);
    jest.mocked(performOnlineServicesDeviceSigningKeyAuth)
        .mockReset()
        .mockResolvedValue(tokens);
    jest.mocked(refreshOnlineServicesSessionTokens)
        .mockReset()
        .mockResolvedValue(tokens);
});

it("deduplicates sign-in and keeps a valid session without another challenge", async () => {
    const pending = deferred<typeof tokens>();
    jest.mocked(performOnlineServicesDeviceSigningKeyAuth).mockReturnValue(
        pending.promise,
    );
    const first = establishOnlineServicesSession(options);
    const second = establishOnlineServicesSession(options);
    expect(first).toBe(second);
    pending.resolve(tokens);
    await first;
    await expect(ensureFreshOnlineServicesSession()).resolves.toBe(false);
    expect(performOnlineServicesDeviceSigningKeyAuth).toHaveBeenCalledTimes(1);
});

it("does not restore tokens when sign-in completes after logout", async () => {
    const pending = deferred<typeof tokens>();
    jest.mocked(performOnlineServicesDeviceSigningKeyAuth).mockReturnValue(
        pending.promise,
    );
    const signIn = establishOnlineServicesSession(options);
    await logoutOnlineServicesSession();
    pending.resolve(tokens);
    await expect(signIn).rejects.toThrow("session changed");
    expect(current()).toBeNull();
});

it("rejects late sign-in even when the same vault was locked and unlocked again", async () => {
    const pending = deferred<typeof tokens>();
    jest.mocked(performOnlineServicesDeviceSigningKeyAuth).mockReturnValue(
        pending.promise,
    );
    const signIn = establishOnlineServicesSession(options);
    jest.mocked(getVaultSessionGeneration).mockReturnValue(2);
    pending.resolve(tokens);
    await expect(signIn).rejects.toThrow("session changed");
    expect(current()).toBeNull();
});

it("deduplicates refresh and ignores its result after logout", async () => {
    await establishOnlineServicesSession(options);
    const pending = deferred<typeof tokens>();
    jest.mocked(refreshOnlineServicesSessionTokens).mockReturnValue(
        pending.promise,
    );
    const refresh = refreshOnlineServicesSession();
    expect(refreshOnlineServicesSession()).toBe(refresh);
    await logoutOnlineServicesSession();
    pending.resolve(tokens);
    await expect(refresh).resolves.toBe(false);
    expect(current()).toBeNull();
});

it("clears locally without waiting for a stalled logout endpoint", async () => {
    await establishOnlineServicesSession(options);
    await logoutOnlineServicesSession();
    expect(current()).toBeNull();
});

it("keeps explicit sign-out until the user signs in again", async () => {
    await establishOnlineServicesSession(options);
    await logoutOnlineServicesSession();
    await expect(ensureFreshOnlineServicesSession()).resolves.toBe(false);
    expect(current()).toBeNull();
    expect(performOnlineServicesDeviceSigningKeyAuth).toHaveBeenCalledTimes(1);
    await establishOnlineServicesSession(options);
    expect(current()?.sessionToken).toBe(tokens.sessionToken);
});

it("does not overwrite rotated tokens when configuration finishes", async () => {
    await establishOnlineServicesSession(options);
    const pending =
        deferred<
            Awaited<ReturnType<typeof trpc.v1.user.configuration.query>>
        >();
    jest.mocked(trpc.v1.user.configuration.query).mockReturnValue(
        pending.promise,
    );
    const configuration = syncOnlineServicesRemoteConfiguration();
    await Promise.resolve();
    setOnlineServicesData({ ...current()!, sessionToken: "rotated" });
    pending.resolve({
        deviceId: "device-a",
        root: true,
        canLink: true,
        maxLinks: 5,
        canPromoteDevices: true,
        managedEncryptedBackups: true,
        passwordSharing: true,
        securityReportBasic: true,
        securityReportAdvanced: true,
        recoveryGenerationNeeded: false,
        recoveryTokenCreatedAt: null,
    });
    await configuration;
    expect(current()?.sessionToken).toBe("rotated");
    expect(current()?.remoteData?.root).toBe(true);
});

it("does not carry account configuration between devices", async () => {
    await establishOnlineServicesSession(options);
    setOnlineServicesData({
        ...current()!,
        remoteData: {
            root: true,
            canLink: true,
            maxLinks: 5,
            recoveryTokenCreatedAt: null,
        },
    });
    await establishOnlineServicesSession({ ...options, deviceId: "device-b" });
    expect(current()?.deviceId).toBe("device-b");
    expect(current()?.remoteData).toBeNull();
});
