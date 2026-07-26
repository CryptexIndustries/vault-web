/**
 * @jest-environment jsdom
 */
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { webcrypto } from "crypto";

Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    writable: true,
});

import { Vault } from "@cryptex-industries/vault-core/vault-utils/vault";
import {
    onlineServicesAuthConnectionStatusAtom,
    onlineServicesDataAtom,
    onlineServicesStore,
    onlineServicesAuthenticationStatus,
    setOnlineServicesData,
    unlockedVaultAtom,
    vaultStore,
} from "../../src/utils/atoms";
import {
    clearVaultDEKFromSession,
    getVaultDEKFromSession,
    setVaultDEKInSession,
} from "../../src/utils/vault-session";
import { lockUnlockedVault } from "../../src/utils/vault-lock";

jest.mock("../../src/app_lib/auth-session", () => ({
    logoutOnlineServicesSession: jest.fn(async () => {
        setOnlineServicesData(null);
        onlineServicesStore.set(
            onlineServicesAuthConnectionStatusAtom,
            onlineServicesAuthenticationStatus.disconnected(),
        );
    }),
}));

describe("lockUnlockedVault", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        clearVaultDEKFromSession();
        setOnlineServicesData(null);
        onlineServicesStore.set(
            onlineServicesAuthConnectionStatusAtom,
            onlineServicesAuthenticationStatus.disconnected(),
        );
    });

    it("saves the vault, clears secrets, clears online services, and resets vault state", async () => {
        const dek = await crypto.subtle.generateKey(
            { name: "AES-GCM", length: 256 },
            false,
            ["encrypt", "decrypt"],
        );
        setVaultDEKInSession(dek);
        setOnlineServicesData({
            sessionToken: "session-token",
            sessionExpiresAt: Date.now() + 60_000,
            deviceId: "device-1",
            remoteData: null,
        });
        onlineServicesStore.set(
            onlineServicesAuthConnectionStatusAtom,
            onlineServicesAuthenticationStatus.connected(),
        );

        const vault = new Vault();
        vaultStore.set(unlockedVaultAtom, vault);
        const save = jest.fn(async () => undefined);
        const metadata = { DBIndex: 1, save };
        const teardown = jest.fn();
        let nextVault: Vault | null = null;
        let nextMetadata: unknown = metadata;

        const result = await lockUnlockedVault({
            unlockedVaultMetadata: metadata as never,
            setUnlockedVault: async (value) => {
                nextVault =
                    typeof value === "function" ? await value(vault) : value;
            },
            setUnlockedVaultMetadata: (value) => {
                nextMetadata = value;
            },
            syncConnectionController: { teardown } as never,
        });

        expect(result.isOk()).toBe(true);
        expect(save).toHaveBeenCalledWith(vault, dek);
        expect(teardown).toHaveBeenCalledTimes(1);
        expect(getVaultDEKFromSession().isErr()).toBe(true);
        expect(onlineServicesStore.get(onlineServicesDataAtom)).toBeNull();
        expect(
            onlineServicesStore.get(onlineServicesAuthConnectionStatusAtom),
        ).toEqual(onlineServicesAuthenticationStatus.disconnected());
        expect(nextMetadata).toBeNull();
        expect(nextVault).toBeInstanceOf(Vault);
        expect(nextVault).not.toBe(vault);
    });

    it("does not clear session state when save fails", async () => {
        const dek = await crypto.subtle.generateKey(
            { name: "AES-GCM", length: 256 },
            false,
            ["encrypt", "decrypt"],
        );
        setVaultDEKInSession(dek);
        const vault = new Vault();
        vaultStore.set(unlockedVaultAtom, vault);

        const result = await lockUnlockedVault({
            unlockedVaultMetadata: {
                DBIndex: 1,
                save: jest.fn(async () => {
                    throw new Error("disk full");
                }),
            } as never,
            setUnlockedVault: async () => undefined,
            setUnlockedVaultMetadata: () => undefined,
        });

        expect(result.isErr()).toBe(true);
        expect((result as { error: string }).error).toBe("VAULT_SAVE_FAILED");
        expect(getVaultDEKFromSession().isOk()).toBe(true);
    });
});
