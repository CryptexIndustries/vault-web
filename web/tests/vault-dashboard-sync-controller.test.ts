import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { webcrypto } from "node:crypto";
import { TextEncoder } from "node:util";

Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    writable: true,
});
Object.defineProperty(globalThis, "TextEncoder", {
    value: TextEncoder,
    writable: true,
});

jest.mock("sonner", () => ({
    toast: {
        loading: jest.fn(() => "toast-id"),
        error: jest.fn(),
        success: jest.fn(),
    },
}));

jest.mock("@/utils/logging", () => ({
    uiLog: {
        error: jest.fn(),
    },
}));

jest.mock("@/app_lib/vault-core-runtime", () => ({}));

jest.mock("@cryptex-industries/vault-core/synchronization", () => ({
    SyncConnectionController: jest.fn().mockImplementation((operations) => ({
        operations,
        init: jest.fn(),
        teardown: jest.fn(),
    })),
}));

import * as VaultUtilTypes from "@cryptex-industries/vault-core/proto";
import { toast } from "sonner";
import type { VaultMetadata } from "../src/app_lib/vault-utils/storage";
import {
    Directory,
    Vault,
    VaultCredential,
} from "@cryptex-industries/vault-core/vault-utils/vault";
import {
    createVaultOperations,
    getVaultMetadataLifecycleKey,
    shouldAutoReconnectAfterWebRTCStatus,
} from "../src/components/vault-dashboard/sync-controller";
import { WebRTCStatus } from "@cryptex-industries/vault-core/synchronization-utils";
import {
    unlockedVaultAtom,
    unlockedVaultMetadataAtom,
    vaultStore,
} from "../src/utils/atoms";
import {
    clearVaultDEKFromSession,
    setVaultDEKInSession,
} from "../src/utils/vault-session";

const sessionDEK = { type: "secret" } as CryptoKey;

const credential = (id: string): VaultUtilTypes.Credential => ({
    ID: id,
    Type: VaultUtilTypes.ItemType.Credentials,
    DirectoryID: "",
    Name: `Credential ${id}`,
    Username: `user-${id}`,
    Password: "secret",
    URL: "https://example.com",
    URLMatchMode: VaultUtilTypes.CredentialURLMatchMode.ExactHost,
    AdditionalURLs: [],
    Notes: "",
    DateCreated: "2026-01-01T00:00:00.000Z",
    DateModified: undefined,
    DatePasswordChanged: undefined,
    CustomFields: [],
    Hash: `hash-${id}`,
    Version: 1,
    DateCreatedTimestamp: 1,
    DateModifiedTimestamp: 1,
    DatePasswordChangedTimestamp: 1,
    Deleted: false,
});

const directory = (id: string): VaultUtilTypes.Directory => ({
    ID: id,
    Name: `Directory ${id}`,
    Hash: `hash-${id}`,
    Version: 1,
    DateModifiedTimestamp: 1,
    Deleted: false,
});

const metadata = (dbIndex: number | undefined, vaultID: string | undefined) =>
    ({
        DBIndex: dbIndex,
        Blob: vaultID
            ? {
                  Envelope: {
                      VaultID: vaultID,
                  },
              }
            : undefined,
        save: jest.fn(async () => undefined),
    }) as unknown as VaultMetadata & { save: jest.Mock };

describe("vault dashboard sync controller helpers", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        const vault = new Vault();
        vault.Credentials = [credential("existing")];
        vaultStore.set(unlockedVaultAtom, vault);
        vaultStore.set(unlockedVaultMetadataAtom, null);
        clearVaultDEKFromSession();
        setVaultDEKInSession(sessionDEK);
    });

    it("keys controller lifecycle by vault identity", () => {
        const vaultA = metadata(1, "vault-a");
        const vaultB = metadata(2, "vault-b");
        const unsavedA = metadata(undefined, undefined);
        const unsavedB = metadata(undefined, undefined);

        expect(getVaultMetadataLifecycleKey(vaultA)).not.toBe(
            getVaultMetadataLifecycleKey(vaultB),
        );
        expect(getVaultMetadataLifecycleKey(unsavedA)).toBe(
            getVaultMetadataLifecycleKey(unsavedA),
        );
        expect(getVaultMetadataLifecycleKey(unsavedA)).not.toBe(
            getVaultMetadataLifecycleKey(unsavedB),
        );
    });

    it("auto-reconnects clean disconnects but not failed connection setup", () => {
        const autoConnectDevice = {
            AutoConnect: true,
        } as Pick<VaultUtilTypes.LinkedDevice, "AutoConnect">;

        expect(
            shouldAutoReconnectAfterWebRTCStatus(
                autoConnectDevice,
                WebRTCStatus.Disconnected,
            ),
        ).toBe(true);
        expect(
            shouldAutoReconnectAfterWebRTCStatus(
                autoConnectDevice,
                WebRTCStatus.Failed,
            ),
        ).toBe(false);
    });

    it("sync update saves through the current vault metadata provider", async () => {
        const vaultA = metadata(1, "vault-a");
        const vaultB = metadata(2, "vault-b");
        let activeMetadata = vaultA;

        vaultStore.set(unlockedVaultMetadataAtom, activeMetadata);
        const operations = createVaultOperations();
        activeMetadata = vaultB;
        vaultStore.set(unlockedVaultMetadataAtom, activeMetadata);

        await operations.updateItems?.([], [credential("from-sync")]);

        expect(vaultA.save).not.toHaveBeenCalled();
        expect(vaultB.save).toHaveBeenCalledTimes(1);
        expect(vaultB.save).toHaveBeenCalledWith(
            expect.objectContaining({
                Credentials: expect.arrayContaining([
                    expect.objectContaining({ ID: "from-sync" }),
                ]),
            }),
            sessionDEK,
        );
    });

    it("rejects a failed sync save without publishing the received records", async () => {
        const activeMetadata = metadata(1, "vault-a");
        activeMetadata.save.mockImplementationOnce(async () => {
            throw new Error("Storage unavailable");
        });
        vaultStore.set(unlockedVaultMetadataAtom, activeMetadata);
        const operations = createVaultOperations();

        await expect(
            operations.updateItems([], [credential("from-sync")]),
        ).rejects.toThrow("VAULT_SAVE_FAILED");

        expect(
            vaultStore.get(unlockedVaultAtom).Credentials.map((c) => c.ID),
        ).toEqual(["existing"]);
        expect(toast.error).toHaveBeenCalled();
        expect(toast.success).not.toHaveBeenCalled();

        await operations.updateItems([], [credential("from-sync")]);
        expect(
            vaultStore.get(unlockedVaultAtom).Credentials.map((c) => c.ID),
        ).toContain("from-sync");
        expect(toast.success).toHaveBeenCalledTimes(1);
    });

    it("persists empty synchronized directories", async () => {
        const activeMetadata = metadata(1, "vault-a");
        vaultStore.set(unlockedVaultMetadataAtom, activeMetadata);
        const operations = createVaultOperations();

        await operations.updateItems?.([directory("work")], []);

        expect(vaultStore.get(unlockedVaultAtom).Directories).toEqual([
            expect.objectContaining({ ID: "work", Name: "Directory work" }),
        ]);
        expect(activeMetadata.save).toHaveBeenCalledWith(
            expect.objectContaining({
                Directories: [expect.objectContaining({ ID: "work" })],
            }),
            sessionDEK,
        );
    });

    it("retains directory constructor defaults for records missing fields at the controller boundary", async () => {
        vaultStore.set(unlockedVaultMetadataAtom, metadata(1, "vault-a"));
        const previous = vaultStore.get(unlockedVaultAtom);
        const current = Object.freeze({
            ID: "current",
            Name: "Old",
        }) as VaultUtilTypes.Directory;
        const incoming = Object.freeze({
            ID: "sparse",
        }) as VaultUtilTypes.Directory;
        previous.Directories = [current];

        await createVaultOperations().updateItems(
            [directory("current"), incoming],
            [],
        );

        const updated = vaultStore.get(unlockedVaultAtom).Directories;
        expect(updated[0]).toMatchObject({
            ID: "current",
            Name: "Directory current",
            Version: 1,
        });
        expect(updated[1]).toBeInstanceOf(Directory);
        expect(updated[1]).toMatchObject({
            ID: "sparse",
            Name: "",
            Version: 0,
            Hash: "",
            Deleted: false,
            DateModifiedTimestamp: expect.any(Number),
        });
        expect(current).toEqual({ ID: "current", Name: "Old" });
        expect(incoming).toEqual({ ID: "sparse" });
    });

    it("preserves received hashes and constructor defaults while tombstoning directory credentials on a cloned snapshot", async () => {
        vaultStore.set(unlockedVaultMetadataAtom, metadata(1, "vault-a"));
        const previous = vaultStore.get(unlockedVaultAtom);
        const affected = { ...credential("affected"), DirectoryID: "gone" };
        previous.Credentials.push(affected);
        const valid = credential("valid");
        const missing = { ...credential("missing"), DirectoryID: "missing" };
        await createVaultOperations().updateItems(
            [
                {
                    ...directory("gone"),
                    Deleted: true,
                    DateModifiedTimestamp: 22,
                },
            ],
            [valid, missing],
        );

        const updated = vaultStore.get(unlockedVaultAtom);
        const received = updated.Credentials.find(
            (item) => item.ID === "valid",
        );
        expect(received).toBeInstanceOf(VaultCredential);
        expect(received).toMatchObject({
            Hash: valid.Hash,
            Tags: "",
            Deleted: false,
        });
        expect(
            updated.Credentials.find((item) => item.ID === "affected"),
        ).toMatchObject({
            Deleted: true,
            Version: 2,
            DateModifiedTimestamp: 22,
            Password: "",
        });
        expect(
            updated.Credentials.find((item) => item.ID === "missing"),
        ).toMatchObject({
            Deleted: true,
            Version: 1,
            Password: "",
        });
        expect(affected).toMatchObject({
            Deleted: false,
            Version: 1,
            Password: "secret",
        });
        expect(missing).toMatchObject({
            Deleted: false,
            Version: 1,
            Password: "secret",
        });
        expect(updated.Credentials[0]).not.toBe(previous.Credentials[0]);
    });
});
