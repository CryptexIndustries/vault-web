import { beforeEach, describe, expect, it, jest } from "@jest/globals";

if (typeof (Uint8Array as unknown as { fromBase64?: unknown }).fromBase64 !== "function") {
    Object.defineProperty(Uint8Array, "fromBase64", {
        value: (input: string) => new Uint8Array(Buffer.from(input, "base64")),
        writable: true,
        configurable: true,
    });
}

type RefreshInput = { sessionToken: string };
type RefreshResult = { sessionToken: string; expiresAt: number };
type ChallengeInput = { deviceId: string };
type ChallengeResult = {
    challengeId: string;
    challenge: string;
    expiresAt: number;
};
type VerifyInput = {
    challengeId: string;
    signature: string;
    deviceId: string;
};
type VerifyResult = { sessionToken: string; expiresAt: number };

const refreshMutate =
    jest.fn() as jest.MockedFunction<
        (input: RefreshInput) => Promise<RefreshResult>
    >;
const challengeMutate =
    jest.fn() as jest.MockedFunction<
        (input: ChallengeInput) => Promise<ChallengeResult>
    >;
const verifyMutate =
    jest.fn() as jest.MockedFunction<
        (input: VerifyInput) => Promise<VerifyResult>
    >;
const configurationQuery =
    jest.fn() as jest.MockedFunction<() => Promise<unknown>>;

jest.mock("@trpc/client", () => ({
    createTRPCClient: jest.fn(() => ({
        v1: {
            auth: {
                refresh: {
                    mutate: refreshMutate,
                },
                challenge: {
                    mutate: challengeMutate,
                },
                verify: {
                    mutate: verifyMutate,
                },
            },
            user: {
                configuration: {
                    query: configurationQuery,
                },
            },
        },
    })),
    httpBatchLink: jest.fn(() => ({})),
}));

jest.mock("../../src/app_lib/vault-utils/passkey", () => ({
    parseJwkFromString: jest.fn(),
    signChallenge: jest.fn(),
}));

import {
    createBareAuthHeader,
    ensureFreshOnlineServicesSession,
    establishPremiumSession,
    refreshOnlineServicesSession,
    syncOnlineServicesRemoteConfiguration,
} from "../../src/app_lib/auth-session";
import {
    parseJwkFromString,
    signChallenge,
} from "../../src/app_lib/vault-utils/passkey";
import { OnlineServices, Vault } from "../../src/app_lib/vault-utils/vault";
import {
    onlineServicesAuthConnectionStatusAtom,
    onlineServicesDataAtom,
    onlineServicesStore,
    setOnlineServicesData,
    unlockedVaultAtom,
    unlockedVaultMetadataAtom,
    vaultStore,
} from "../../src/utils/atoms";

jest.mock("../../src/utils/trpc", () => ({
    trpc: {
        v1: {
            user: {
                configuration: {
                    query: () => configurationQuery(),
                },
            },
        },
    },
}));

const mockParseJwkFromString =
    parseJwkFromString as jest.MockedFunction<typeof parseJwkFromString>;
const mockSignChallenge =
    signChallenge as jest.MockedFunction<typeof signChallenge>;

describe("auth-session freshness checks", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setOnlineServicesData(null);
        vaultStore.set(unlockedVaultAtom, new Vault());
    });

    it("returns false when there is no online session (null state)", async () => {
        expect(onlineServicesStore.get(onlineServicesDataAtom)).toBeNull();

        const refreshed = await ensureFreshOnlineServicesSession();

        expect(refreshed).toBe(false);
        expect(refreshMutate).not.toHaveBeenCalled();
    });

    it("returns false when sessionToken is empty", async () => {
        setOnlineServicesData({
            deviceId: "device_1",
            sessionToken: "",
            sessionExpiresAt: Date.now() + 10_000,
            remoteData: null,
        });

        const refreshed = await ensureFreshOnlineServicesSession();

        expect(refreshed).toBe(false);
        expect(refreshMutate).not.toHaveBeenCalled();
    });

    it("returns false when sessionExpiresAt is not set", async () => {
        setOnlineServicesData({
            deviceId: "device_1",
            sessionToken: "token_1",
            sessionExpiresAt: undefined as unknown as number,
            remoteData: null,
        });

        const refreshed = await ensureFreshOnlineServicesSession();

        expect(refreshed).toBe(false);
        expect(refreshMutate).not.toHaveBeenCalled();
    });

    it("returns false when refresh fails and the vault has no online services bound for re-auth", async () => {
        refreshMutate.mockRejectedValue(new Error("expired"));

        const vault = new Vault();
        vaultStore.set(unlockedVaultAtom, vault);

        setOnlineServicesData({
            deviceId: "device_1",
            sessionToken: "token_1",
            sessionExpiresAt: Date.now() + 10_000,
            remoteData: null,
        });

        const refreshed = await ensureFreshOnlineServicesSession();

        expect(refreshed).toBe(false);
        expect(refreshMutate).toHaveBeenCalled();
        expect(challengeMutate).not.toHaveBeenCalled();
        expect(verifyMutate).not.toHaveBeenCalled();
    });

    it("skips refresh when the session is not near expiry", async () => {
        setOnlineServicesData({
            deviceId: "device_1",
            sessionToken: "token_1",
            sessionExpiresAt: Date.now() + 5 * 60_000,
            remoteData: null,
        });

        const refreshed = await ensureFreshOnlineServicesSession();

        expect(refreshed).toBe(false);
        expect(refreshMutate).not.toHaveBeenCalled();
    });

    it("refreshes the session when expiry is near and keeps existing state", async () => {
        refreshMutate.mockResolvedValue({
            sessionToken: "token_2",
            expiresAt: Date.now() + 15 * 60_000,
        });

        setOnlineServicesData({
            deviceId: "device_1",
            sessionToken: "token_1",
            sessionExpiresAt: Date.now() + 30_000,
            remoteData: {
                deviceId: "device_1",
                root: true,
                canLink: true,
                maxLinks: 3,
                alwaysConnected: true,
                canFeatureVote: true,
                recoveryTokenCreatedAt: null,
            },
        });

        const refreshed = await ensureFreshOnlineServicesSession();
        const session = onlineServicesStore.get(onlineServicesDataAtom);

        expect(refreshed).toBe(true);
        expect(refreshMutate).toHaveBeenCalledWith({
            sessionToken: "token_1",
        });
        expect(session).toMatchObject({
            deviceId: "device_1",
            sessionToken: "token_2",
            remoteData: {
                root: true,
                canLink: true,
            },
        });
        expect(session?.sessionExpiresAt).toBeGreaterThan(Date.now());
    });

    it("deduplicates concurrent refresh attempts", async () => {
        let resolveRefresh: (value: RefreshResult) => void = () => undefined;

        refreshMutate.mockImplementation(
            () =>
                new Promise<{ sessionToken: string; expiresAt: number }>(
                    (resolve) => {
                        resolveRefresh = resolve;
                    },
                ),
        );

        setOnlineServicesData({
            deviceId: "device_1",
            sessionToken: "token_1",
            sessionExpiresAt: Date.now() + 10_000,
            remoteData: null,
        });

        const first = ensureFreshOnlineServicesSession();
        const second = ensureFreshOnlineServicesSession();

        expect(refreshMutate).toHaveBeenCalledTimes(1);

        resolveRefresh({
            sessionToken: "token_2",
            expiresAt: Date.now() + 15 * 60_000,
        });

        await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
        expect(refreshMutate).toHaveBeenCalledTimes(1);
    });

    it("re-authenticates with passkey material when refresh fails", async () => {
        refreshMutate.mockRejectedValue(new Error("expired"));
        challengeMutate.mockResolvedValue({
            challengeId: "challenge_1",
            challenge: btoa("challenge-bytes"),
            expiresAt: Date.now() + 60_000,
        });
        verifyMutate.mockResolvedValue({
            sessionToken: "token_2",
            expiresAt: Date.now() + 15 * 60_000,
        });
        mockParseJwkFromString.mockReturnValue({ kty: "EC" } as JsonWebKey);
        mockSignChallenge.mockResolvedValue("signature_1");

        const vault = new Vault();
        Vault.bindOnlineServices(
            vault,
            new OnlineServices("device_1", "", "public_jwk", "private_jwk"),
        );
        vaultStore.set(unlockedVaultAtom, vault);

        setOnlineServicesData({
            deviceId: "device_1",
            sessionToken: "token_1",
            sessionExpiresAt: Date.now() + 10_000,
            remoteData: null,
        });

        const refreshed = await ensureFreshOnlineServicesSession();
        const session = onlineServicesStore.get(onlineServicesDataAtom);

        expect(refreshed).toBe(true);
        expect(refreshMutate).toHaveBeenCalledWith({
            sessionToken: "token_1",
        });
        expect(challengeMutate).toHaveBeenCalledWith({
            deviceId: "device_1",
        });
        expect(verifyMutate).toHaveBeenCalledWith({
            challengeId: "challenge_1",
            signature: "signature_1",
            deviceId: "device_1",
        });
        expect(session).toMatchObject({
            deviceId: "device_1",
            sessionToken: "token_2",
        });
    });

    it("returns false when passkey re-authentication fails after refresh failure", async () => {
        refreshMutate.mockRejectedValue(new Error("expired"));
        challengeMutate.mockRejectedValue(new Error("challenge failed"));

        const vault = new Vault();
        Vault.bindOnlineServices(
            vault,
            new OnlineServices("device_1", "", "public_jwk", "private_jwk"),
        );
        vaultStore.set(unlockedVaultAtom, vault);

        setOnlineServicesData({
            deviceId: "device_1",
            sessionToken: "token_1",
            sessionExpiresAt: Date.now() + 10_000,
            remoteData: null,
        });

        await expect(ensureFreshOnlineServicesSession()).resolves.toBe(false);
        expect(challengeMutate).toHaveBeenCalledWith({ deviceId: "device_1" });
    });
});

describe("createBareAuthHeader", () => {
    beforeEach(() => {
        setOnlineServicesData(null);
    });

    it("returns empty Authorization when no token is present", () => {
        expect(createBareAuthHeader()).toEqual({ Authorization: "" });
    });

    it("returns Bearer header when a session token is present", () => {
        setOnlineServicesData({
            deviceId: "device_1",
            sessionToken: "abc.def.ghi",
            sessionExpiresAt: Date.now() + 60_000,
            remoteData: null,
        });
        expect(createBareAuthHeader()).toEqual({
            Authorization: "Bearer abc.def.ghi",
        });
    });
});

describe("refreshOnlineServicesSession", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setOnlineServicesData(null);
    });

    it("returns false when there is no current session", async () => {
        await expect(refreshOnlineServicesSession()).resolves.toBe(false);
        expect(refreshMutate).not.toHaveBeenCalled();
    });

    it("returns false when mutate succeeds but state was cleared mid-flight", async () => {
        setOnlineServicesData({
            deviceId: "device_1",
            sessionToken: "token_1",
            sessionExpiresAt: Date.now() + 30_000,
            remoteData: null,
        });

        refreshMutate.mockImplementation(async () => {
            setOnlineServicesData(null);
            return {
                sessionToken: "token_2",
                expiresAt: Date.now() + 15 * 60_000,
            };
        });

        await expect(refreshOnlineServicesSession()).resolves.toBe(false);
        expect(refreshMutate).toHaveBeenCalledTimes(1);
        expect(onlineServicesStore.get(onlineServicesDataAtom)).toBeNull();
    });

    it("returns false when mutate rejects", async () => {
        setOnlineServicesData({
            deviceId: "device_1",
            sessionToken: "token_1",
            sessionExpiresAt: Date.now() + 30_000,
            remoteData: null,
        });
        refreshMutate.mockRejectedValue(new Error("boom"));

        await expect(refreshOnlineServicesSession()).resolves.toBe(false);
    });
});

describe("establishPremiumSession", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setOnlineServicesData(null);
        onlineServicesStore.set(
            onlineServicesAuthConnectionStatusAtom,
            { status: "DISCONNECTED", statusDescription: "Disconnected" },
        );
        mockParseJwkFromString.mockReturnValue({ kty: "EC" } as JsonWebKey);
        mockSignChallenge.mockResolvedValue("signed_sig");
    });

    it("runs the full challenge-response flow on success", async () => {
        challengeMutate.mockResolvedValue({
            challengeId: "ch_1",
            challenge: btoa("challenge-bytes"),
            expiresAt: Date.now() + 60_000,
        });
        verifyMutate.mockResolvedValue({
            sessionToken: "new_token",
            expiresAt: Date.now() + 15 * 60_000,
        });

        await establishPremiumSession({
            deviceId: "device_1",
            privateKeyJWK: "private_jwk",
        });

        expect(challengeMutate).toHaveBeenCalledWith({ deviceId: "device_1" });
        expect(mockParseJwkFromString).toHaveBeenCalledWith("private_jwk");
        expect(mockSignChallenge).toHaveBeenCalled();
        expect(verifyMutate).toHaveBeenCalledWith({
            challengeId: "ch_1",
            signature: "signed_sig",
            deviceId: "device_1",
        });

        expect(onlineServicesStore.get(onlineServicesDataAtom)).toMatchObject({
            deviceId: "device_1",
            sessionToken: "new_token",
        });
        expect(
            onlineServicesStore.get(onlineServicesAuthConnectionStatusAtom)
                .status,
        ).toBe("CONNECTED");
    });

    it("marks status FAILED and rethrows when the flow fails", async () => {
        challengeMutate.mockRejectedValue(new Error("nope"));

        await expect(
            establishPremiumSession({
                deviceId: "device_1",
                privateKeyJWK: "private_jwk",
            }),
        ).rejects.toThrow("nope");

        const status = onlineServicesStore.get(
            onlineServicesAuthConnectionStatusAtom,
        );
        expect(status.status).toBe("FAILED");
        expect(status.statusDescription).toBe("nope");
    });
});

describe("syncOnlineServicesRemoteConfiguration", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setOnlineServicesData(null);
        vaultStore.set(unlockedVaultAtom, new Vault());
        vaultStore.set(unlockedVaultMetadataAtom, null);
    });

    it("returns early when there is no online services session", async () => {
        await syncOnlineServicesRemoteConfiguration();
        expect(configurationQuery).not.toHaveBeenCalled();
    });

    it("queries server config and merges into atom when bound but no metadata blob", async () => {
        const remoteData = {
            deviceId: "device_1",
            root: true,
            canLink: true,
            maxLinks: 3,
            alwaysConnected: true,
            canFeatureVote: true,
            recoveryTokenCreatedAt: null,
        };
        configurationQuery.mockResolvedValue(remoteData);

        setOnlineServicesData({
            deviceId: "device_1",
            sessionToken: "tk_1",
            sessionExpiresAt: Date.now() + 60_000,
            remoteData: null,
        });

        await syncOnlineServicesRemoteConfiguration();

        const session = onlineServicesStore.get(onlineServicesDataAtom);
        expect(session?.deviceId).toBe("device_1");
        expect(session?.remoteData).toMatchObject({ root: true });
    });

    it("clones the vault and updates IsRootDevice when blob exists and remote root differs from cached", async () => {
        const remoteData = {
            deviceId: "device_1",
            root: true,
            canLink: true,
            maxLinks: 3,
            alwaysConnected: true,
            canFeatureVote: true,
            recoveryTokenCreatedAt: null,
        };
        configurationQuery.mockResolvedValue(remoteData);

        setOnlineServicesData({
            deviceId: "device_1",
            sessionToken: "tk_1",
            sessionExpiresAt: Date.now() + 60_000,
            remoteData: null,
        });

        const vault = new Vault();
        Vault.bindOnlineServices(
            vault,
            new OnlineServices(
                "device_1",
                "",
                "public_jwk",
                "private_jwk",
                false,
            ),
        );
        vaultStore.set(unlockedVaultAtom, vault);
        vaultStore.set(unlockedVaultMetadataAtom, {
            Blob: new Uint8Array([1, 2, 3]),
        } as never);

        await syncOnlineServicesRemoteConfiguration();

        const next = vaultStore.get(unlockedVaultAtom);
        expect(Vault.isOnlineServicesBound(next)).toBe(true);
        if (Vault.isOnlineServicesBound(next)) {
            expect(next.OnlineServices.IsRootDevice).toBe(true);
        }
    });

    it("does not clone vault when cached root already matches remote", async () => {
        const remoteData = {
            deviceId: "device_1",
            root: true,
            canLink: true,
            maxLinks: 3,
            alwaysConnected: true,
            canFeatureVote: true,
            recoveryTokenCreatedAt: null,
        };
        configurationQuery.mockResolvedValue(remoteData);

        setOnlineServicesData({
            deviceId: "device_1",
            sessionToken: "tk_1",
            sessionExpiresAt: Date.now() + 60_000,
            remoteData: null,
        });

        const vault = new Vault();
        Vault.bindOnlineServices(
            vault,
            new OnlineServices(
                "device_1",
                "",
                "public_jwk",
                "private_jwk",
                true,
            ),
        );
        vaultStore.set(unlockedVaultAtom, vault);
        vaultStore.set(unlockedVaultMetadataAtom, {
            Blob: new Uint8Array([1, 2, 3]),
        } as never);

        await syncOnlineServicesRemoteConfiguration();

        expect(vaultStore.get(unlockedVaultAtom)).toBe(vault);
    });
});
