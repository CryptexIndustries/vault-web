import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { ok } from "neverthrow";

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

jest.mock("@/utils/vault-session", () => ({
    getVaultDEKFromSession: jest.fn(),
}));

jest.mock("@/app_lib/synchronization", () => ({
    SyncConnectionController: jest.fn().mockImplementation((operations) => ({
        operations,
        init: jest.fn(),
        teardown: jest.fn(),
    })),
}));

import * as VaultUtilTypes from "../src/app_lib/proto/vault";
import type { VaultMetadata } from "../src/app_lib/vault-utils/storage";
import { Vault } from "../src/app_lib/vault-utils/vault";
import {
    createVaultOperations,
    getVaultMetadataLifecycleKey,
    shouldAutoReconnectAfterWebRTCStatus,
} from "../src/components/vault-dashboard/sync-controller";
import { WebRTCStatus } from "../src/app_lib/synchronization-utils";
import { unlockedVaultAtom, vaultStore } from "../src/utils/atoms";
import { getVaultDEKFromSession } from "../src/utils/vault-session";

const sessionDEK = { type: "secret" } as CryptoKey;

const credential = (id: string): VaultUtilTypes.Credential => ({
    ID: id,
    Type: VaultUtilTypes.ItemType.Credentials,
    GroupID: "group-1",
    Name: `Credential ${id}`,
    Username: `user-${id}`,
    Password: "secret",
    URL: "https://example.com",
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
        jest.mocked(getVaultDEKFromSession).mockReturnValue(ok(sessionDEK));
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
        const setUnlockedVault = jest.fn(
            (next: Vault | ((prev: Vault) => Vault)) => {
                const vault =
                    typeof next === "function"
                        ? next(vaultStore.get(unlockedVaultAtom))
                        : next;
                vaultStore.set(unlockedVaultAtom, vault);
            },
        );

        const operations = createVaultOperations(
            setUnlockedVault,
            () => activeMetadata,
        );
        activeMetadata = vaultB;

        await operations.updateCredentials([credential("from-sync")]);

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
});
