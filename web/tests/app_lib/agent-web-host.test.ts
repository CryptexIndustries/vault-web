/**
 * @jest-environment node
 *
 * The dashboard's agent approver host: one tab runs the approver, and
 * locking the vault (dispose) stops it, closes its notifications, forgets
 * waiting requests and remembered approvals, and lets another tab take over.
 */
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    jest,
} from "@jest/globals";
import type {
    ApproverHost,
    IncomingRequest,
} from "@cryptex-industries/vault-core/agent/approver-types";
import {
    generateAgentIdentity,
    identityId,
} from "@cryptex-industries/vault-core/agent/envelope";
import type { ApproverPort } from "@cryptex-industries/vault-core/agent/runtime";
import {
    ItemType,
    type ConnectedAgent,
} from "@cryptex-industries/vault-core/proto";
import {
    Vault,
    VaultCredential,
} from "@cryptex-industries/vault-core/vault-utils/vault";

import { webcrypto } from "crypto";
import { WebAgentHost } from "../../src/app_lib/agent/web-agent-host";
import { lockUnlockedVault } from "../../src/utils/vault-lock";
import { addVaultLockListener } from "../../src/utils/vault-lock-listeners";
import {
    clearVaultDEKFromSession,
    setVaultDEKInSession,
} from "../../src/utils/vault-session";
import { FakeLocks } from "../helpers/fake-locks";
import {
    agentSigningStopped,
    resumeAgentSigning,
} from "../../src/utils/vault-lock-listeners";

jest.mock("../../src/app_lib/auth-session", () => ({
    logoutOnlineServicesSession: jest.fn(async () => undefined),
}));

const settle = async () => {
    for (let i = 0; i < 2; i++)
        await new Promise((resolve) => setTimeout(resolve, 0));
};

const cleanups: (() => void)[] = [];

/**
 * Starts a vault lock that `host` listens to, with this metadata save.
 * Resolves once the lock has started, with the lock's own result.
 */
async function startLock(host: WebAgentHost, save: () => Promise<void>) {
    cleanups.push(
        addVaultLockListener({ lockStarted: () => host.beginLock() }),
        clearVaultDEKFromSession,
    );
    setVaultDEKInSession(
        await webcrypto.subtle.generateKey(
            { name: "AES-GCM", length: 256 },
            false,
            ["encrypt", "decrypt"],
        ),
    );
    const locked = lockUnlockedVault({
        unlockedVaultMetadata: { DBIndex: 1, save } as never,
        setUnlockedVault: async () => undefined,
        setUnlockedVaultMetadata: () => undefined,
    });
    return { locked };
}

function vaultWithAgent() {
    const identity = generateAgentIdentity();
    const vault = new Vault();
    vault.AgentApprover = {
        SignSeed: identity.signSeed,
        KEMSeed: identity.kemSeed,
        CustomRelays: [],
        RelayPass: "",
        RelayPassExpiresAt: 0,
        ApprovedAgents: [{ AgentID: "agent-a", Keys: [new Uint8Array([9])] }],
    };
    // A granted SSH key item whose public key blob is [9].
    vault.Credentials = [
        Object.assign(new VaultCredential(), {
            ID: "cred-1",
            Name: "GitHub",
            Type: ItemType.SSHKey,
            Deleted: false,
            SSHKey: {
                PublicKey: "ssh-ed25519 CQ==",
                PrivateKey: "",
                Comment: "",
            },
        }),
    ];
    vault.ConnectedAgents = [
        {
            ID: "agent-a",
            Name: "workstation",
            AgentSignPublicKey: new Uint8Array(32),
            AgentKEMPublicKey: new Uint8Array(1216),
            ApproverSignPublicKey: identityId(identity),
            CredentialIDs: ["cred-1"],
            History: [],
            Deleted: false,
            PairedAtTimestamp: 1,
        } as unknown as ConnectedAgent,
    ];
    return vault;
}

function tab(vault: Vault, locks: FakeLocks) {
    const state = {
        unlocked: true,
        visible: false,
        started: 0,
        stopped: 0,
        shown: [] as string[],
        closedAll: 0,
        approverHost: null as ApproverHost | null,
    };
    const approver: ApproverPort = {
        start: () => void state.started++,
        stop: () => void state.stopped++,
        refresh: () => undefined,
        claim: async () => {
            throw new Error("unused");
        },
        accept: async () => {
            throw new Error("unused");
        },
        waitConfirmed: async () => undefined,
        answer: async () => undefined,
        sendKeys: async () => undefined,
        unregister: async () => undefined,
    };
    const host = new WebAgentHost({
        getVault: () => vault,
        canSign: () => state.unlocked,
        persist: async () => true,
        hostedRelayUrl: "https://relay.cryptex-vault.com",
        deviceName: () => "Chrome on Linux",
        requestPass: async () => null,
        locks,
        notifications: {
            show: (id) => state.shown.push(id),
            close: (id) => {
                state.shown = state.shown.filter((item) => item !== id);
            },
            closeAll: () => {
                state.closedAll++;
                state.shown = [];
            },
        },
        isVisible: () => state.visible,
        focusWindow: () => undefined,
        createApprover: (approverHost) => {
            state.approverHost = approverHost;
            return approver;
        },
        openWebSocket: () => {
            throw new Error("unused");
        },
        fetch: (() => undefined) as never,
        sign: async () => new Uint8Array([1]),
    });
    return { host, state, approver };
}

function loginRequest(id: string): IncomingRequest {
    return {
        id,
        agentId: "agent-a",
        receivedAt: Date.now(),
        expiresAt: Date.now() + 90_000,
        sign: {
            publicKey: new Uint8Array([9]),
            data: new Uint8Array([1]),
            flags: 0,
            processes: [],
            sessionBinds: [],
            hostname: "box",
        },
        check: {
            kind: "login",
            user: "git",
            verifiedHost: {
                hostKey: new Uint8Array(1),
                fingerprint: "SHA256:host",
                names: ["github.com"],
            },
            forwardedVia: [],
            destinationUnknown: false,
        },
    };
}

describe("the web approver host", () => {
    // Each test starts from an authenticated unlock.
    beforeEach(() => resumeAgentSigning());
    afterEach(() => {
        for (const cleanup of cleanups.splice(0)) cleanup();
    });

    it("keeps signing off after a failed lock, also for a host made later", async () => {
        const vault = vaultWithAgent();
        const locks = new FakeLocks();
        const first = tab(vault, locks);
        first.host.sync();
        await settle();
        const { locked } = await startLock(first.host, async () => {
            throw new Error("disk full");
        });
        expect((await locked).isErr()).toBe(true);
        expect(agentSigningStopped()).toBe(true);
        // The dashboard unmounts and mounts again over the same open vault.
        first.host.dispose();
        await settle();
        const next = tab(vault, locks);
        next.host.sync();
        await settle();
        try {
            next.state.approverHost!.onRequest(loginRequest("r-after"));
            await settle();
            await expect(next.host.approve("r-after", "once")).rejects.toThrow(
                /Unlock/,
            );
            // Only an authenticated unlock turns signing back on.
            resumeAgentSigning();
            await expect(
                next.host.approve("r-after", "once"),
            ).resolves.toBeUndefined();
        } finally {
            next.host.dispose();
        }
    });

    it("runs the approver in one tab and hands it over when that tab locks", async () => {
        const vault = vaultWithAgent();
        const locks = new FakeLocks();
        const a = tab(vault, locks);
        const b = tab(vault, locks);
        a.host.sync();
        await settle();
        b.host.sync();
        await settle();
        expect(a.host.isLeader).toBe(true);
        expect(b.host.isLeader).toBe(false);
        expect(a.state.started).toBe(1);
        expect(b.state.started).toBe(0);

        // A request while the tab is hidden posts a notification.
        a.state.approverHost!.onRequest(loginRequest("r1"));
        await settle();
        expect(a.host.pendingRequests().map((r) => r.id)).toEqual(["r1"]);
        expect(a.state.shown).toEqual(["r1"]);

        a.host.dispose();
        await settle();
        expect(a.state.stopped).toBe(1);
        expect(a.state.shown).toEqual([]);
        expect(a.host.pendingRequests()).toEqual([]);
        expect(a.host.isLeader).toBe(false);
        // The other tab takes over.
        expect(b.host.isLeader).toBe(true);
        expect(b.state.started).toBe(1);
        b.host.dispose();
    });

    it("opens the approval dialog in a visible tab and refuses to sign once locked", async () => {
        const vault = vaultWithAgent();
        const { host, state } = tab(vault, new FakeLocks());
        state.visible = true;
        host.sync();
        await settle();
        state.approverHost!.onRequest(loginRequest("r2"));
        await settle();
        expect(host.dialogRequestId).toBe("r2");
        expect(state.shown).toEqual([]);

        state.unlocked = false;
        await expect(host.approve("r2", "once")).rejects.toThrow(/Unlock/);
        host.dispose();
        expect(host.dialogRequestId).toBeNull();
    });

    it("refuses to sign from the first line of the lock, while the save hangs", async () => {
        const vault = vaultWithAgent();
        const { host, state } = tab(vault, new FakeLocks());
        state.visible = true;
        host.sync();
        await settle();
        state.approverHost!.onRequest(loginRequest("r3"));
        await settle();
        let finish: () => void = () => undefined;
        cleanups.push(() => finish());
        // The save (and so the backup flush after it) never finishes.
        await startLock(
            host,
            () =>
                new Promise<void>((resolve) => {
                    finish = resolve;
                }),
        );
        // The vault is still open, but nothing signs.
        await expect(host.approve("r3", "once")).rejects.toThrow(/Unlock/);
        host.dispose();
    });

    it.each([
        [
            "a synced record this browser never paired",
            (vault: Vault) => {
                vault.AgentApprover!.ApprovedAgents = [];
            },
        ],
        [
            "an agent another approver key paired",
            (vault: Vault) => {
                vault.ConnectedAgents[0]!.ApproverSignPublicKey =
                    new Uint8Array(32);
            },
        ],
    ])("doesn't run for %s", async (_name, change) => {
        const vault = vaultWithAgent();
        change(vault);
        const { host, state } = tab(vault, new FakeLocks());
        host.sync();
        await settle();
        expect(host.isLeader).toBe(false);
        expect(state.started).toBe(0);
        host.dispose();
    });

    // The connect dialog's cleanup can run after the dashboard disposed the
    // host; it must not take the approver lock again and keep it.
    it("never leads again once disposed, so the next host takes over", async () => {
        const vault = vaultWithAgent();
        const locks = new FakeLocks();
        const first = tab(vault, locks);
        first.host.sync();
        await settle();
        expect(first.host.isLeader).toBe(true);
        first.host.dispose();
        await settle();
        // Cleanup after disposal: neither call takes the lock.
        await expect(first.host.cancelPairing("agent-a")).resolves.toBe(
            undefined,
        );
        await expect(first.host.unregister("agent-a")).rejects.toThrow(
            /isn't running/,
        );
        await expect(first.host.claim("code")).rejects.toThrow(/isn't running/);
        first.host.sync();
        await settle();
        const next = tab(vault, locks);
        next.host.sync();
        await settle();
        expect(next.host.isLeader).toBe(true);
        expect(next.state.started).toBe(1);
        expect(first.host.isLeader).toBe(false);
        expect(first.state.started).toBe(1);
        next.host.dispose();
    });

    it("doesn't lead from a call that was waiting when the host was disposed", async () => {
        const vault = vaultWithAgent();
        const locks = new FakeLocks();
        const first = tab(vault, locks);
        // A pairing step starts, then the vault locks before it leads.
        const claiming = first.host.claim("code");
        first.host.dispose();
        await expect(claiming).rejects.toThrow(/isn't running/);
        await settle();
        expect(first.state.started).toBe(0);
        const next = tab(vault, locks);
        next.host.sync();
        await settle();
        expect(next.host.isLeader).toBe(true);
        next.host.dispose();
    });

    it("cancels a pairing through the runtime that leads now, without taking over", async () => {
        const vault = vaultWithAgent();
        const locks = new FakeLocks();
        const leader = tab(vault, locks);
        const other = tab(vault, locks);
        leader.host.sync();
        await settle();
        await other.host.cancelPairing("agent-a");
        await settle();
        expect(leader.host.isLeader).toBe(true);
        expect(other.host.isLeader).toBe(false);
        expect(other.state.started).toBe(0);
        leader.host.dispose();
        other.host.dispose();
    });

    it("gives up a lead granted after dispose at once, starting nothing", async () => {
        const vault = vaultWithAgent();
        const locks = new FakeLocks();
        const first = tab(vault, locks);
        let finishCleanup!: () => void;
        first.approver.cancelPairing = () =>
            new Promise<void>((resolve) => {
                finishCleanup = resolve;
            });
        first.host.sync();
        await settle();
        expect(first.host.isLeader).toBe(true);
        // A failed pairing's cleanup keeps the lead through dispose.
        first.host.pairingFailed("agent-new");
        first.host.dispose();
        // Another tab takes over; the disposed host waits for the lock again.
        const second = tab(vault, locks);
        await second.host.claim("code").catch(() => undefined);
        await settle();
        expect(first.host.isLeader).toBe(false);
        expect(first.state.started).toBe(1);
        // That tab locks: the disposed host is granted the lock and must let
        // it go at once, so a third tab leads without waiting for the cleanup.
        second.host.dispose();
        await settle();
        const third = tab(vault, locks);
        third.host.sync();
        await settle();
        expect(third.host.isLeader).toBe(true);
        expect(first.host.isLeader).toBe(false);
        expect(first.state.started).toBe(1);
        finishCleanup();
        third.host.dispose();
    });
});
