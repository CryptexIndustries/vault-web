import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { err, ok, type Result } from "neverthrow";

import { sshLoginRequest } from "./agent-request-fixture";

const values = new Map<unknown, unknown>();
const metadataAtom = { name: "metadata" };
const vaultAtom = { name: "vault" };
const unlockedAtom = { name: "unlocked" };
const mockClearDEK = jest.fn();
const mockSave = jest.fn(
    async (): Promise<Result<void, "VAULT_SAVE_FAILED">> => ok(undefined),
);
const mockClipboardClear = jest.fn(async () => undefined);
const mockLogout = jest.fn(async () => undefined);
const mockStopBackup = jest.fn();
const mockClearProvider = jest.fn();
const mockFlush = jest.fn(async (): Promise<void> => undefined);
const mockLogError = jest.fn();

jest.mock("jotai", () => ({ atom: (initial: unknown) => ({ initial }) }));
jest.mock("@/utils/atoms", () => ({
    unlockedVaultAtom: vaultAtom,
    unlockedVaultMetadataAtom: metadataAtom,
    isVaultUnlockedAtom: unlockedAtom,
    vaultStore: {
        get: (key: unknown) => values.get(key),
        set: (key: unknown, value: unknown) => values.set(key, value),
    },
}));
jest.mock("@cryptex-industries/vault-core/vault-utils/vault", () => ({
    Vault: class Vault {},
}));
jest.mock(
    "@cryptex-industries/vault-core/vault-utils/vault-write-coordinator",
    () => ({
        vaultWriteCoordinator: {
            run: async (_kind: string, action: () => Promise<unknown>) =>
                action(),
        },
    }),
);
jest.mock("@/utils/vault-session", () => ({
    clearVaultDEKFromSession: mockClearDEK,
    saveVaultWithSessionDEK: mockSave,
}));
jest.mock("@/utils/clipboard", () => ({
    clearPendingSecretFromClipboard: mockClipboardClear,
}));
jest.mock("@/utils/secret-temp-files", () => ({
    purgeSecretTempFiles: jest.fn(async () => undefined),
}));
jest.mock("@/app_lib/auth-session", () => ({
    logoutOnlineServicesSession: mockLogout,
}));
jest.mock("@/app_lib/managed-backup-hooks", () => ({
    flushManagedBackupBeforeLock: mockFlush,
    stopManagedBackup: mockStopBackup,
}));
jest.mock("@/utils/android-credentials", () => ({
    androidCredentials: { clearProviderCredentials: mockClearProvider },
}));
jest.mock("@/utils/vault-mutations", () => ({
    persistVaultMutation: jest.fn(),
}));
jest.mock("@/utils/session-timeout", () => ({ isAutoLockDue: () => false }));
jest.mock("@/utils/logging", () => ({
    vaultLog: { error: mockLogError },
    vaultLogger: { clearAll: jest.fn() },
}));

const { lockUnlockedVault, vaultLockStateAtom } =
    require("@/utils/vault-lock") as typeof import("@/utils/vault-lock");
const { canSign } =
    require("@/agent/agent-vault") as typeof import("@/agent/agent-vault");
const { registerAgentLocking, resumeAgentSigning } =
    require("@/agent/agent-locking") as typeof import("@/agent/agent-locking");
const { rememberedApprovals } =
    require("@/agent/remembered-approvals") as typeof import("@/agent/remembered-approvals");
const { AgentRuntime } =
    require("@cryptex-industries/vault-core/agent/runtime") as typeof import("@cryptex-industries/vault-core/agent/runtime");
// The real runtime's setLocking, which forgets the remembered approvals.
const runtime = new AgentRuntime({ remembered: rememberedApprovals } as never);
const runtimeLocking: boolean[] = [];
let runtimeThrows = false;
registerAgentLocking({
    setLocking: (locking) => {
        runtimeLocking.push(locking);
        if (runtimeThrows) throw new Error("runtime failed");
        runtime.setLocking(locking);
    },
});

const login = sshLoginRequest("r1");

describe("locking the vault", () => {
    beforeEach(() => {
        values.clear();
        values.set(vaultLockStateAtom, "idle");
        values.set(metadataAtom, { ID: "vault" });
        values.set(unlockedAtom, true);
        // A fresh vault session (the root bridge calls this on unlock).
        resumeAgentSigning();
        runtimeThrows = false;
    });

    const lock = () =>
        lockUnlockedVault({
            unlockedVaultMetadata: { ID: "vault" } as never,
            setUnlockedVault: async () => undefined,
            setUnlockedVaultMetadata: () => undefined,
        });

    it("stops signing and forgets approvals before the save and backup flush", async () => {
        rememberedApprovals.add(login, "cred", "host");
        expect(canSign()).toBe(true);
        runtimeLocking.length = 0;
        let duringSave: {
            canSign: boolean;
            remembered: number;
            runtime: boolean[];
        } | null = null;
        mockSave.mockImplementationOnce(async () => {
            duringSave = {
                canSign: canSign(),
                remembered: rememberedApprovals.size,
                runtime: [...runtimeLocking],
            };
            return ok(undefined);
        });
        expect((await lock()).isOk()).toBe(true);
        expect(mockClearDEK).toHaveBeenCalled();
        expect(duringSave).toEqual({
            canSign: false,
            remembered: 0,
            runtime: [true],
        });
    });

    it("keeps signing stopped after a failed save, even after Keep editing, until unlock", async () => {
        mockSave.mockImplementationOnce(async () => err("VAULT_SAVE_FAILED"));
        const result = await lock();
        expect(result.isErr()).toBe(true);
        expect(canSign()).toBe(false);
        // "Keep editing" puts the lock state back to idle; the vault stays open.
        values.set(vaultLockStateAtom, "idle");
        expect(canSign()).toBe(false);
        resumeAgentSigning();
        expect(canSign()).toBe(true);
    });

    it("still saves and flushes when stopping the agent throws", async () => {
        runtimeThrows = true;
        mockSave.mockClear();
        mockFlush.mockClear();
        const result = await lock();
        expect(result.isOk()).toBe(true);
        expect(mockSave).toHaveBeenCalledTimes(1);
        expect(mockFlush).toHaveBeenCalledTimes(1);
        expect(mockLogError).toHaveBeenCalledWith(
            "Failed to stop SSH agent signing",
            expect.anything(),
        );
        expect(canSign()).toBe(false);
    });

    it("refuses signing at once while the backup flush never finishes", async () => {
        rememberedApprovals.add(login, "cred", "host");
        mockFlush.mockImplementationOnce(
            () => new Promise<void>(() => undefined),
        );
        void lock();
        // Synchronously after lock() starts, before the save or the flush.
        expect(canSign()).toBe(false);
        expect(rememberedApprovals.size).toBe(0);
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(mockFlush).toHaveBeenCalled();
        expect(canSign()).toBe(false);
        // The hung lock stays "locking"; leave the state clean for later tests.
        values.set(vaultLockStateAtom, "idle");
    });
});
