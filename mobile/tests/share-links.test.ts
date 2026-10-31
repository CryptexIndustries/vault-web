import { beforeEach, expect, it, jest } from "@jest/globals";
import { ok } from "neverthrow";
import { Vault } from "@cryptex-industries/vault-core/vault-utils/vault";
import { createShareLinkRecord } from "@cryptex-industries/vault-core/vault-utils/share-records";
import { createConnectedAgentRecord } from "@cryptex-industries/vault-core/vault-utils/connected-agents";
import { createVaultOperations } from "@/components/sync-controller";
import {
    mobileShareDeps,
    mobileShareLinkStore,
    saveMobileShareSettings,
} from "@/app_lib/share-links";
import {
    onlineServicesDataAtom,
    onlineServicesStore,
    unlockedVaultAtom,
    vaultStore,
} from "@/utils/atoms";
import { persistVaultMutation } from "@/utils/vault-mutations";

jest.mock("@/vault-core-runtime", () => ({}));
jest.mock("@cryptex-industries/vault-core/synchronization", () => ({
    SyncConnectionController: jest.fn(),
}));
jest.mock("@/utils/vault-session", () => ({
    getVaultSessionGeneration: jest.fn(() => 1),
    getVaultDEKFromSession: () => ({ isErr: () => false }),
}));
jest.mock("@/utils/vault-mutations", () => ({
    persistVaultMutation: jest.fn(),
}));
jest.mock("@/utils/trpc", () => ({
    trpc: { v1: { share: { ticket: { mutate: jest.fn() } } } },
}));
jest.mock("@/utils/logging", () => ({ vaultLog: { error: jest.fn() } }));

const record = (id: string) =>
    createShareLinkRecord({
        id,
        serverOrigin: "https://www.cryptex-vault.com",
        manageToken: "manage",
        credentialId: "",
        label: "Wi-Fi",
        expiresAt: Date.now() + 3_600_000,
        passphrase: false,
    });

beforeEach(() => {
    vaultStore.set(unlockedVaultAtom, new Vault());
    onlineServicesStore.set(onlineServicesDataAtom, null);
    jest.mocked(persistVaultMutation).mockReset();
    jest.mocked(persistVaultMutation).mockImplementation(
        async (_kind, mutate) => {
            const result = await mutate(vaultStore.get(unlockedVaultAtom));
            vaultStore.set(unlockedVaultAtom, result.vault);
            return ok(result.result);
        },
    );
});

it("stores share records through the vault write coordinator", async () => {
    const created = await record("AbCdEfGhIjKlMnOpQrStUv");
    await mobileShareLinkStore.updateShareLinks(async (current) => [
        ...current,
        created,
    ]);

    expect(jest.mocked(persistVaultMutation).mock.calls[0]![0]).toBe(
        "share.update",
    );
    const vault = vaultStore.get(unlockedVaultAtom);
    expect(vault).toBeInstanceOf(Vault);
    expect(vault.ShareLinks).toEqual([created]);
    await expect(mobileShareLinkStore.getShareLinks()).resolves.toEqual([
        created,
    ]);
});

it("saves the share server for this device", async () => {
    await saveMobileShareSettings({
        ServerOrigin: "https://vault.example.com",
        CreationToken: "operator-token",
    });

    expect(vaultStore.get(unlockedVaultAtom).ShareSettings).toEqual({
        ServerOrigin: "https://vault.example.com",
        CreationToken: "operator-token",
    });
    await expect(mobileShareLinkStore.getShareSettings()).resolves.toEqual({
        ServerOrigin: "https://vault.example.com",
        CreationToken: "operator-token",
    });
});

it("merges share records received from a linked device", async () => {
    const incoming = await record("ZyXwVuTsRqPoNmLkJiHgFe");
    await createVaultOperations().updateItems([], [], [incoming], [], []);

    expect(vaultStore.get(unlockedVaultAtom).ShareLinks).toEqual([incoming]);
    await expect(
        createVaultOperations().getShareLinkVersionVectors(),
    ).resolves.toEqual([
        expect.objectContaining({ ID: incoming.ID, Version: 0 }),
    ]);
});

it("merges connected agents received from a linked device", async () => {
    const agent = await createConnectedAgentRecord({
        Name: "build box",
        AgentSignPublicKey: new Uint8Array(32).fill(1),
        AgentKEMPublicKey: new Uint8Array(1216).fill(2),
        Hostname: "build",
        OS: "linux",
        Arch: "amd64",
        AgentVersion: "0.1.0",
        ApproverSignPublicKey: new Uint8Array(32).fill(3),
        ApproverKEMPublicKey: new Uint8Array(1216).fill(4),
        ApproverName: "Phone",
        RevocationSeed: new Uint8Array(32).fill(5),
        RelayOrigin: "",
        CredentialIDs: ["key"],
        KeysRevision: 1,
    });
    await createVaultOperations().updateItems([], [], [], [agent], []);

    expect(vaultStore.get(unlockedVaultAtom).ConnectedAgents).toEqual([agent]);
    await expect(
        createVaultOperations().getConnectedAgentVersionVectors(),
    ).resolves.toEqual([expect.objectContaining({ ID: agent.ID, Version: 0 })]);
});

it("only offers tickets with an Online Services session", () => {
    expect(mobileShareDeps().getTicket).toBeUndefined();
    onlineServicesStore.set(onlineServicesDataAtom, {
        sessionToken: "session",
        remoteData: null,
    });
    expect(mobileShareDeps().getTicket).toBeDefined();
});
