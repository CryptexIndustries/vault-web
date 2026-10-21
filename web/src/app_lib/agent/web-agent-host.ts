import type {
    ClaimedPairing,
    GrantedKeyInput,
    IncomingRequest,
    PairingResult,
    RelayTarget,
    WebSocketLike,
} from "@cryptex-industries/vault-core/agent/approver-types";
import {
    generateAgentIdentity,
    type AgentIdentity,
} from "@cryptex-industries/vault-core/agent/envelope";
import type { RememberChoice } from "@cryptex-industries/vault-core/agent/remember";
import { setAgentPaused } from "@cryptex-industries/vault-core/agent/agent-actions";
import {
    AgentRuntime,
    RequestGoneError,
    type CreateApprover,
    type CustomRelay,
    type GrantedKey,
    type RuntimeDeps,
} from "@cryptex-industries/vault-core/agent/runtime";
import {
    agentCacheFromVault,
    findGrantedKey,
    isApprovedHere,
    isApprovedLocally,
    liveAgent,
    localApprovalsFromSettings,
    localApprovalsToSettings,
    relayKeyOf,
    withAgentRecord,
    withNewAgentRecord,
} from "@cryptex-industries/vault-core/agent/vault-agents";
import type * as VaultUtilTypes from "@cryptex-industries/vault-core/proto";
import {
    appendConnectedAgentHistory,
    markConnectedAgentDeleted,
    updateConnectedAgentRecord,
    type ConnectedAgentChanges,
} from "@cryptex-industries/vault-core/vault-utils/connected-agents";
import { Vault } from "@cryptex-industries/vault-core/vault-utils/vault";
import type { VaultWriteKind } from "@cryptex-industries/vault-core/vault-utils/vault-write-coordinator";

import { agentSigningStopped } from "@/utils/vault-lock-listeners";
import { TabLeadership, type LockManagerLike } from "./tab-leadership";

/** Renew the hosted relay pass when less than this is left. */
const PASS_RENEW_MS = 24 * 60 * 60 * 1000;
const SEED_SIZE = 32;
/** How long cancelling a pairing waits for the relay to drop the agent. */
const CANCEL_PAIRING_MS = 5_000;

/** Settles when the step does, or after ms; never rejects. */
function bounded(step: Promise<unknown>, ms: number): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    return Promise.race([
        step.then(
            () => undefined,
            () => undefined,
        ),
        new Promise<void>((resolve) => {
            timer = setTimeout(resolve, ms);
        }),
    ]).finally(() => clearTimeout(timer));
}

export type AgentNotifications = {
    show(requestId: string, agentName: string, onClick: () => void): void;
    close(requestId: string): void;
    closeAll(): void;
};

export type WebAgentHostDeps = {
    getVault(): Vault;
    /** Overrides CANCEL_PAIRING_MS (tests). */
    cancelPairingMs?: number;
    /** Unlocked, the session key is present and the idle lock isn't due. */
    canSign(): boolean;
    /** Writes through the vault write queue; false when it failed. */
    persist(
        kind: VaultWriteKind,
        mutate: (vault: Vault) => Vault | Promise<Vault>,
    ): Promise<boolean>;
    hostedRelayUrl: string;
    deviceName(): string;
    /** A fresh hosted relay pass, null without an Online Services session. */
    requestPass(
        key: string,
    ): Promise<{ pass: string; expiresAt: number } | null>;
    locks: LockManagerLike | undefined;
    notifications: AgentNotifications;
    isVisible(): boolean;
    focusWindow(): void;
    createApprover: CreateApprover;
    openWebSocket(url: string, protocols: string[]): WebSocketLike;
    fetch: typeof fetch;
    sign: RuntimeDeps["sign"];
    log?: (message: string, detail?: unknown) => void;
};

const bytesEqual = (a: Uint8Array, b: Uint8Array) =>
    a.length === b.length && a.every((byte, index) => byte === b[index]);

const emptySettings = (): VaultUtilTypes.AgentApproverSettings => ({
    SignSeed: new Uint8Array(0),
    KEMSeed: new Uint8Array(0),
    CustomRelays: [],
    RelayPass: "",
    RelayPassExpiresAt: 0,
    ApprovedAgents: [],
});

/** The approver identity the vault holds for this device, if any. */
function identityFromVault(
    vault: Pick<Vault, "AgentApprover">,
): AgentIdentity | null {
    const settings = vault.AgentApprover;
    if (
        settings?.SignSeed.length !== SEED_SIZE ||
        settings.KEMSeed.length !== SEED_SIZE
    )
        return null;
    return { signSeed: settings.SignSeed, kemSeed: settings.KEMSeed };
}

/**
 * The agent names this browser's approver key and this browser paired it.
 * A synced record alone can't make an agent "approved here".
 */
export function approvedInThisBrowser(
    vault: Pick<Vault, "AgentApprover">,
    agent: VaultUtilTypes.ConnectedAgent,
    identity: AgentIdentity | null,
) {
    return (
        isApprovedHere(agent, identity) &&
        isApprovedLocally(
            localApprovalsFromSettings(vault.AgentApprover),
            agent.ID,
        )
    );
}

/** "Chrome on Linux": the name agents show for this approver. */
export function browserDeviceName(userAgent: string): string {
    const browser = /Edg\//.test(userAgent)
        ? "Edge"
        : /OPR\//.test(userAgent)
          ? "Opera"
          : /Firefox\//.test(userAgent)
            ? "Firefox"
            : /Chrome\//.test(userAgent)
              ? "Chrome"
              : /Safari\//.test(userAgent)
                ? "Safari"
                : "Browser";
    const os = /Android/.test(userAgent)
        ? "Android"
        : /iPhone|iPad/.test(userAgent)
          ? "iOS"
          : /Mac OS X/.test(userAgent)
            ? "macOS"
            : /Windows/.test(userAgent)
              ? "Windows"
              : /CrOS/.test(userAgent)
                ? "ChromeOS"
                : /Linux/.test(userAgent)
                  ? "Linux"
                  : "";
    return os ? `${browser} on ${os}` : browser;
}

/**
 * The web dashboard's SSH agent approver: the shared AgentRuntime from
 * vault-core, run by one tab at a time while the vault is unlocked. The
 * approver keys and relay settings live in the vault's device-local
 * AgentApprover field. Created when the dashboard mounts (unlock) and
 * disposed when it unmounts (lock).
 */
export class WebAgentHost {
    private runtime: AgentRuntime | null = null;
    private leadership: TabLeadership | null = null;
    private lockName = "";
    private identity: AgentIdentity | null = null;
    private pairing = 0;
    /**
     * Agents accept() registered on the relay that haven't confirmed yet:
     * cancelling the pairing, or locking, unregisters them there.
     */
    private unconfirmed = new Set<string>();
    /** Pairing holds whose runtime cleanup is still settling. */
    private endingHolds = 0;
    /** The runtime this tab ran last, for pairing cleanups after it stopped. */
    private retired: AgentRuntime | null = null;
    private disposed = false;
    private locking = false;
    private passRequest: Promise<string | null> | null = null;
    private listeners = new Set<() => void>();
    private unsubscribeRuntime: (() => void) | null = null;
    private version = 0;
    /** The request the approval dialog should show, set by the runtime. */
    dialogRequestId: string | null = null;

    constructor(private readonly deps: WebAgentHostDeps) {}

    // -- State for components ----------------------------------------------

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    getVersion() {
        return this.version;
    }

    private changed() {
        this.version++;
        for (const listener of this.listeners) listener();
    }

    /** This tab runs the approver now. */
    get isLeader() {
        return this.runtime !== null;
    }

    get approverIdentity() {
        return this.identity;
    }

    /** The name agents show for this approver, such as "Chrome on Linux". */
    deviceName() {
        return this.deps.deviceName();
    }

    pendingRequests(): IncomingRequest[] {
        return this.runtime?.pendingRequests() ?? [];
    }

    /** Requests waiting for an answer, for "1 of 3". */
    waitingCount(): number {
        return this.runtime?.waitingCount() ?? 0;
    }

    /** The relay says it doesn't know the agent (only the leading tab knows). */
    relayForgot(agentId: string): boolean {
        return this.runtime?.relayForgot(agentId) ?? false;
    }

    getRequest(id: string) {
        return this.runtime?.getRequest(id);
    }

    agentName(agentId: string) {
        return this.runtime?.agentName(agentId) ?? "an agent";
    }

    /** The key a waiting request would sign with; null while locked or not granted. */
    keyFor(request: IncomingRequest): GrantedKey | null {
        return this.runtime?.keyFor(request) ?? null;
    }

    /** The dialog reports the request it shows; null when it unmounts. */
    setShownRequest(id: string | null) {
        this.runtime?.setShownRequest(id, id !== null);
    }

    /** Moves the dialog to the next waiting request, or closes it. */
    showNext() {
        const next = this.runtime?.nextRequest();
        this.dialogRequestId = next?.id ?? null;
        if (!next) this.runtime?.setShownRequest(null, false);
        this.changed();
    }

    // -- Lifecycle ---------------------------------------------------------

    /**
     * Re-reads the vault: the identity, the agents this device approves and
     * the relay settings. Runs on unlock and after every vault change.
     */
    sync() {
        if (this.disposed) return;
        const vault = this.deps.getVault();
        const identity = identityFromVault(vault);
        if (!sameIdentity(identity, this.identity)) {
            this.identity = identity;
            this.leadership?.relinquish();
            this.leadership = null;
        }
        // Deleted records count too: the runtime removes them on the relay.
        const approved = (vault.ConnectedAgents ?? []).some((agent) =>
            approvedInThisBrowser(vault, agent, identity),
        );
        // A hold that ended keeps the runtime until its pairing cleanups settle.
        const wanted =
            !!identity &&
            (approved || this.pairing > 0 || this.endingHolds > 0);
        if (wanted) {
            this.leadershipFor(identity!)
                .request()
                .catch(() => undefined);
            void this.runtime
                ?.reload()
                .catch((error: unknown) => this.log("Reload failed", error));
        } else {
            this.leadership?.relinquish();
        }
        this.changed();
    }

    /** The tab became visible: show waiting requests, reconnect relays now. */
    onVisible() {
        this.runtime?.route();
        this.runtime?.refreshRelays();
    }

    /** Reconnects relays now and renews the hosted relay pass if it can. */
    refreshRelays() {
        this.runtime?.refreshRelays();
    }

    /**
     * The vault locked: close the relay connections, forget remembered
     * approvals and waiting requests, and hand the approver to another tab.
     * Final: a disposed host never leads, creates keys or starts a runtime
     * again, even from a call already waiting when it was disposed.
     */
    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        // Pairings the agent hasn't confirmed: unregister them on the relay
        // first, or they stay registered there (counting against its agent
        // limit) with no record here to remove them from. The runtime that
        // runs now does it; nothing leads again (see assertLive).
        const runtime = this.runtime;
        if (runtime)
            for (const agentId of this.unconfirmed)
                void runtime.cancelPairing(agentId);
        this.unconfirmed.clear();
        this.deps.notifications.closeAll();
        this.listeners.clear();
        const stop = () => {
            this.leadership?.relinquish();
            this.leadership = null;
            this.stopRuntime();
        };
        // Every pairing cleanup of the runtime (these, failed accepts and
        // pairings): the transport and the lead stay until they settle,
        // bounded, or the next approver with this key would replace the
        // relay connection. maySign is false once disposed.
        if (runtime?.pairingCleanupsPending)
            void bounded(
                runtime.pairingCleanupsSettled(),
                this.deps.cancelPairingMs ?? CANCEL_PAIRING_MS,
            ).then(stop);
        else stop();
    }

    private leadershipFor(identity: AgentIdentity): TabLeadership {
        this.assertLive();
        const name = `cryptex-agent-approver:${relayKeyOf(identity)}`;
        if (this.leadership && this.lockName === name) return this.leadership;
        this.leadership?.relinquish();
        this.lockName = name;
        const leadership = new TabLeadership(name, this.deps.locks, {
            onAcquired: () => {
                // Granted after dispose(): let go at once, or the lock
                // would stay held by a host nothing uses.
                if (this.disposed) leadership.relinquish();
                else this.startRuntime();
            },
            onLost: () => this.stopRuntime(),
        });
        this.leadership = leadership;
        return leadership;
    }

    private assertLive() {
        if (this.disposed)
            throw new Error("The approver isn't running in this tab");
    }

    private startRuntime() {
        if (this.disposed || this.runtime) return;
        const runtime = new AgentRuntime(this.runtimeDeps());
        this.runtime = runtime;
        this.log("This tab runs the approver now");
        this.unsubscribeRuntime = runtime.subscribe(() => this.changed());
        void runtime
            .reload()
            .catch((error: unknown) =>
                this.log("Couldn't start the approver", error),
            );
        this.changed();
    }

    private stopRuntime() {
        const runtime = this.runtime;
        this.runtime = null;
        this.retired = runtime ?? this.retired;
        this.unsubscribeRuntime?.();
        this.unsubscribeRuntime = null;
        this.dialogRequestId = null;
        if (runtime) this.log("This tab stopped running the approver");
        runtime?.stop();
        this.deps.notifications.closeAll();
        if (!this.disposed) this.changed();
    }

    /** Leads now, taking over from another tab (the user acts in this one). */
    private async activeRuntime(): Promise<AgentRuntime> {
        const identity = await this.ensureIdentity();
        this.assertLive();
        await this.leadershipFor(identity).request(true);
        // dispose() may defer stopping the runtime, so check both.
        if (this.disposed || !this.runtime)
            throw new Error("The approver isn't running in this tab");
        return this.runtime;
    }

    private runtimeDeps(): RuntimeDeps {
        const { deps } = this;
        return {
            createApprover: deps.createApprover,
            loadIdentity: async () => {
                if (!this.identity) throw new Error("No approver identity yet");
                return this.identity;
            },
            deviceName: () => deps.deviceName(),
            loadAgentCache: async () =>
                this.identity
                    ? agentCacheFromVault(deps.getVault(), this.identity)
                    : [],
            loadCustomRelays: async () => this.customRelays(),
            localApprovals: {
                load: async () =>
                    localApprovalsFromSettings(deps.getVault().AgentApprover),
                save: async (approvals) => {
                    const saved = await this.saveSettings((settings) => ({
                        ...settings,
                        ApprovedAgents: localApprovalsToSettings(approvals),
                    }));
                    if (!saved)
                        throw new Error(
                            "Couldn't save this browser's agents in your vault",
                        );
                },
            },
            hostedRelayUrl: deps.hostedRelayUrl,
            getPass: (relay) => this.getPass(relay),
            vault: {
                canSign: () => this.maySign(),
                grantedKey: (agentId, publicKey) => {
                    if (!this.maySign()) return "locked";
                    return findGrantedKey(deps.getVault(), agentId, publicKey);
                },
                // The live record, so a stale agent cache can't undo a pause.
                isPaused: (agentId) =>
                    !!liveAgent(deps.getVault(), agentId)?.Paused,
                hasAgentRecord: (agentId) =>
                    !!liveAgent(deps.getVault(), agentId),
                appendHistory: (agentId, entry) =>
                    this.appendHistory(agentId, [entry]),
                appendHistoryEntries: (agentId, entries) =>
                    this.appendHistory(agentId, entries),
            },
            sign: deps.sign,
            ui: {
                isForeground: () => deps.isVisible(),
                openRequest: (id) => {
                    this.dialogRequestId = id;
                    this.changed();
                },
                showNotification: (id, agentName) =>
                    deps.notifications.show(id, agentName, () => {
                        deps.focusWindow();
                        this.runtime?.review(id);
                    }),
                cancelNotification: (id) => deps.notifications.close(id),
            },
            openWebSocket: (url, protocols) =>
                deps.openWebSocket(url, protocols),
            fetch: (...args) => deps.fetch(...args),
            log: deps.log,
            // One bound for a pairing cleanup, here and in the runtime.
            pairingCleanupMs: deps.cancelPairingMs ?? CANCEL_PAIRING_MS,
        };
    }

    private log(message: string, detail?: unknown) {
        this.deps.log?.(message, detail);
    }

    /**
     * Not disposed, no lock started here or anywhere in this session since
     * the last unlock (agentSigningStopped), and the vault can sign.
     */
    private maySign(): boolean {
        return (
            !this.disposed &&
            !this.locking &&
            !agentSigningStopped() &&
            this.deps.canSign()
        );
    }

    /** One vault write; false while locked. */
    private async appendHistory(
        agentId: string,
        entries: VaultUtilTypes.AgentRequestRecord[],
    ): Promise<boolean> {
        if (this.disposed || !this.deps.canSign()) return false;
        if (!liveAgent(this.deps.getVault(), agentId)) return true;
        return this.updateAgent("agent.history", agentId, (record) =>
            appendConnectedAgentHistory(record, entries),
        );
    }

    // -- Vault ---------------------------------------------------------------

    private async updateAgent(
        kind: VaultWriteKind,
        agentId: string,
        update: (
            record: VaultUtilTypes.ConnectedAgent,
        ) => Promise<VaultUtilTypes.ConnectedAgent>,
    ): Promise<boolean> {
        return this.deps.persist(kind, (current) =>
            withAgentRecord(current, agentId, update),
        );
    }

    changeAgent(agentId: string, changes: ConnectedAgentChanges) {
        return this.updateAgent("agent.update", agentId, (record) =>
            updateConnectedAgentRecord(record, changes),
        );
    }

    /** Pauses or resumes an agent; works from any tab and any device. */
    setPaused(agentId: string, paused: boolean) {
        return setAgentPaused(agentId, paused, {
            changeAgent: (id, changes) => this.changeAgent(id, changes),
            runtime: this.runtime ?? undefined,
        });
    }

    /**
     * The vault is locking: stop signing and forget remembered approvals
     * before the lock path saves and flushes backups. Synchronous and never
     * throws. Signing stays off even if the lock fails; this host is made
     * again on the next unlock.
     */
    beginLock() {
        this.locking = true;
        try {
            this.runtime?.setLocking(true);
        } catch (error) {
            this.log("Couldn't stop the approver for the lock", error);
        }
    }

    revokeAgentInVault(agentId: string) {
        return this.updateAgent(
            "agent.revoke",
            agentId,
            markConnectedAgentDeleted,
        );
    }

    async addAgentToVault(
        record: VaultUtilTypes.ConnectedAgent,
    ): Promise<boolean> {
        return this.deps.persist("agent.pair", (current) =>
            withNewAgentRecord(current, record),
        );
    }

    private saveSettings(
        change: (
            settings: VaultUtilTypes.AgentApproverSettings,
        ) => VaultUtilTypes.AgentApproverSettings,
    ): Promise<boolean> {
        return this.deps.persist("agent.settings", (current) => {
            const vault = Object.assign(new Vault(), current);
            vault.AgentApprover = change({
                ...emptySettings(),
                ...current.AgentApprover,
            });
            return vault;
        });
    }

    /** This device's approver identity, created and saved on first use. */
    async ensureIdentity(): Promise<AgentIdentity> {
        this.assertLive();
        const existing = identityFromVault(this.deps.getVault());
        if (existing) return existing;
        const fresh = generateAgentIdentity();
        const saved = await this.saveSettings((settings) =>
            this.disposed || identityFromVault({ AgentApprover: settings })
                ? settings
                : {
                      ...settings,
                      SignSeed: fresh.signSeed,
                      KEMSeed: fresh.kemSeed,
                      // A pass belongs to the key it was issued for.
                      RelayPass: "",
                      RelayPassExpiresAt: 0,
                  },
        );
        this.assertLive();
        const identity = identityFromVault(this.deps.getVault());
        if (!saved || !identity)
            throw new Error("Couldn't save the approver keys in your vault");
        this.sync();
        return identity;
    }

    customRelays(): CustomRelay[] {
        return (this.deps.getVault().AgentApprover?.CustomRelays ?? []).map(
            (relay) => ({ origin: relay.Origin, token: relay.Token }),
        );
    }

    /** Adds or replaces the token for one relay. */
    async saveCustomRelay(relay: CustomRelay, replacing?: string) {
        const saved = await this.saveSettings((settings) => ({
            ...settings,
            CustomRelays: [
                ...settings.CustomRelays.filter(
                    (item) =>
                        item.Origin !== relay.origin &&
                        item.Origin !== replacing,
                ),
                { Origin: relay.origin, Token: relay.token },
            ],
        }));
        if (!saved) throw new Error("Couldn't save the relay");
        await this.runtime?.reload();
    }

    async removeCustomRelay(origin: string) {
        const saved = await this.saveSettings((settings) => ({
            ...settings,
            CustomRelays: settings.CustomRelays.filter(
                (item) => item.Origin !== origin,
            ),
        }));
        if (!saved) throw new Error("Couldn't remove the relay");
        await this.runtime?.reload();
    }

    /**
     * The hosted relay pass, renewed while it has a day or less left and
     * Online Services is signed in, and kept in the vault in between.
     */
    private async getPass(relay: RelayTarget): Promise<string | null> {
        if (relay.kind !== "hosted" || !this.identity) return null;
        const identity = this.identity;
        const settings = this.deps.getVault().AgentApprover;
        const now = Date.now();
        const usable =
            settings?.RelayPass && settings.RelayPassExpiresAt > now
                ? settings.RelayPass
                : null;
        if (usable && settings!.RelayPassExpiresAt - now > PASS_RENEW_MS)
            return usable;
        if (!this.deps.canSign()) return usable;
        this.passRequest ??= (async () => {
            try {
                const fresh = await this.deps.requestPass(relayKeyOf(identity));
                if (!fresh) return usable;
                await this.saveSettings((current) =>
                    bytesEqual(current.SignSeed, identity.signSeed)
                        ? {
                              ...current,
                              RelayPass: fresh.pass,
                              RelayPassExpiresAt: fresh.expiresAt,
                          }
                        : current,
                );
                return fresh.pass;
            } catch (error) {
                this.log("Couldn't renew the relay pass", error);
                return usable;
            } finally {
                this.passRequest = null;
            }
        })();
        return this.passRequest;
    }

    // -- Pairing and agents ------------------------------------------------

    /** Keeps the approver up in this tab while the connect dialog is open. */
    async beginPairing(): Promise<() => void> {
        this.pairing++;
        let ended = false;
        let endRuntime: (() => Promise<void>) | null = null;
        const end = () => {
            if (ended) return;
            ended = true;
            // The last hold (the connect dialog closed): pairings accepted
            // and not confirmed are cancelled, also one whose acceptance
            // is still underway.
            const runtime = this.runtime;
            if (this.pairing === 1 && runtime && !this.disposed)
                for (const agentId of this.unconfirmed) {
                    this.unconfirmed.delete(agentId);
                    void runtime.cancelPairing(agentId);
                }
            this.pairing--;
            // The runtime cleans up pairings this hold leaves unkept; stay
            // the leader until it has.
            this.endingHolds++;
            void Promise.resolve(endRuntime?.()).finally(() => {
                this.endingHolds--;
                this.sync();
            });
            this.sync();
        };
        try {
            const runtime = await this.activeRuntime();
            endRuntime = await runtime.beginPairing();
        } catch (error) {
            end();
            throw error;
        }
        return end;
    }

    async claim(code: string): Promise<ClaimedPairing> {
        return (await this.activeRuntime()).claim(code);
    }

    async accept(
        claim: ClaimedPairing,
        input: { agentName: string; keys: GrantedKeyInput[] },
    ): Promise<PairingResult> {
        const runtime = await this.activeRuntime();
        // Disposed while that resolved: dispose() has already cancelled the
        // pairings it knew, so this one must not start.
        this.assertLive();
        // Counted from the start: accept() registers the agent on the relay.
        this.unconfirmed.add(claim.agentId);
        try {
            return await runtime.accept(claim, input);
        } catch (error) {
            this.unconfirmed.delete(claim.agentId);
            throw error;
        }
    }

    async waitForConfirmation(agentId: string): Promise<void> {
        await (await this.activeRuntime()).waitForConfirmation(agentId);
        // Confirmed: the connect dialog saves the record next, in the same
        // turn, and a lock from here on keeps the agent registered.
        this.unconfirmed.delete(agentId);
    }

    /** The pairing failed after the code was answered (AgentRuntime.pairingFailed). */
    pairingFailed(agentId: string) {
        this.unconfirmed.delete(agentId);
        // Also after dispose: the last runtime reaches its approver's cleanup.
        (this.runtime ?? this.retired)?.pairingFailed(agentId);
    }

    async sendKeys(
        agentId: string,
        input: { agentName: string; keys: GrantedKeyInput[]; revision: number },
    ): Promise<void> {
        return (await this.activeRuntime()).sendKeys(agentId, input);
    }

    async unregister(agentId: string): Promise<void> {
        return (await this.activeRuntime()).unregister(agentId);
    }

    /**
     * The connect dialog closed before the agent confirmed: unregister it
     * on the relay through the runtime running now (AgentRuntime.cancelPairing).
     * Never takes the approver over: on a disposed host, dispose() already
     * did this.
     */
    cancelPairing(agentId: string): Promise<void> {
        const runtime = this.runtime;
        const pending = this.unconfirmed.delete(agentId);
        if (this.disposed || !runtime || !pending) return Promise.resolve();
        return runtime.cancelPairing(agentId);
    }

    approve(id: string, choice: RememberChoice) {
        if (!this.runtime) return Promise.reject(new RequestGoneError());
        return this.runtime.approve(id, choice);
    }

    deny(id: string) {
        return this.runtime?.deny(id) ?? Promise.resolve();
    }
}

function sameIdentity(a: AgentIdentity | null, b: AgentIdentity | null) {
    if (!a || !b) return a === b;
    return (
        bytesEqual(a.signSeed, b.signSeed) && bytesEqual(a.kemSeed, b.kemSeed)
    );
}
