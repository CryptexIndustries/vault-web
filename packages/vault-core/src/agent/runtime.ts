import { base64ToUint8, uint8ToBase64 } from "../encoding";
import { RefusalReason } from "../proto/agent";
import {
    AgentRequestKind,
    AgentRequestOutcome,
    type AgentRequestRecord,
    type SSHKeyData,
} from "../proto/vault";
import type {
    ApprovedAgent,
    ApproverHost,
    ClaimedPairing,
    GrantedKeyInput,
    IncomingRequest,
    PairingResult,
    RelayTarget,
    SignAnswer,
    WebSocketLike,
} from "./approver-types";
import { isAllowedRelayUrl } from "../vault-utils/connected-agents";
import {
    AnswerCancelledError,
    ApproverStoppedError,
    PairingCancelledError,
    RequestGoneError,
    type AnswerOptions,
    type DeliveryProgress,
} from "./approver";
import type { AgentIdentity } from "./envelope";
import { normalizeRelayUrl } from "./relay-client";
import {
    CONNECTED_AGENT_HISTORY_MAX_AGE_MS,
    CONNECTED_AGENT_HISTORY_MAX_ENTRIES,
} from "../vault-utils/connected-agents";
import {
    callerProcess,
    processLabel,
    RememberedApprovals,
    type RememberChoice,
} from "./remember";
import { NAME_LENGTH, sanitizeDisplayText } from "./request-check";

/**
 * The approver runtime both apps host: one Approver for all relays, the
 * requests waiting for the user, and the routing between the approval
 * screen, notifications and remembered approvals. The Android app and the
 * web dashboard supply storage, signing and UI through RuntimeDeps.
 */

export { RequestGoneError };

/**
 * What the runtime uses of the Approver (approver.ts). An interface so the
 * runtime can be tested with a fake.
 */
export interface ApproverPort {
    start(): void;
    stop(): void;
    /** Re-reads host.relays() and host.agents(). */
    refresh(): void;
    claim(codeText: string): Promise<ClaimedPairing>;
    accept(
        claim: ClaimedPairing,
        input: { agentName: string; keys: GrantedKeyInput[] },
    ): Promise<PairingResult>;
    /** Resolves on PairingConfirm; rejects on revoke, timeout or stop. */
    waitConfirmed(agentId: string, timeoutMs?: number): Promise<void>;
    /** Transport: sends an answer to a reported request (Approver.answer). */
    answer(
        requestId: string,
        answer: SignAnswer,
        options?: AnswerOptions,
    ): Promise<void> | void;
    sendKeys(
        agentId: string,
        input: { agentName: string; keys: GrantedKeyInput[]; revision: number },
    ): Promise<void>;
    /** relay: where to reach an agent the host no longer lists (a deleted record). */
    unregister(agentId: string, relay?: RelayTarget): Promise<void>;
    /**
     * Ends a pairing that wasn't kept and unregisters it on the claim's
     * relay (the approver owns the registrations it made). Never rejects.
     */
    cancelPairing?(agentId: string): Promise<void>;
}

export type CreateApprover = (host: ApproverHost) => ApproverPort;

/** Public data about one agent this device approves. */
export type CachedAgent = {
    id: string;
    name: string;
    /** base64 */
    signPublicKey: string;
    /** base64 */
    kemPublicKey: string;
    /** Empty for the hosted relay. */
    relayOrigin: string;
    /** SSH wire public keys (base64) granted to it, so ungranted keys are refused while locked. */
    grantedKeys?: string[];
    /** Requests are refused without asking (ConnectedAgent.Paused). */
    paused?: boolean;
    /**
     * The synced record is a tombstone (revoked on some device). The runtime
     * unregisters it on the relay and forgets the local approval.
     */
    deleted?: boolean;
};

/**
 * An agent this device paired, and the keys it last sent it (base64 SSH
 * wire public keys). Kept on the device only: Vault field 14 on the web,
 * secure storage on Android. The runtime serves only agents listed here,
 * and only keys that are both here and in the synced record.
 */
export type LocalAgentApproval = {
    agentId: string;
    keys: string[];
};

export type LocalApprovalStore = {
    load(): Promise<LocalAgentApproval[]>;
    save(approvals: LocalAgentApproval[]): Promise<void>;
};

/** A self-hosted relay and its access token. */
export type CustomRelay = {
    /** Normalized origin, such as "https://relay.example.com". */
    origin: string;
    token: string;
};

/** Prompts waiting per agent; more are refused so a flood can't wear the user down. */
export const MAX_PROMPTS_PER_AGENT = 3;
/**
 * How long an approval screen the runtime asked for may take to appear
 * before route() asks again (navigation can be dropped, as when the user
 * backs out of unlock).
 */
export const SCREEN_OPEN_GRACE_MS = 5_000;
/** How long answers are kept to resend when the agent repeats a request. */
const ANSWER_MEMORY_MS = 3 * 60_000;
/**
 * History entries kept while the vault is locked, across all agents. Each
 * agent also keeps at most the persisted history's 200 entries of 90 days.
 */
export const MAX_QUEUED_HISTORY = 1_000;

export type GrantedKey = {
    credentialId: string;
    name: string;
    sshKey: SSHKeyData;
};

export type VaultAccess = {
    /** Unlocked and the auto-lock deadline hasn't passed. */
    canSign(): boolean;
    /**
     * The granted SSH key item matching a request's public key, null when the
     * key isn't granted, "locked" while the vault can't tell.
     */
    grantedKey(
        agentId: string,
        publicKey: Uint8Array,
    ): GrantedKey | null | "locked";
    /**
     * The live vault record says Paused. Read like grantedKey, so a stale
     * agent cache can't undo a pause; the cache's flag counts as well.
     * False while the vault can't tell (the cache's flag counts then).
     */
    isPaused(agentId: string): boolean;
    /**
     * The vault holds the agent's (live) ConnectedAgent record: a pairing
     * whose record was saved is kept, never unregistered. "locked" when the
     * vault can't tell (it is kept then too).
     */
    hasAgentRecord(agentId: string): boolean | "locked";
    /** Appends to the agent's synced history; false while locked. */
    appendHistory(agentId: string, entry: AgentRequestRecord): Promise<boolean>;
    /** Appends several entries in one vault write (the history queued while locked). */
    appendHistoryEntries(
        agentId: string,
        entries: AgentRequestRecord[],
    ): Promise<boolean>;
};

export type RuntimeUi = {
    /** The app is in the foreground. */
    isForeground(): boolean;
    /** Opens the approval screen; only called while the vault is unlocked. */
    openRequest(requestId: string): void;
    showNotification(
        requestId: string,
        agentName: string,
        vaultLocked: boolean,
    ): void;
    cancelNotification(requestId: string): void;
    /**
     * The app shows its unlock screen in the foreground (Android, after
     * Review while locked). The reviewed request's notification stays away
     * meanwhile and comes back if the user leaves the app instead.
     */
    showsUnlock?(): boolean;
};

export type RuntimeDeps = {
    createApprover: CreateApprover;
    loadIdentity(): Promise<AgentIdentity>;
    deviceName(): string;
    loadAgentCache(): Promise<CachedAgent[]>;
    loadCustomRelays(): Promise<CustomRelay[]>;
    /** The device-local list of agents this device paired (LocalAgentApproval). */
    localApprovals: LocalApprovalStore;
    hostedRelayUrl: string;
    getPass(relay: RelayTarget): Promise<string | null>;
    vault: VaultAccess;
    /**
     * signal aborts when the vault starts locking; the signer may stop
     * early (the runtime discards a late signature either way).
     */
    sign(
        key: SSHKeyData,
        publicBlob: Uint8Array,
        data: Uint8Array,
        flags: number,
        options?: { signal?: AbortSignal },
    ): Promise<Uint8Array>;
    ui: RuntimeUi;
    /** A platform service kept up while an agent is approved here (Android). */
    service?: { start(): void; stop(): void };
    /** Remembered approvals; the app clears them when the vault locks. */
    remembered?: RememberedApprovals;
    openWebSocket(url: string, protocols: string[]): WebSocketLike;
    fetch: typeof fetch;
    now?: () => number;
    setTimer?: (callback: () => void, ms: number) => unknown;
    clearTimer?: (handle: unknown) => void;
    log?: (message: string, detail?: unknown) => void;
    /** Bound for a pairing cleanup's unregister (PAIRING_CLEANUP_MS). */
    pairingCleanupMs?: number;
};

/** Shown for an agent its relay says it doesn't know (relayForgot). */
export const RELAY_FORGOT_AGENT_TEXT =
    "The relay no longer knows this agent. Pair it again or remove it.";

export class VaultLockedError extends Error {
    constructor() {
        super("Unlock your vault to approve this request.");
    }
}

/** approve() again while the first approval is still being sent. */
export class ApprovalInProgressError extends Error {
    constructor() {
        super("This request is being approved already.");
    }
}

/**
 * approve(): the request expired while its signature was being sent, or
 * after a send the relay never confirmed. The signature may have reached
 * the machine; the history says Approved.
 */
export class AnswerUncertainError extends RequestGoneError {
    constructor() {
        super();
        this.message =
            "The relay didn't confirm the answer. The machine may have it.";
    }
}

/**
 * Normalizes a relay address for saving and connecting: origin plus any
 * base path, such as "https://example.com/relay". https only, except on
 * this machine (localhost, 127.0.0.1, [::1]) for development. Null when
 * the address can't be used.
 */
export function normalizeRelayUrlInput(text: string): string | null {
    try {
        const url = normalizeRelayUrl(text);
        return isAllowedRelayUrl(url) ? url : null;
    } catch {
        return null;
    }
}

/** Two relay URLs name the same relay endpoint. */
export function sameRelayUrl(a: string, b: string): boolean {
    if (a === b) return true;
    try {
        return normalizeRelayUrl(a) === normalizeRelayUrl(b);
    } catch {
        return false;
    }
}

export function relayTargetFor(
    relayOrigin: string,
    hostedRelayUrl: string,
    customRelays: readonly CustomRelay[],
): RelayTarget {
    const hosted = normalizeRelayUrl(hostedRelayUrl);
    if (!relayOrigin || sameRelayUrl(relayOrigin, hosted))
        return { kind: "hosted", url: hosted };
    const token =
        customRelays.find((relay) => sameRelayUrl(relay.origin, relayOrigin))
            ?.token ?? "";
    return { kind: "custom", url: relayOrigin, token };
}

export function historyEntry(
    request: IncomingRequest,
    outcome: AgentRequestOutcome,
    credentialId: string,
    now: number,
): AgentRequestRecord {
    const { check } = request;
    return {
        Timestamp: now,
        Kind:
            check.kind === "login"
                ? AgentRequestKind.AgentRequestLogin
                : check.kind === "signature"
                  ? AgentRequestKind.AgentRequestSignature
                  : AgentRequestKind.AgentRequestOther,
        Outcome: outcome,
        Namespace: check.namespace ?? "",
        Host: check.verifiedHost?.names[0] ?? "",
        HostKeyFingerprint: check.verifiedHost?.fingerprint ?? "",
        Forwarded: check.forwardedVia.length > 0,
        DestinationUnknown: check.destinationUnknown,
        CredentialID: credentialId,
        Process: processLabel(callerProcess(request.sign.processes)),
    };
}

type Listener = () => void;

/**
 * Where a sign request is. One Tracked object per request, owned by the
 * runtime from onRequest until it ends; the approver only carries answers.
 *
 *   new      being checked (paused, granted, rules); not shown
 *   held     its agent is joining (paired, record not saved yet); not shown
 *   waiting  for the user (prompt or notification), also while locked
 *   signing  approved (by the user or a remembered rule), sign() running
 *   sending  signature ready; with the relay, or waiting for its connection
 *
 * It ends exactly once (end()), with one history entry: Approved or
 * ApprovedByRule when sent, Denied, Refused, or Expired. Pause, Deny,
 * expiry, withdrawal by the relay, revoke and stop end it whatever the
 * state; a lock sends signing and sending ones back to waiting.
 */
type RequestState = "new" | "held" | "waiting" | "signing" | "sending";

/** An approval underway: signing, then delivering the signature. */
type Approval = {
    /** The unlock session it began in. */
    session: number;
    credentialId: string;
    choice: RememberChoice;
    /** Aborts sign() and the delivery when the approval is called off. */
    abort: AbortController;
    progress: DeliveryProgress;
    resolve: () => void;
    reject: (error: Error) => void;
};

type Tracked = {
    request: IncomingRequest;
    state: RequestState;
    /** Approved by a remembered rule: no prompt unless a lock sends it back. */
    auto: boolean;
    timer: unknown;
    approval?: Approval;
    /**
     * A signature for it may have reached the machine (sent, then no
     * Result), kept when a lock calls that approval off: expiry then
     * records Approved, not Expired.
     */
    mayHaveSent?: { credentialId: string; auto: boolean };
};

/**
 * The approval underway may have reached the machine (sent, or taken by
 * the relay): its key and its source, so a rule never teaches KnownHosts a
 * name the user didn't see.
 */
function sentEvidence(t: Tracked): Tracked["mayHaveSent"] {
    const approval = t.approval;
    if (!approval) return undefined;
    const { inFlight, uncertain, delivered } = approval.progress;
    return inFlight || uncertain || delivered
        ? { credentialId: approval.credentialId, auto: t.auto }
        : undefined;
}

/**
 * The latest Pause or Resume started on this device for an agent, until
 * its save is durable (pauseSaved with its token). A pending Pause counts
 * as paused; a pending Resume unpauses nothing.
 */
type PauseIntent = { token: number; paused: boolean };

/** An answer that went out, resent to repeats while it may be. */
type Answered = {
    request: IncomingRequest;
    answer: SignAnswer;
    /** Signatures: the unlock session they were made in. */
    session: number;
    credentialId: string;
    at: number;
};

/**
 * Runs while this device approves at least one agent or a pairing is open.
 * Android keeps it up locked too (requests post notifications); the web
 * dashboard stops it on lock. Signing always needs the unlocked vault.
 */
export class AgentRuntime {
    private approver: ApproverPort | null = null;
    /** The approver of the last start, for pairing cleanups after stop. */
    private retired: ApproverPort | null = null;
    private starting: Promise<ApproverPort> | null = null;
    private agents: CachedAgent[] = [];
    private customRelays: CustomRelay[] = [];
    /** Every request not ended yet, in any state. */
    private requests = new Map<string, Tracked>();
    /** Answers that went out, for repeats (refusals and signatures). */
    private answers = new Map<string, Answered>();
    private queuedHistory: { agentId: string; entry: AgentRequestRecord }[] =
        [];
    private confirmed = new Set<string>();
    /** Device-local approvals (LocalAgentApproval). */
    private local: LocalAgentApproval[] = [];
    /** Every read and change of the local approvals runs here, one at a time. */
    private localQueue: Promise<unknown> = Promise.resolve();
    /** Bumped by each completed change, so a reload can't install an older list. */
    private localVersion = 0;
    /** The last reload; the next one starts after it. */
    private reloads: Promise<unknown> = Promise.resolve();
    /**
     * Agents accepted while pairing that the runtime doesn't serve yet: the
     * app saves the record after PairingConfirm, so a first request can
     * come before it. Their requests are held until the record is served,
     * and refused if the pairing fails or ends without it.
     */
    private joining = new Set<string>();
    private pauseIntents = new Map<string, PauseIntent>();
    private pauseTokens = 0;
    /** Pairings being cleaned up (AgentRuntime.cancelPairing). */
    private pairingCleanups = new Map<string, Promise<void>>();
    /** Agents the relay says it doesn't know: a local state, never synced. */
    private relayDropped = new Set<string>();
    /** Deleted agents being unregistered on their relay. */
    private unregistering = new Set<string>();
    /** The vault is locking: nothing is signed from here on. */
    private locking = false;
    /**
     * The unlock session approvals belong to. A lock (or stop) ends it at
     * once; a signature or remembered rule from an earlier session is
     * never released, even after the next unlock.
     */
    private session = 0;
    private listeners = new Set<Listener>();
    /** The request on the mounted approval screen, if any. */
    private shownRequestId: string | null = null;
    private screenMounted = false;
    /** An approval screen asked for and not mounted yet. */
    private opening: { id: string; at: number } | null = null;
    private openTimer: unknown = undefined;
    /** The request the user picked with Review; it goes first. */
    private preferredId: string | null = null;
    /** Posted notifications and whether they said "locked", to avoid re-alerting. */
    private notified = new Map<string, boolean>();
    private stopWaiters: Array<() => void> = [];
    private pairing = 0;
    private version = 0;
    /** Bumped on shutdown, so a start that was underway gives up. */
    private generation = 0;
    private stopped = false;

    readonly remembered: RememberedApprovals;

    constructor(private readonly deps: RuntimeDeps) {
        this.remembered = deps.remembered ?? new RememberedApprovals();
    }

    private now() {
        return this.deps.now?.() ?? Date.now();
    }

    private setTimer(callback: () => void, ms: number): unknown {
        return (this.deps.setTimer ?? ((cb, delay) => setTimeout(cb, delay)))(
            callback,
            ms,
        );
    }

    private clearTimer(handle: unknown) {
        if (handle === undefined) return;
        (this.deps.clearTimer ?? ((value) => clearTimeout(value as never)))(
            handle,
        );
    }

    // -- State for screens -------------------------------------------------

    subscribe(listener: Listener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    /** Changes whenever the pending requests or agents change. */
    getVersion() {
        return this.version;
    }

    private changed() {
        this.version++;
        for (const listener of this.listeners) listener();
    }

    /** Shown to the user: waiting, or being approved from the prompt. */
    private visible(t: Tracked) {
        return t.state !== "new" && t.state !== "held" && !t.auto;
    }

    getRequest(id: string): IncomingRequest | undefined {
        const t = this.requests.get(id);
        return t && this.visible(t) ? t.request : undefined;
    }

    pendingRequests(): IncomingRequest[] {
        return [...this.requests.values()]
            .filter((t) => this.visible(t))
            .map((t) => t.request)
            .sort((a, b) => a.receivedAt - b.receivedAt);
    }

    /** Requests waiting for the user, for "1 of 3" on the approval screen. */
    waitingCount(): number {
        return this.pendingRequests().length;
    }

    /** The key a waiting request would sign with; null while locked or not granted. */
    keyFor(request: IncomingRequest): GrantedKey | null {
        const key = this.grantFor(request);
        return key === "locked" ? null : key;
    }

    /** The agent's name for display, sanitized. */
    agentName(agentId: string): string {
        const name = this.agents.find((agent) => agent.id === agentId)?.name;
        return name ? sanitizeDisplayText(name, NAME_LENGTH) : "an agent";
    }

    /** The relay said it doesn't know this agent (RELAY_FORGOT_AGENT_TEXT). */
    relayForgot(agentId: string): boolean {
        return this.relayDropped.has(agentId);
    }

    /** This device paired the agent (it is in the device-local list). */
    approvesLocally(agentId: string): boolean {
        return this.local.some((item) => item.agentId === agentId);
    }

    /** Unlocked, not locking, and the auto-lock deadline hasn't passed. */
    canSign(): boolean {
        return !this.locking && this.deps.vault.canSign();
    }

    /**
     * Call first thing in the app's lock path, before saves and backup
     * flushes: stops signing and forgets remembered approvals at once.
     * Synchronous and never throws, so it can't hold up or break the lock.
     * Signing stays off until onVaultUnlocked, also when the lock fails.
     */
    setLocking(locking: boolean) {
        this.locking = locking;
        if (locking) this.endSession();
        try {
            if (locking) this.remembered.clear();
            this.changed();
        } catch (error) {
            this.deps.log?.("Couldn't clear remembered approvals", error);
        }
    }

    /**
     * Records this device's Pause or Resume at once (see PauseIntent; the
     * app saves ConnectedAgent.Paused and then calls pauseSaved). A Pause
     * refuses the agent's requests, also ones being approved, and ends its
     * stored signatures before anything is awaited. A Resume takes effect
     * when the saved record reaches the cache and the live vault.
     */
    async setPaused(agentId: string, paused: boolean) {
        this.pauseIntents.set(agentId, { token: ++this.pauseTokens, paused });
        if (paused) {
            for (const [id, answered] of this.answers)
                if (
                    answered.request.agentId === agentId &&
                    "signature" in answered.answer
                )
                    this.answers.delete(id);
            await this.refusePaused();
            await this.reconcile();
        }
        this.changed();
    }

    /** The token of the Pause or Resume setPaused just recorded. */
    pauseToken(agentId: string): number | undefined {
        return this.pauseIntents.get(agentId)?.token;
    }

    /**
     * That Pause or Resume is saved in the vault: the cache and the live
     * record decide from now on. Only the latest one's token counts; an
     * older one finishing changes nothing, and a failed save never gets
     * here, so its intent stays.
     */
    pauseSaved(agentId: string, token: number) {
        if (this.pauseIntents.get(agentId)?.token !== token) return;
        this.pauseIntents.delete(agentId);
        this.changed();
    }

    /**
     * Ends the unlock session: approvals underway go back to waiting
     * (VaultLockedError), except a signature already on its way, and no
     * signature is resent. Never throws.
     */
    private endSession() {
        this.session++;
        try {
            for (const [id, value] of this.answers)
                if ("signature" in value.answer) this.answers.delete(id);
            let moved = false;
            for (const t of this.requests.values()) {
                // On its way, or the relay took it: it finalizes as Approved.
                if (
                    !t.approval ||
                    t.approval.progress.inFlight ||
                    t.approval.progress.delivered
                )
                    continue;
                // Stopping: shutdown ends them; no prompt in between.
                if (this.stopped) {
                    void this.end(t, null, "", new VaultLockedError());
                    continue;
                }
                this.backToWaiting(t, new VaultLockedError());
                moved = true;
            }
            if (moved) this.route();
        } catch (error) {
            this.deps.log?.("Couldn't call off approvals underway", error);
        }
    }

    /**
     * Paused in the cache, in the live vault record, or by a Pause this
     * device started and hasn't saved yet. Fails closed: when the live
     * record can't be read, paused.
     */
    private isPaused(agentId: string) {
        if (this.pauseIntents.get(agentId)?.paused) return true;
        if (this.agents.find((agent) => agent.id === agentId)?.paused)
            return true;
        try {
            return this.deps.vault.isPaused(agentId);
        } catch {
            return true;
        }
    }

    /** Served here, not paused, and the relay hasn't said it forgot it. */
    private agentUsable(agentId: string) {
        return (
            this.isServed(agentId) &&
            !this.isPaused(agentId) &&
            !this.relayDropped.has(agentId)
        );
    }

    private async refusePaused() {
        const refusals = [...this.requests.values()]
            .filter(
                (t) => t.state !== "held" && this.isPaused(t.request.agentId),
            )
            .map((t) =>
                this.refuse(
                    t,
                    RefusalReason.REFUSAL_REASON_DENIED,
                    AgentRequestOutcome.AgentOutcomeRefused,
                ),
            );
        await Promise.all(refusals);
    }

    /**
     * The granted key for a request: in the synced record (VaultAccess) and
     * in what this device sent the agent (the local approval).
     */
    private grantFor(request: IncomingRequest): GrantedKey | null | "locked" {
        if (this.locking) return "locked";
        const key = this.deps.vault.grantedKey(
            request.agentId,
            request.sign.publicKey,
        );
        if (key === null || key === "locked") return key;
        const wire = uint8ToBase64(request.sign.publicKey);
        const local = this.local.find(
            (item) => item.agentId === request.agentId,
        );
        return local?.keys.includes(wire) ? key : null;
    }

    /** Agents the approver serves: paired here, not deleted, keys this device sent. */
    private served(): CachedAgent[] {
        return this.agents.flatMap((agent) => {
            const local = this.local.find((item) => item.agentId === agent.id);
            if (!local || agent.deleted) return [];
            return [
                {
                    ...agent,
                    grantedKeys: (agent.grantedKeys ?? []).filter((key) =>
                        local.keys.includes(key),
                    ),
                },
            ];
        });
    }

    private isServed(agentId: string) {
        return this.served().some((agent) => agent.id === agentId);
    }

    /** Deleted records this device still approves: unregister them on the relay. */
    private deletedHere(): CachedAgent[] {
        return this.agents.filter(
            (agent) => agent.deleted && this.approvesLocally(agent.id),
        );
    }

    /**
     * The approval screen reports which request it shows. While it is open
     * it moves on to the next request itself; null when it closes.
     */
    setShownRequest(id: string | null, mounted = id !== null) {
        this.shownRequestId = id;
        this.screenMounted = mounted;
        if (mounted) this.opening = null;
        if (id) this.hideNotification(id);
    }

    /** The approval screen is open on this request. */
    isShowing(id: string) {
        return this.screenMounted && this.shownRequestId === id;
    }

    /** What the approval screen shows next: the reviewed request, else the oldest. */
    nextRequest(): IncomingRequest | undefined {
        const preferred = this.preferredId
            ? this.getRequest(this.preferredId)
            : undefined;
        return preferred ?? this.pendingRequests()[0];
    }

    /**
     * Review on a notification. Returns false while the vault is locked: the
     * app then shows unlock, and the request opens after the next unlock
     * (route() runs then), whether or not this unlock finishes.
     */
    review(id: string): boolean {
        // After a cold start the request may only arrive once the agent
        // resends it, so remember the choice either way.
        this.preferredId = id;
        this.hideNotification(id);
        if (!this.canSign()) return false;
        // An open screen moves on to it after its current request.
        if (!this.screenMounted) this.open(id);
        return true;
    }

    private open(id: string) {
        this.opening = { id, at: this.now() };
        this.deps.ui.openRequest(id);
        // Navigation can be dropped (another screen replacing itself at the
        // same moment); look again once the grace period is over.
        this.clearTimer(this.openTimer);
        this.openTimer = this.setTimer(() => {
            this.openTimer = undefined;
            if (!this.screenMounted && this.getRequest(id)) this.route();
        }, SCREEN_OPEN_GRACE_MS + 100);
    }

    /** Reconnects relays now and renews the hosted relay pass if it can. */
    refreshRelays() {
        this.approver?.refresh();
    }

    /** Resolves when the runtime shuts down (no agents left). */
    whenStopped(): Promise<void> {
        if (!this.approver && !this.starting) return Promise.resolve();
        return new Promise((resolve) => this.stopWaiters.push(resolve));
    }

    get running() {
        return this.approver !== null;
    }

    // -- Lifecycle ---------------------------------------------------------

    /**
     * Re-reads the agent cache and relay tokens, then starts or stops. Runs
     * one at a time: a read from before the cache caught up with the vault
     * (a just-paired agent) can't finish last and stop the approver.
     */
    reload(): Promise<void> {
        const run = this.reloads.then(() => this.reloadNow());
        this.reloads = run.catch(() => undefined);
        return run;
    }

    private async reloadNow(): Promise<void> {
        if (this.stopped) return;
        const agents = await this.deps.loadAgentCache();
        const customRelays = await this.deps.loadCustomRelays();
        const version = this.localVersion;
        const local = await this.serialLocal(() =>
            this.deps.localApprovals.load(),
        );
        // stop() ran meanwhile: stay down.
        if (this.stopped) return;
        this.agents = agents;
        this.customRelays = customRelays;
        // A change completed since this read started: it holds the newer list.
        if (this.localVersion === version) this.local = local;
        const served = this.served();
        this.releaseHeld();
        // Requests of agents no longer served (revoked, or never paired here).
        await this.endAgents(
            (agentId) =>
                !this.joining.has(agentId) &&
                !served.some((agent) => agent.id === agentId),
        );
        await this.refusePaused();
        await this.reconcile();
        if (
            served.length ||
            this.pairing ||
            this.joining.size ||
            this.pairingCleanups.size ||
            this.deletedHere().length
        ) {
            const approver = await this.ensureApprover();
            approver.refresh();
            // The permanent notification only while an agent is approved here.
            if (served.length) this.deps.service?.start();
            else this.deps.service?.stop();
            this.unregisterDeleted(approver);
        } else {
            this.shutdown();
        }
        this.changed();
    }

    /**
     * An agent this device approves was revoked on another device (a synced
     * tombstone): remove it on the relay too, then forget it here. Retried
     * on the next reload when the relay can't be reached.
     */
    private unregisterDeleted(approver: ApproverPort) {
        for (const agent of this.deletedHere()) {
            if (this.unregistering.has(agent.id)) continue;
            this.unregistering.add(agent.id);
            void approver
                .unregister(agent.id, this.relayFor(agent))
                .then(async () => {
                    await this.updateLocal((list) =>
                        list.filter((item) => item.agentId !== agent.id),
                    );
                    this.relayDropped.delete(agent.id);
                    await this.reload();
                })
                .catch((error: unknown) =>
                    this.deps.log?.(
                        "Couldn't remove a revoked agent on its relay",
                        error,
                    ),
                )
                .finally(() => this.unregistering.delete(agent.id));
        }
    }

    /** Runs operation after every earlier local-approval read or change. */
    private serialLocal<T>(operation: () => Promise<T>): Promise<T> {
        const run = this.localQueue.then(operation, operation);
        this.localQueue = run.catch(() => undefined);
        return run;
    }

    /** Reads, changes and saves the local approvals as one queued step. */
    private updateLocal(
        change: (list: LocalAgentApproval[]) => LocalAgentApproval[],
    ): Promise<void> {
        return this.serialLocal(async () => {
            const next = change(await this.deps.localApprovals.load());
            await this.deps.localApprovals.save(next);
            this.local = next;
            this.localVersion++;
        });
    }

    /**
     * Stops the approver for good and forgets waiting requests and
     * remembered approvals, as when the vault locks on the web. Later
     * reload() calls do nothing; the app makes a new runtime.
     */
    stop() {
        this.stopped = true;
        this.endSession();
        this.pairing = 0;
        this.joining.clear();
        this.shutdown();
        this.remembered.clear();
        this.changed();
    }

    private shutdown() {
        this.generation++;
        // Gone with the runtime: no answer, and no history (nothing to write it to).
        for (const t of this.requests.values()) void this.end(t, null);
        this.approver?.stop();
        this.retired = this.approver ?? this.retired;
        this.approver = null;
        this.starting = null;
        this.deps.service?.stop();
        this.clearTimer(this.openTimer);
        this.openTimer = undefined;
        const waiters = this.stopWaiters;
        this.stopWaiters = [];
        for (const resolve of waiters) resolve();
    }

    private ensureApprover(): Promise<ApproverPort> {
        if (this.approver) return Promise.resolve(this.approver);
        this.starting ??= (async () => {
            const generation = this.generation;
            if (this.stopped) throw new Error("The approver stopped");
            const identity = await this.deps.loadIdentity();
            // Shut down while the identity loaded: don't start a stray approver.
            if (generation !== this.generation || this.stopped)
                throw new Error("The approver stopped");
            const approver = this.deps.createApprover(this.host(identity));
            approver.start();
            this.approver = approver;
            return approver;
        })().catch((error: unknown) => {
            this.starting = null;
            throw error;
        });
        return this.starting;
    }

    private relayFor(agent: CachedAgent) {
        return relayTargetFor(
            agent.relayOrigin,
            this.deps.hostedRelayUrl,
            this.customRelays,
        );
    }

    private host(identity: AgentIdentity): ApproverHost {
        // Callbacks from an approver of an earlier start, or after stop(),
        // change nothing.
        const generation = this.generation;
        const live = () => !this.stopped && generation === this.generation;
        return {
            identity,
            deviceName: this.deps.deviceName(),
            openWebSocket: (url, protocols) =>
                this.deps.openWebSocket(url, protocols),
            fetch: this.deps.fetch,
            now: this.deps.now,
            hostedRelayUrl: this.deps.hostedRelayUrl,
            pairingCleanupMs: this.deps.pairingCleanupMs,
            getPass: (relay) => this.deps.getPass(relay),
            // The approver drops duplicates and skips unusable URLs.
            relays: () => [
                ...[...this.served(), ...this.deletedHere()].map((agent) =>
                    this.relayFor(agent),
                ),
                // While pairing, saved custom relays are known so a code
                // that names one can be claimed. (The configured hosted
                // relay is known to the approver as hostedRelayUrl.)
                ...(this.pairing
                    ? this.customRelays.map(
                          (relay): RelayTarget => ({
                              kind: "custom",
                              url: relay.origin,
                              token: relay.token,
                          }),
                      )
                    : []),
            ],
            agents: (): ApprovedAgent[] =>
                this.served().map((agent) => ({
                    id: agent.id,
                    signPublicKey: base64ToUint8(agent.signPublicKey),
                    kemPublicKey: base64ToUint8(agent.kemPublicKey),
                    relay: this.relayFor(agent),
                    grantedKeys: agent.grantedKeys?.map(base64ToUint8),
                })),
            onRequest: (request) => {
                if (live()) void this.onRequest(request);
            },
            onRepeat: (id) => {
                if (!live()) return;
                const answered = this.answers.get(id);
                if (answered) this.resend(answered);
            },
            onRequestGone: (id) => {
                if (!live()) return;
                const t = this.requests.get(id);
                // Withdrawn by the relay: nobody to answer.
                if (t)
                    void this.finish(
                        t,
                        AgentRequestOutcome.AgentOutcomeRefused,
                    );
            },
            onAgentConfirmed: (agentId) => {
                if (!live()) return;
                this.confirmed.add(agentId);
                this.changed();
            },
            onRelayDroppedAgent: (agentId) => {
                if (live()) this.onRelayDropped(agentId);
            },
            onRelayListedAgent: (agentId) => {
                if (live() && this.relayDropped.delete(agentId)) this.changed();
            },
            log: this.deps.log,
        };
    }

    // -- Pairing -----------------------------------------------------------

    /**
     * Keeps the approver up while a pairing screen is open. The returned
     * end settles once the pairings it leaves unkept are cleaned up.
     */
    async beginPairing(): Promise<() => Promise<void>> {
        this.pairing++;
        await this.reload();
        let ended = false;
        return () => {
            if (ended) return Promise.resolve();
            ended = true;
            this.pairing--;
            return this.reload()
                .then(() => {
                    // No pairing screen left: an agent still not served
                    // was never saved.
                    if (this.pairing) return;
                    for (const agentId of this.joining)
                        this.pairingFailed(agentId);
                })
                .then(() => this.pairingCleanupsSettled())
                .catch(() => undefined);
        };
    }

    /**
     * The pairing of agentId failed after the code was answered (no
     * confirmation, or the vault save failed). Same as cancelPairing.
     */
    pairingFailed(agentId: string) {
        void this.cancelPairing(agentId);
    }

    /**
     * Ends a pairing that wasn't kept (cancelled, failed, its screen
     * closed, the vault locked): refuses its held requests, and the
     * approver, which owns the registration, calls an acceptance still
     * underway off and unregisters it on the claim's relay, bounded, also
     * after stop. Settles then; never rejects. Calling it again joins the
     * same cleanup; a pairing already kept is left alone.
     */
    cancelPairing(agentId: string): Promise<void> {
        const running = this.pairingCleanups.get(agentId);
        if (running) return running;
        // The vault decides: a saved record is kept (the next cache refresh
        // serves it), and so is one the vault can't tell about.
        if (this.recordSaved(agentId)) return Promise.resolve();
        this.confirmed.delete(agentId);
        this.joining.delete(agentId);
        // Also after stop: the approver this runtime last ran cleans up.
        const done = Promise.resolve(
            (this.approver ?? this.retired)?.cancelPairing?.(agentId),
        ).catch((error: unknown) =>
            this.deps.log?.("Couldn't end a pairing", error),
        );
        this.pairingCleanups.set(agentId, done);
        const refusals = [...this.requests.values()]
            .filter((t) => t.request.agentId === agentId)
            .map((t) =>
                this.refuse(
                    t,
                    RefusalReason.REFUSAL_REASON_KEY_NOT_GRANTED,
                    AgentRequestOutcome.AgentOutcomeRefused,
                ),
            );
        void Promise.all([...refusals, done])
            .finally(() => {
                if (this.pairingCleanups.get(agentId) === done)
                    this.pairingCleanups.delete(agentId);
            })
            .then(() => this.reload())
            .catch(() => undefined);
        return done;
    }

    /** The vault has the agent's record, or can't tell: keep the pairing. */
    private recordSaved(agentId: string): boolean {
        try {
            return this.deps.vault.hasAgentRecord(agentId) !== false;
        } catch {
            return true;
        }
    }

    /** A pairing cleanup is underway (see pairingCleanupsSettled). */
    get pairingCleanupsPending(): boolean {
        return this.pairingCleanups.size > 0;
    }

    /** Every pairing cleanup underway has settled. */
    pairingCleanupsSettled(): Promise<void> {
        return Promise.all(this.pairingCleanups.values()).then(() => undefined);
    }

    /** Hands held requests of agents now served on as new requests. */
    private releaseHeld() {
        for (const agentId of this.joining) {
            if (!this.isServed(agentId)) continue;
            this.joining.delete(agentId);
            for (const t of this.requests.values()) {
                if (t.state !== "held" || t.request.agentId !== agentId)
                    continue;
                // Not an outcome: the same request starts over as served.
                this.requests.delete(t.request.id);
                this.clearTimer(t.timer);
                void this.onRequest(t.request);
            }
        }
    }

    async claim(codeText: string): Promise<ClaimedPairing> {
        return (await this.ensureApprover()).claim(codeText);
    }

    /**
     * Answers the pairing code and adds the agent to the device-local
     * approvals with the keys it was sent. The agent counts as joining
     * before the approver can hear from it, so a request that comes before
     * its record is saved is held, not refused.
     */
    async accept(
        claim: ClaimedPairing,
        input: { agentName: string; keys: GrantedKeyInput[] },
    ): Promise<PairingResult> {
        if (this.stopped) throw new PairingCancelledError();
        const { agentId } = claim;
        const joins = !this.isServed(agentId);
        if (joins) this.joining.add(agentId);
        // A new attempt: an earlier confirmation or relay removal doesn't
        // count for it; one that comes during it does.
        this.confirmed.delete(agentId);
        this.relayDropped.delete(agentId);
        // cancelPairing (or stop) ends joining: the attempt is off.
        const cancelled = () =>
            this.stopped || (joins && !this.joining.has(agentId));
        try {
            const approver = await this.ensureApprover();
            if (cancelled()) throw new PairingCancelledError();
            const result = await approver.accept(claim, input);
            if (cancelled()) throw new PairingCancelledError();
            await this.updateLocal((list) => [
                ...list.filter((item) => item.agentId !== agentId),
                {
                    agentId,
                    keys: input.keys.map((key) => uint8ToBase64(key.publicKey)),
                },
            ]);
            if (cancelled()) {
                // Cancelled during the save: take it out again.
                await this.updateLocal((list) =>
                    list.filter((item) => item.agentId !== agentId),
                ).catch(() => undefined);
                throw new PairingCancelledError();
            }
            return result;
        } catch (error) {
            // The approver unregisters what it registered; this ends the
            // rest of the attempt. A late acceptance never reports success.
            if (joins) void this.cancelPairing(agentId);
            throw error;
        }
    }

    /** Resolves when the agent sends PairingConfirm. */
    async waitForConfirmation(agentId: string): Promise<void> {
        if (this.relayDropped.has(agentId))
            throw new Error("The agent was removed from the relay");
        if (this.confirmed.has(agentId)) return;
        await (await this.ensureApprover()).waitConfirmed(agentId);
    }

    /**
     * Sends the agent its new key list, then records it as what this device
     * sent, so the new grant is honoured.
     */
    async sendKeys(
        agentId: string,
        input: { agentName: string; keys: GrantedKeyInput[]; revision: number },
    ) {
        await (await this.ensureApprover()).sendKeys(agentId, input);
        await this.updateLocal((list) =>
            list.map((item) =>
                item.agentId === agentId
                    ? {
                          agentId,
                          keys: input.keys.map((key) =>
                              uint8ToBase64(key.publicKey),
                          ),
                      }
                    : item,
            ),
        );
        await this.reconcile();
        this.changed();
    }

    /**
     * Revoke on this device: stops serving the agent at once (its requests
     * and rules go), then removes it on its relay. The caller has written
     * the tombstone; the reload it causes cleans up the local approval.
     */
    async unregister(agentId: string) {
        // Still pairing (a Cancel): the pairing cleanup, with its relay.
        if (this.joining.has(agentId) || this.pairingCleanups.has(agentId))
            return this.cancelPairing(agentId);
        this.joining.delete(agentId);
        this.confirmed.delete(agentId);
        const agent = this.agents.find((item) => item.id === agentId);
        if (agent) {
            this.agents = this.agents.map((item) =>
                item.id === agentId ? { ...item, deleted: true } : item,
            );
            this.remembered.forgetAgent(agentId);
            this.approver?.refresh();
        }
        await this.endAgents((id) => id === agentId);
        await this.reconcile();
        this.changed();
        return (await this.ensureApprover()).unregister(
            agentId,
            agent ? this.relayFor(agent) : undefined,
        );
    }

    /**
     * The relay says it doesn't know the agent (missing from Ready, or a
     * Revoked frame). The relay is untrusted, so this stays a local state:
     * nothing is written to the vault and the agent isn't answered.
     */
    private onRelayDropped(agentId: string) {
        this.relayDropped.add(agentId);
        this.confirmed.delete(agentId);
        this.remembered.forgetAgent(agentId);
        void this.endAgents((id) => id === agentId).then(() =>
            this.reconcile(),
        );
        this.changed();
    }

    /** Ends the requests of matching agents as Refused, without answering. */
    private async endAgents(matches: (agentId: string) => boolean) {
        await Promise.all(
            [...this.requests.values()]
                .filter((t) => matches(t.request.agentId))
                .map((t) =>
                    this.finish(t, AgentRequestOutcome.AgentOutcomeRefused),
                ),
        );
    }

    // -- Requests ----------------------------------------------------------

    private track(request: IncomingRequest, state: RequestState): Tracked {
        const t: Tracked = {
            request,
            state,
            auto: false,
            timer: this.setTimer(
                () => {
                    const live = this.requests.get(request.id);
                    if (live === t) void this.expire(t);
                },
                Math.max(0, request.expiresAt - this.now()),
            ),
        };
        this.requests.set(request.id, t);
        return t;
    }

    /**
     * The one way a request ends: removes it, stops its timer and any
     * approval underway (which settles with error), and writes its history
     * entry. Null when it had ended already.
     */
    private end(
        t: Tracked,
        outcome: AgentRequestOutcome | null,
        credentialId = "",
        error: Error = new RequestGoneError(),
    ): Promise<void> | null {
        const id = t.request.id;
        if (this.requests.get(id) !== t) return null;
        this.requests.delete(id);
        this.clearTimer(t.timer);
        this.hideNotification(id);
        if (this.preferredId === id) this.preferredId = null;
        if (this.shownRequestId === id) this.shownRequestId = null;
        const approval = t.approval;
        t.approval = undefined;
        if (approval) {
            approval.abort.abort();
            approval.reject(error);
        }
        return outcome === null
            ? Promise.resolve()
            : this.record(t.request, outcome, credentialId);
    }

    /** end(), then shows the next request. */
    private async finish(
        t: Tracked,
        outcome: AgentRequestOutcome | null,
        credentialId = "",
        error?: Error,
    ) {
        const recorded = this.end(t, outcome, credentialId, error);
        if (!recorded) return;
        this.route();
        this.changed();
        await recorded;
    }

    /** Ends it and sends the refusal, which is also resent to repeats. */
    private async refuse(
        t: Tracked,
        refusal: RefusalReason,
        outcome: AgentRequestOutcome,
        credentialId = "",
        error?: Error,
    ) {
        const recorded = this.end(t, outcome, credentialId, error);
        if (!recorded) return;
        const answer = { refusal };
        this.keepAnswer(t.request, answer, credentialId, this.session);
        await this.transmit(t.request.id, answer);
        await recorded;
        this.route();
        this.changed();
    }

    /** Expiry: Approved when the signature may have reached the machine. */
    private async expire(t: Tracked) {
        const evidence = sentEvidence(t) ?? t.mayHaveSent;
        if (!evidence)
            return this.finish(t, AgentRequestOutcome.AgentOutcomeExpired);
        await this.finish(
            t,
            evidence.auto
                ? AgentRequestOutcome.AgentOutcomeApprovedByRule
                : AgentRequestOutcome.AgentOutcomeApproved,
            evidence.credentialId,
            new AnswerUncertainError(),
        );
    }

    /** A lock calls the approval off: the request waits for the user again. */
    private backToWaiting(t: Tracked, error: Error) {
        const approval = t.approval;
        t.mayHaveSent = sentEvidence(t) ?? t.mayHaveSent;
        t.approval = undefined;
        t.state = "waiting";
        t.auto = false;
        if (approval) {
            approval.abort.abort();
            approval.reject(error);
        }
    }

    /** Hands an answer to the approver; doesn't wait for the relay. */
    private async transmit(
        id: string,
        answer: SignAnswer,
        options?: AnswerOptions,
    ) {
        const approver = await this.ensureApprover().catch(() => null);
        if (!approver) return;
        try {
            void Promise.resolve(approver.answer(id, answer, options)).catch(
                (error: unknown) =>
                    this.deps.log?.("Answer not delivered", error),
            );
        } catch (error) {
            this.deps.log?.("Answer not delivered", error);
        }
    }

    private keepAnswer(
        request: IncomingRequest,
        answer: SignAnswer,
        credentialId: string,
        session: number,
    ) {
        const now = this.now();
        for (const [id, value] of this.answers)
            if (now - value.at > ANSWER_MEMORY_MS) this.answers.delete(id);
        this.answers.set(request.id, {
            request,
            answer,
            session,
            credentialId,
            at: now,
        });
    }

    /**
     * Whether an answer may go out again: refusals always; signatures in
     * the same unlock session, before the deadline, while the agent is
     * served and not paused or forgotten, and the key is still granted.
     */
    private answerValid(answered: Answered): boolean {
        // Invalidated for good (reconcile), even if permission comes back.
        if (this.answers.get(answered.request.id) !== answered) return false;
        if (!("signature" in answered.answer)) return true;
        if (answered.session !== this.session || !this.canSign()) return false;
        if (this.now() >= answered.request.expiresAt) return false;
        if (!this.agentUsable(answered.request.agentId)) return false;
        const key = this.grantFor(answered.request);
        return (
            key !== null &&
            key !== "locked" &&
            key.credentialId === answered.credentialId
        );
    }

    /** A repeat: the earlier answer goes out again if it still may. */
    private resend(answered: Answered) {
        if (!this.answerValid(answered)) {
            this.answers.delete(answered.request.id);
            return;
        }
        void this.transmit(answered.request.id, answered.answer, {
            beforeSend: () => this.answerValid(answered),
        });
    }

    /**
     * After grants, pause or serving changed: stored signatures no longer
     * allowed are dropped for good (a resume or regrant doesn't bring them
     * back), and requests whose key isn't granted any more are refused,
     * also ones being approved (their signer and delivery are aborted).
     */
    private async reconcile() {
        for (const answered of this.answers.values())
            if (!this.answerValid(answered))
                this.answers.delete(answered.request.id);
        const refusals: Promise<void>[] = [];
        for (const t of this.requests.values()) {
            if (t.state === "new" || t.state === "held") continue;
            const key = this.grantFor(t.request);
            if (key === "locked") continue;
            const credentialId = t.approval?.credentialId;
            if (
                key === null ||
                (credentialId !== undefined &&
                    key.credentialId !== credentialId)
            )
                refusals.push(
                    this.refuse(
                        t,
                        RefusalReason.REFUSAL_REASON_KEY_NOT_GRANTED,
                        AgentRequestOutcome.AgentOutcomeRefused,
                        credentialId ?? "",
                    ),
                );
        }
        await Promise.all(refusals);
    }

    private async record(
        request: IncomingRequest,
        outcome: AgentRequestOutcome,
        credentialId = "",
    ) {
        const entry = historyEntry(request, outcome, credentialId, this.now());
        const saved = await this.deps.vault
            .appendHistory(request.agentId, entry)
            .catch(() => false);
        if (!saved) this.queueHistory([{ agentId: request.agentId, entry }]);
    }

    /**
     * Keeps history for the next unlock within what the vault would keep
     * (per agent the newest 200 of the last 90 days) and MAX_QUEUED_HISTORY
     * in all, so requests while locked can't grow memory without bound.
     */
    private queueHistory(
        items: { agentId: string; entry: AgentRequestRecord }[],
    ) {
        const cutoff = this.now() - CONNECTED_AGENT_HISTORY_MAX_AGE_MS;
        const perAgent = new Map<string, number>();
        this.queuedHistory = [...this.queuedHistory, ...items]
            .filter((item) => item.entry.Timestamp >= cutoff)
            .sort((a, b) => b.entry.Timestamp - a.entry.Timestamp)
            .filter((item) => {
                const count = perAgent.get(item.agentId) ?? 0;
                perAgent.set(item.agentId, count + 1);
                return count < CONNECTED_AGENT_HISTORY_MAX_ENTRIES;
            })
            .slice(0, MAX_QUEUED_HISTORY)
            .reverse();
    }

    async onRequest(request: IncomingRequest): Promise<void> {
        if (this.stopped) return;
        // A repeat after a reconnect: never ask twice.
        if (this.requests.has(request.id)) return;
        const earlier = this.answers.get(request.id);
        if (earlier) return this.resend(earlier);
        const { agentId } = request;
        if (this.relayDropped.has(agentId)) {
            // Don't answer an agent the relay says it doesn't know.
            this.deps.log?.(
                "Ignored a request from an agent the relay dropped",
            );
            return;
        }
        if (this.joining.has(agentId) && !this.isServed(agentId)) {
            // Confirmed, but its record isn't saved yet: wait for it.
            this.track(request, "held");
            return;
        }
        const t = this.track(request, "new");
        const refused = (refusal: RefusalReason) =>
            this.refuse(t, refusal, AgentRequestOutcome.AgentOutcomeRefused);
        // Neither served nor joining (a pairing that failed, say).
        if (!this.isServed(agentId))
            return refused(RefusalReason.REFUSAL_REASON_KEY_NOT_GRANTED);
        if (this.isPaused(agentId))
            return refused(RefusalReason.REFUSAL_REASON_DENIED);
        if (request.check.kind === "other")
            return refused(RefusalReason.REFUSAL_REASON_UNSUPPORTED);
        const waiting = this.pendingRequests().filter(
            (item) => item.agentId === agentId,
        ).length;
        if (waiting >= MAX_PROMPTS_PER_AGENT)
            return refused(RefusalReason.REFUSAL_REASON_DENIED);
        const key = this.grantFor(request);
        if (key === null)
            return refused(RefusalReason.REFUSAL_REASON_KEY_NOT_GRANTED);
        if (
            key !== "locked" &&
            this.canSign() &&
            this.remembered.matches(request, key.credentialId)
        ) {
            // Tracked like any other: pause, expiry, withdrawal and stop end
            // it, and a lock sends it back to waiting (with a prompt).
            t.auto = true;
            await this.startApproval(t, key, "once").catch((error: unknown) =>
                this.deps.log?.("Remembered approval didn't go out", error),
            );
            return;
        }
        t.state = "waiting";
        this.route();
        this.changed();
    }

    private hideNotification(id: string) {
        this.notified.delete(id);
        this.deps.ui.cancelNotification(id);
    }

    /**
     * Shows the oldest waiting request: the approval screen while unlocked in
     * the foreground, otherwise one notification per agent.
     */
    route() {
        const requests = this.pendingRequests();
        const unlocked = this.canSign();
        if (unlocked && this.deps.ui.isForeground()) {
            const next = this.nextRequest();
            const opening =
                this.opening !== null &&
                !!this.getRequest(this.opening.id) &&
                this.now() - this.opening.at < SCREEN_OPEN_GRACE_MS;
            if (next && !this.screenMounted && !opening) this.open(next.id);
            for (const request of requests) this.hideNotification(request.id);
            return;
        }
        const shownAgents = new Set<string>();
        for (const request of requests) {
            if (shownAgents.has(request.agentId)) {
                this.hideNotification(request.id);
                continue;
            }
            shownAgents.add(request.agentId);
            if (
                request.id === this.preferredId &&
                this.deps.ui.showsUnlock?.()
            ) {
                this.hideNotification(request.id);
                continue;
            }
            if (this.notified.get(request.id) === !unlocked) continue;
            this.notified.set(request.id, !unlocked);
            this.deps.ui.showNotification(
                request.id,
                this.agentName(request.agentId),
                !unlocked,
            );
        }
    }

    /** After unlock: refuse requests for keys no longer granted, then route. */
    async onVaultUnlocked() {
        if (this.locking) {
            // In case clearing failed while the lock started.
            try {
                this.remembered.clear();
            } catch (error) {
                this.deps.log?.("Couldn't clear remembered approvals", error);
            }
        }
        this.locking = false;
        for (const t of this.requests.values()) {
            if (t.state !== "waiting") continue;
            if (this.grantFor(t.request) === null)
                await this.refuse(
                    t,
                    RefusalReason.REFUSAL_REASON_KEY_NOT_GRANTED,
                    AgentRequestOutcome.AgentOutcomeRefused,
                );
        }
        await this.flushHistory();
        // Online Services is signed in again: renew the hosted relay pass.
        this.approver?.refresh();
        this.route();
        this.changed();
    }

    /** Writes history entries recorded while the vault was locked. */
    async flushHistory() {
        const queued = this.queuedHistory;
        this.queuedHistory = [];
        const byAgent = new Map<string, AgentRequestRecord[]>();
        for (const item of queued)
            byAgent.set(item.agentId, [
                ...(byAgent.get(item.agentId) ?? []),
                item.entry,
            ]);
        const failed: { agentId: string; entry: AgentRequestRecord }[] = [];
        const { vault } = this.deps;
        for (const [agentId, entries] of byAgent) {
            const saved = await vault
                .appendHistoryEntries(agentId, entries)
                .catch(() => false);
            if (!saved)
                failed.push(...entries.map((entry) => ({ agentId, entry })));
        }
        if (failed.length) this.queueHistory(failed);
    }

    /**
     * Signs and sends: resolves once the relay took the signature. Rejects
     * with VaultLockedError when a lock called it off (the request waits
     * again), RequestGoneError when it ended otherwise (denied, paused,
     * expired, withdrawn), AnswerUncertainError when it expired with the
     * signature possibly delivered, or the signer's error (refused then).
     */
    private startApproval(
        t: Tracked,
        key: GrantedKey,
        choice: RememberChoice,
    ): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            const approval: Approval = {
                session: this.session,
                credentialId: key.credentialId,
                choice,
                abort: new AbortController(),
                progress: { inFlight: false, uncertain: false },
                resolve,
                reject,
            };
            t.approval = approval;
            t.state = "signing";
            this.changed();
            void this.drive(t, approval, key);
        });
    }

    /** What stops an approval from releasing its signature now, if anything. */
    private blocked(
        t: Tracked,
        approval: Approval,
    ): "locked" | "expired" | "refused" | null {
        if (approval.session !== this.session || !this.canSign())
            return "locked";
        if (this.now() >= t.request.expiresAt) return "expired";
        if (!this.agentUsable(t.request.agentId)) return "refused";
        const key = this.grantFor(t.request);
        if (key === "locked") return "locked";
        if (!key || key.credentialId !== approval.credentialId)
            return "refused";
        return null;
    }

    private stopApproval(
        t: Tracked,
        approval: Approval,
        reason: "locked" | "expired" | "refused",
    ) {
        if (reason === "locked") {
            this.backToWaiting(t, new VaultLockedError());
            this.route();
            this.changed();
            return;
        }
        if (reason === "expired") return void this.expire(t);
        void this.refuse(
            t,
            this.isPaused(t.request.agentId)
                ? RefusalReason.REFUSAL_REASON_DENIED
                : RefusalReason.REFUSAL_REASON_KEY_NOT_GRANTED,
            AgentRequestOutcome.AgentOutcomeRefused,
            approval.credentialId,
        );
    }

    private async drive(t: Tracked, approval: Approval, key: GrantedKey) {
        const { request } = t;
        // Every step checks that nothing ended or replaced this approval.
        const current = () =>
            t.approval === approval && this.requests.get(request.id) === t;
        const started = this.now();
        let signature: Uint8Array;
        try {
            signature = await this.deps.sign(
                key.sshKey,
                request.sign.publicKey,
                request.sign.data,
                request.sign.flags,
                { signal: approval.abort.signal },
            );
        } catch (error) {
            if (!current()) return;
            const reason = this.blocked(t, approval);
            if (reason) return this.stopApproval(t, approval, reason);
            this.deps.log?.("Signing failed", error);
            await this.refuse(
                t,
                RefusalReason.REFUSAL_REASON_UNSUPPORTED,
                AgentRequestOutcome.AgentOutcomeRefused,
                approval.credentialId,
                error as Error,
            );
            return;
        }
        if (!current()) return;
        const reason = this.blocked(t, approval);
        if (reason) return this.stopApproval(t, approval, reason);
        // Shown in Diagnostics; RSA signing speed varies a lot between phones.
        this.deps.log?.("Signed a request", {
            ms: this.now() - started,
            flags: request.sign.flags,
        });
        t.state = "sending";
        this.changed();
        const answer = { signature };
        try {
            const approver = await this.ensureApprover();
            if (!current()) return;
            await approver.answer(request.id, answer, {
                signal: approval.abort.signal,
                beforeSend: () => current() && !this.blocked(t, approval),
                progress: approval.progress,
            });
        } catch (error) {
            if (!current()) return;
            if (error instanceof AnswerCancelledError)
                return this.stopApproval(
                    t,
                    approval,
                    this.blocked(t, approval) ?? "locked",
                );
            if (error instanceof RequestGoneError) return void this.expire(t);
            // The approver stopped (or failed to start): the runtime is
            // going down with it.
            this.deps.log?.("Signature not delivered", error);
            if (!(error instanceof ApproverStoppedError))
                return void this.expire(t);
            return void this.finish(t, null);
        }
        // Denied, paused or expired while it was on its way: that stands.
        if (!current()) return;
        this.keepAnswer(
            request,
            answer,
            approval.credentialId,
            approval.session,
        );
        // Rules belong to the unlock session they were made in.
        if (!t.auto && !this.blocked(t, approval))
            this.remembered.add(
                request,
                approval.credentialId,
                approval.choice,
            );
        t.approval = undefined;
        const recorded = this.end(
            t,
            t.auto
                ? AgentRequestOutcome.AgentOutcomeApprovedByRule
                : AgentRequestOutcome.AgentOutcomeApproved,
            approval.credentialId,
        );
        approval.resolve();
        await recorded;
        this.route();
        this.changed();
    }

    async approve(id: string, choice: RememberChoice = "once"): Promise<void> {
        const t = this.requests.get(id);
        if (!t || !this.visible(t)) throw new RequestGoneError();
        // Approve again while the first one waits for the relay: no.
        if (t.state !== "waiting") throw new ApprovalInProgressError();
        // Its expiry timer can run late (timers in hidden browser tabs fire
        // up to a minute late); the agent has given up on it by now.
        if (t.request.expiresAt <= this.now()) {
            await this.expire(t);
            throw new RequestGoneError();
        }
        if (!this.canSign()) throw new VaultLockedError();
        const key = this.grantFor(t.request);
        if (key === "locked") throw new VaultLockedError();
        if (!key)
            return this.refuse(
                t,
                RefusalReason.REFUSAL_REASON_KEY_NOT_GRANTED,
                AgentRequestOutcome.AgentOutcomeRefused,
            );
        return this.startApproval(t, key, choice);
    }

    /** Works while locked (from the notification). */
    async deny(id: string): Promise<void> {
        const t = this.requests.get(id);
        if (!t || !this.visible(t)) return;
        await this.refuse(
            t,
            RefusalReason.REFUSAL_REASON_DENIED,
            AgentRequestOutcome.AgentOutcomeDenied,
            this.keyFor(t.request)?.credentialId ?? "",
        );
    }
}
