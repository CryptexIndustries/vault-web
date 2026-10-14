import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { ok } from "neverthrow";

import {
    Directory,
    LinkedDevices,
    Vault,
    VaultCredential,
} from "@cryptex-industries/vault-core/vault-utils/vault";
import {
    mergeReceivedVaultContents,
    receiverSyncKeyMaterial,
} from "@/utils/link-merge-policy";
import { ensureActiveVaultSyncKeyMaterial } from "@/utils/link-merge";
import { persistVaultMutation } from "@/utils/vault-mutations";

jest.mock("@/utils/vault-mutations", () => ({
    persistVaultMutation: jest.fn(),
}));
jest.mock("@/utils/android-credentials", () => ({
    androidCredentials: { clearProviderCredentials: jest.fn() },
}));
jest.mock(
    "@cryptex-industries/vault-core/vault-utils/post-quantum-kem",
    () => ({ ensureSyncKemKeypair: jest.fn(async () => false) }),
);
jest.mock(
    "@cryptex-industries/vault-core/vault-utils/sync-signing",
    () => ({ ensureSyncSigningKeypair: jest.fn(async () => false) }),
);

function makeCredential(id: string, name: string): VaultCredential {
    return Object.assign(new VaultCredential(), {
        ID: id,
        Name: name,
        Username: "",
        Password: "",
        URL: "",
        Notes: "",
        Tags: "",
        Deleted: false,
        DateCreatedTimestamp: 1,
        DateModifiedTimestamp: 1,
    });
}

function emptyVault(): Vault {
    const vault = new Vault();
    vault.Credentials = [];
    vault.Directories = [];
    vault.LinkedDevices = new LinkedDevices();
    return vault;
}

function device(partial: {
    ID: string;
    SyncID: string;
    Name: string;
}) {
    return {
        ID: partial.ID,
        SyncID: partial.SyncID,
        Name: partial.Name,
        SignalingServerID: "",
        STUNServerIDs: [],
        TURNServerIDs: [],
        RemoteSyncPublicKey: new Uint8Array(),
        RemoteSyncKemPublicKey: new Uint8Array(),
    };
}

describe("mergeReceivedVaultContents", () => {
    beforeEach(() => {
        jest.mocked(persistVaultMutation).mockReset();
    });
    it("keeps existing credential IDs and adds missing ones", () => {
        const current = emptyVault();
        current.Credentials = [makeCredential("c1", "Local")];
        current.Directories = [
            Object.assign(new Directory(), { ID: "d1", Name: "Root-ish" }),
        ];

        const received = emptyVault();
        received.Credentials = [
            makeCredential("c1", "ShouldNotOverwrite"),
            makeCredential("c2", "Incoming"),
            Object.assign(makeCredential("c3", "Deleted"), { Deleted: true }),
        ];
        received.Directories = [
            Object.assign(new Directory(), { ID: "d1", Name: "Ignored" }),
            Object.assign(new Directory(), { ID: "d2", Name: "New" }),
        ];
        received.LinkedDevices = LinkedDevices.fromGeneric({
            Devices: [device({ ID: "dev-new", SyncID: "sync-new", Name: "Peer" })],
            STUNServers: [],
            TURNServers: [],
            SignalingServers: [],
        } as never);

        const senderKeyBundle = {
            SyncSigningPublicKey: "sign-pub",
            SyncKemPublicKey: "kem-pub",
        };

        const { vault, summary } = mergeReceivedVaultContents({
            currentVault: current,
            receivedVault: received,
            onlineServicesOverwrite: null,
            senderKeyBundle,
        });

        expect(summary).toEqual({
            credentialsAdded: 1,
            credentialsSkipped: 2,
            devicesAdded: 1,
        });
        expect(vault.Credentials.map((c) => c.ID).sort()).toEqual(["c1", "c2"]);
        expect(vault.Credentials.find((c) => c.ID === "c1")?.Name).toBe("Local");
        expect(vault.Directories.map((d) => d.ID).sort()).toEqual(["d1", "d2"]);
        expect(vault.LinkedDevices.Devices).toHaveLength(1);
        expect(vault.LinkedDevices.Devices[0]?.RemoteSyncPublicKey).toBe(
            "sign-pub",
        );
        expect(vault.LinkedDevices.Devices[0]?.RemoteSyncKemPublicKey).toBe(
            "kem-pub",
        );
    });

    it("skips devices that already share ID or SyncID", () => {
        const current = emptyVault();
        current.LinkedDevices = LinkedDevices.fromGeneric({
            Devices: [device({ ID: "dev-1", SyncID: "sync-1", Name: "Existing" })],
            STUNServers: [],
            TURNServers: [],
            SignalingServers: [],
        } as never);

        const received = emptyVault();
        received.LinkedDevices = LinkedDevices.fromGeneric({
            Devices: [
                device({ ID: "dev-1", SyncID: "sync-other", Name: "Dup ID" }),
                device({ ID: "dev-2", SyncID: "sync-1", Name: "Dup Sync" }),
            ],
            STUNServers: [],
            TURNServers: [],
            SignalingServers: [],
        } as never);

        const { summary } = mergeReceivedVaultContents({
            currentVault: current,
            receivedVault: received,
            onlineServicesOverwrite: null,
            senderKeyBundle: {
                SyncSigningPublicKey: "sign-pub",
                SyncKemPublicKey: "kem-pub",
            },
        });

        expect(summary.devicesAdded).toBe(0);
    });

    it("persists the active receiver identity used by the unlocked merge handshake", async () => {
        const current = emptyVault();
        Object.assign(current.LinkedDevices, {
            SyncSigningPublicKey: "active-sign-public",
            SyncSigningPrivateKey: "active-sign-private",
            SyncKemPublicKey: "active-kem-public",
            SyncKemPrivateKey: "active-kem-private",
        });
        let persisted: Vault | null = null;
        jest.mocked(persistVaultMutation).mockImplementation(
            async (_kind, mutate) => {
                const mutation = await mutate(current);
                persisted = mutation.vault;
                return ok(mutation.result);
            },
        );

        const handshakeKeys = await ensureActiveVaultSyncKeyMaterial();
        expect(persistVaultMutation).toHaveBeenCalledWith(
            "vault.configuration",
            expect.any(Function),
        );
        expect(persisted).not.toBeNull();

        const { vault } = mergeReceivedVaultContents({
            currentVault: persisted!,
            receivedVault: emptyVault(),
            onlineServicesOverwrite: null,
            senderKeyBundle: {
                SyncSigningPublicKey: "sender-sign-public",
                SyncKemPublicKey: "sender-kem-public",
            },
        });

        expect(handshakeKeys).toEqual({
            signingPublicKey: "active-sign-public",
            signingPrivateKey: "active-sign-private",
            kemPublicKey: "active-kem-public",
            kemPrivateKey: "active-kem-private",
        });
        expect(receiverSyncKeyMaterial(vault.LinkedDevices)).toEqual(
            handshakeKeys,
        );
    });
});
