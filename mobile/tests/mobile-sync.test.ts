import { beforeEach, expect, it, jest } from "@jest/globals";
import { ok } from "neverthrow";
import { createVaultOperations } from "@/components/sync-controller";
import {
    Vault,
    VaultCredential,
    Directory,
    LinkedDevice,
} from "@cryptex-industries/vault-core/vault-utils/vault";
import { vaultStore, unlockedVaultAtom } from "@/utils/atoms";
import { getVaultSessionGeneration } from "@/utils/vault-session";
import { persistVaultMutation } from "@/utils/vault-mutations";
import {
    isAutoLockDue,
    noteVaultBackgrounded,
    setVaultTimeoutMinutes,
    startVaultTimeoutSession,
    stopVaultTimeoutSession,
} from "@/utils/session-timeout";

jest.mock("@/vault-core-runtime", () => ({}));
jest.mock("@cryptex-industries/vault-core/synchronization", () => ({
    SyncConnectionController: jest.fn(),
}));
jest.mock("@/utils/vault-session", () => ({
    getVaultSessionGeneration: jest.fn(() => 1),
    getVaultDEKFromSession: () => ({ isErr: () => isAutoLockDue() }),
}));
jest.mock("@/utils/vault-mutations", () => ({
    persistVaultMutation: jest.fn(),
}));
jest.mock("@/utils/logging", () => ({ vaultLog: { error: jest.fn() } }));

beforeEach(() => {
    stopVaultTimeoutSession();
    jest.mocked(getVaultSessionGeneration).mockReturnValue(1);
    vaultStore.set(unlockedVaultAtom, new Vault());
    jest.mocked(persistVaultMutation).mockImplementation(
        async (_kind, mutate) => {
            const result = await mutate(vaultStore.get(unlockedVaultAtom));
            vaultStore.set(unlockedVaultAtom, result.vault);
            return ok(result.result);
        },
    );
});

it("rejects peer secret reads after the background deadline", async () => {
    jest.useFakeTimers();
    try {
        jest.setSystemTime(1_000_000);
        startVaultTimeoutSession();
        setVaultTimeoutMinutes(1);
        const operations = createVaultOperations();
        noteVaultBackgrounded();
        jest.setSystemTime(1_060_000);
        await expect(operations.getSyncSigningPrivateKey()).rejects.toThrow(
            "no longer unlocked",
        );
        await expect(operations.getItems([])).rejects.toThrow(
            "no longer unlocked",
        );
    } finally {
        stopVaultTimeoutSession();
        jest.useRealTimers();
    }
});

it("persists sync time without a mounted Devices screen or mutating its snapshot", async () => {
    const vault = vaultStore.get(unlockedVaultAtom);
    const device = Object.assign(
        new LinkedDevice("Peer", "sync", "signing", "kem"),
        {
            ID: "peer",
            LastSync: "",
        },
    );
    vault.LinkedDevices.Devices = [device];
    await createVaultOperations().recordSynchronization!("peer");
    expect(persistVaultMutation).toHaveBeenCalledTimes(1);
    expect(
        vaultStore.get(unlockedVaultAtom).LinkedDevices.Devices[0]!.LastSync,
    ).not.toBe("");
    expect(device.LastSync).toBe("");
});

it("refuses to read keys or apply remote records to a different unlock session", async () => {
    const operations = createVaultOperations();
    jest.mocked(getVaultSessionGeneration).mockReturnValue(2);
    await expect(operations.getSyncSigningPrivateKey()).rejects.toThrow(
        "no longer unlocked",
    );
    await expect(operations.updateItems([], [])).rejects.toThrow(
        "no longer unlocked",
    );
});

it("awaits directory normalization and does not mutate the previous snapshot", async () => {
    const vault = vaultStore.get(unlockedVaultAtom);
    const original = Object.assign(new Directory(), {
        ID: "b",
        Name: "Work",
        Version: 1,
    });
    vault.Directories = [original];
    const incoming = Object.assign(new Directory(), {
        ID: "a",
        Name: "Work",
        Version: 1,
    });
    await createVaultOperations().updateItems([incoming], []);
    const updated = vaultStore.get(unlockedVaultAtom);
    expect(Array.isArray(updated.Directories)).toBe(true);
    expect(updated.Directories.find((d) => d.ID === "b")?.Name).toBe(
        "Work (2)",
    );
    expect(original.Name).toBe("Work");
    expect(updated.Directories.find((d) => d.ID === "b")?.Hash).not.toBe("");
});

it("retains unchanged credentials and applies newer tombstones", async () => {
    const vault = vaultStore.get(unlockedVaultAtom);
    const unchanged = Object.assign(new VaultCredential(), {
        ID: "keep",
        Version: 5,
    });
    const deleted = Object.assign(new VaultCredential(), {
        ID: "delete",
        Version: 1,
    });
    vault.Credentials = [unchanged, deleted];
    await createVaultOperations().updateItems(
        [],
        [
            Object.assign(new VaultCredential(), { ID: "keep", Version: 1 }),
            Object.assign(new VaultCredential(), {
                ID: "delete",
                Version: 2,
                Deleted: true,
            }),
        ],
    );
    const result = vaultStore.get(unlockedVaultAtom).Credentials;
    expect(result.find((c) => c.ID === "keep")).toBe(unchanged);
    expect(result.find((c) => c.ID === "delete")?.Deleted).toBe(true);
    expect(deleted.Deleted).toBe(false);
});
