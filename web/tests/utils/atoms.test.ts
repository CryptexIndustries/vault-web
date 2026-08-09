import { describe, it, expect, beforeEach } from "@jest/globals";

import {
    DEFAULT_ONLINE_SERVICES_AUTH_CONNECTION_STATUS,
    OnlineServicesAuthenticationStatusHelpers,
    clearOnlineServicesSession,
    onlineServicesAuthConnectionStatusAtom,
    onlineServicesAuthenticationStatus,
    onlineServicesDataAtom,
    onlineServicesStore,
    setOnlineServicesData,
    unlockedVaultAtom,
    unlockedVaultWriteOnlyAtom,
    vaultStore,
    type OnlineServicesData,
} from "../../src/utils/atoms";
import { Vault } from "@cryptex-industries/vault-core/vault-utils/vault";

const sampleData: OnlineServicesData = {
    sessionToken: "tok",
    sessionExpiresAt: 1000,
    deviceId: "device-1",
    remoteData: {
        deviceId: "device-1",
        root: true,
        canLink: true,
        maxLinks: 5,
        recoveryTokenCreatedAt: null,
        recoveryGenerationNeeded: false,
    },
};

describe("OnlineServicesAuthenticationStatusHelpers", () => {
    it("setConnected returns CONNECTED with default label", () => {
        const status = OnlineServicesAuthenticationStatusHelpers.setConnected();
        expect(status).toEqual({
            status: "CONNECTED",
            statusDescription: "Signed in",
        });
    });

    it("setConnecting returns CONNECTING with default label", () => {
        const status =
            OnlineServicesAuthenticationStatusHelpers.setConnecting();
        expect(status).toEqual({
            status: "CONNECTING",
            statusDescription: "Signing in...",
        });
    });

    it("setDisconnected returns DISCONNECTED with default label", () => {
        const status =
            OnlineServicesAuthenticationStatusHelpers.setDisconnected();
        expect(status).toEqual({
            status: "DISCONNECTED",
            statusDescription: "Disconnected",
        });
    });

    it("setFailed returns FAILED with custom description", () => {
        const status =
            OnlineServicesAuthenticationStatusHelpers.setFailed("boom");
        expect(status).toEqual({
            status: "FAILED",
            statusDescription: "boom",
        });
    });

    it("setFailed returns FAILED with default description when no arg", () => {
        const status = OnlineServicesAuthenticationStatusHelpers.setFailed();
        expect(status).toEqual({
            status: "FAILED",
            statusDescription: "Unknown failure occurred",
        });
    });

    it("DEFAULT_ONLINE_SERVICES_AUTH_CONNECTION_STATUS matches disconnected()", () => {
        expect(DEFAULT_ONLINE_SERVICES_AUTH_CONNECTION_STATUS).toEqual(
            onlineServicesAuthenticationStatus.disconnected(),
        );
    });
});

describe("clearOnlineServicesSession", () => {
    beforeEach(() => {
        onlineServicesStore.set(onlineServicesDataAtom, null);
        onlineServicesStore.set(
            onlineServicesAuthConnectionStatusAtom,
            DEFAULT_ONLINE_SERVICES_AUTH_CONNECTION_STATUS,
        );
    });

    it("resets the online-services data atom to null", () => {
        setOnlineServicesData(sampleData);
        expect(onlineServicesStore.get(onlineServicesDataAtom)).toEqual(
            sampleData,
        );

        clearOnlineServicesSession();
        expect(onlineServicesStore.get(onlineServicesDataAtom)).toBeNull();
    });

    it("preserves the server recovery-generation flag", () => {
        setOnlineServicesData({
            ...sampleData,
            remoteData: {
                ...sampleData.remoteData!,
                recoveryGenerationNeeded: true,
            },
        });

        expect(
            onlineServicesStore.get(onlineServicesDataAtom)?.remoteData
                ?.recoveryGenerationNeeded,
        ).toBe(true);
    });
});

describe("unlockedVaultWriteOnlyAtom", () => {
    beforeEach(() => {
        vaultStore.set(unlockedVaultAtom, new Vault());
    });

    it("reads via the get-only path and returns the current Vault", () => {
        const initial = vaultStore.get(unlockedVaultWriteOnlyAtom);
        expect(initial).toBe(vaultStore.get(unlockedVaultAtom));
    });

    it("setter accepts a direct Vault value", async () => {
        const next = new Vault();
        await vaultStore.set(unlockedVaultWriteOnlyAtom, next);
        expect(vaultStore.get(unlockedVaultAtom)).toBe(next);
    });

    it("setter awaits an async producer function", async () => {
        const next = new Vault();
        await vaultStore.set(unlockedVaultWriteOnlyAtom, async () => next);
        expect(vaultStore.get(unlockedVaultAtom)).toBe(next);
    });

    it("setter awaits a sync producer function with access to previous vault", async () => {
        const previous = vaultStore.get(unlockedVaultAtom);
        const observed: Vault[] = [];
        await vaultStore.set(unlockedVaultWriteOnlyAtom, (pre) => {
            observed.push(pre);
            return new Vault();
        });
        expect(observed[0]).toBe(previous);
    });
});
