import { ed25519 } from "@noble/curves/ed25519.js";
import { equalBytes } from "@noble/curves/utils.js";
import { base64UrlToUint8, uint8ToBase64Url } from "../encoding";
import {
    RefusalReason,
    Role,
    Status,
    type Envelope,
    type EnvelopeHeader,
    type PairingCode,
    type PairingOffer,
    type ServerFrame,
    type SignRequest,
} from "../proto/agent";
import type {
    ApproverHost,
    ClaimedPairing,
    GrantedKeyInput,
    PairingResult,
    RelayTarget,
    SignAnswer,
} from "./approver-types";
import {
    CLOCK_SKEW_MS,
    identityPeer,
    MAX_RETAIN_LIFETIME_MS,
    openEnvelope,
    parseEnvelopeHeader,
    REQUEST_LIFETIME_MS,
    sealEnvelope,
    sealPairingAccept,
    type AgentPeer,
} from "./envelope";
import {
    confirmationCode,
    parsePairingCode,
    parsePairingOffer,
} from "./pairing";
import {
    Backoff,
    HOSTED_RELAY_URL,
    isStatus,
    normalizeRelayUrl,
    RelaySession,
    RelayStatusError,
    revocationPublicKey,
    type RelayConnection,
} from "./relay-client";
import {
    checkSignRequest,
    InvalidRequestError,
    weakRsaRequest,
} from "./request-check";

/**
 * The approving side of cryptex-agent, platform neutral: pairing, sign
 * requests and key updates over one relay connection per relay. The host
 * app owns storage, UI, signing and remembered approvals. Behaves like
 * services/internal/agent/approvertest, which is the reference.
 */

/** How long a user-facing call waits for the relay connection. */
const CONNECT_WAIT_MS = 15_000;
/**
 * Unanswered requests per agent. More are refused without asking, so a
 * flood from a compromised machine can't bury the user in prompts.
 */
export const MAX_PENDING_PER_AGENT = 8;

/**
 * The pairing code names a relay this device has no settings for. relayUrl
 * is the relay's normalized URL, path included, for the settings form.
 */
export class UnknownRelayError extends Error {
    constructor(readonly relayUrl: string) {
        super(unknownRelayText(relayUrl));
    }
}

/**
 * claim(): the relay refused this device. On a self-hosted relay the saved
 * access token is wrong; on the hosted relay, the relay pass. The token is
 * not kept here.
 */
export class RelayRefusedError extends Error {
    constructor(readonly relay: { kind: RelayTarget["kind"]; url: string }) {
        super(`The relay at ${relay.url} refused this device`);
    }
}

/**
 * Neutral wording for a pairing code that names an unknown relay: the code
 * may be crafted, so nothing suggests the user owes it a token.
 */
export function unknownRelayText(relayUrl: string, device = "device") {
    const host = relayUrlHost(relayUrl);
    return `This code uses a relay at ${host} that this ${device} doesn't know.`;
}

/** The host[:port] of a relay URL, or the text itself when it has none. */
export function relayUrlHost(relayUrl: string) {
    return /^[a-z]+:\/\/([^/?#]+)/i.exec(relayUrl)?.[1] ?? relayUrl;
}

/** accept(): the pairing was cancelled before the agent was registered. */
export class PairingCancelledError extends Error {
    constructor() {
        super("The pairing was cancelled.");
    }
}

/** The claim ran out (3 minutes) or was never made on this approver. */
export class PairingExpiredError extends Error {
    constructor() {
        super("The pairing code expired. Run cryptex-agent pair again.");
    }
}

/** answer() for a request that expired, was withdrawn or already answered. */
export class RequestGoneError extends Error {
    constructor() {
        super("This request is no longer waiting for an answer.");
    }
}

/**
 * answer(): options.signal aborted, or options.beforeSend said no, before
 * the answer went out. Nothing was sent; the host decides what the
 * request does next.
 */
export class AnswerCancelledError extends Error {
    constructor() {
        super("The answer was withdrawn before it was sent.");
    }
}

/** answer(): the approver stopped. */
export class ApproverStoppedError extends Error {
    constructor() {
        super("The approver stopped");
    }
}

export type ApproverOptions = {
    /** Reconnect schedule; tests shorten it. */
    backoff?: () => Backoff;
};

type KnownAgent = {
    id: string;
    peer: AgentPeer;
    relay: RelayTarget;
    grantedKeys?: Uint8Array[];
};

type Claim = {
    code: PairingCode;
    offer: PairingOffer;
    relay: RelayTarget;
    expiresAt: number;
};

/** A sign request onRequest reported, kept to seal answers and spot repeats. */
type OpenRequest = {
    id: string;
    agent: KnownAgent;
    header: EnvelopeHeader;
    /** An answer went out (the relay took it). */
    answered: boolean;
    /** The approver refused it itself (invalid, not granted, too many). */
    own?: SignAnswer;
    /** When it can be forgotten. */
    forgetAt: number;
};

/**
 * What answer() reports while it delivers, so the host can tell an answer
 * that may have reached the agent (sent, but the relay's Result never
 * came) from one that never left.
 */
export type DeliveryProgress = {
    /** conn.send is running now: the envelope is on its way. */
    inFlight: boolean;
    /** A send failed in a way that leaves open whether it arrived. */
    uncertain: boolean;
    /**
     * The relay took it (its Result was OK). Set before inFlight clears,
     * so there is no moment when a delivered answer looks unsent.
     */
    delivered?: boolean;
};

/**
 * answer(): signal withdraws the answer (AnswerCancelledError) until it is
 * on its way; beforeSend is checked right before every attempt.
 */
export type AnswerOptions = {
    signal?: AbortSignal;
    beforeSend?: () => boolean;
    progress?: DeliveryProgress;
};

/** How long to wait before another send after the relay refused one. */
const RESEND_PAUSE_MS = 1_000;
/** Default bound for unregistering a pairing that wasn't kept. */
export const PAIRING_CLEANUP_MS = 5_000;

/**
 * A pairing this approver registered (or is registering) that the host
 * hasn't kept yet (listed in host.agents()). The approver owns the
 * registration: it unregisters it when the pairing fails or is cancelled,
 * through the relay the claim named, also after stop().
 */
type Pairing = {
    relay: RelayTarget;
    agentKey: Uint8Array;
    abort: AbortController;
    /** RegisterAgent has gone out. */
    registered: boolean;
    /** accept() is still running; it cleans up itself when it fails. */
    accepting: Promise<unknown> | null;
    cleanup: Promise<void> | null;
};

type RelayEntry = {
    target: RelayTarget;
    session: RelaySession;
    /** The pass presented or renewed last, and its expiry (unix ms). */
    pass: string | null;
    passExpiresAt: number;
};

type ConfirmWaiter = {
    resolve: () => void;
    reject: (error: Error) => void;
};

const idOf = (key: Uint8Array) => uint8ToBase64Url(key);

export class Approver {
    private running = false;
    private readonly relays = new Map<string, RelayEntry>();
    private readonly claims = new Map<string, Claim>();
    /** Relays of claim() calls still connecting, kept through a refresh(). */
    private readonly claiming = new Set<{ relay: RelayTarget }>();
    /** Accepted agents the host may not list yet. */
    private readonly paired = new Map<string, KnownAgent>();
    private readonly confirmed = new Set<string>();
    private readonly confirmWaiters = new Map<string, ConfirmWaiter[]>();
    /** Request IDs already opened, until they expire. */
    private readonly seen = new Map<string, number>();
    private readonly requests = new Map<string, OpenRequest>();
    private readonly pairings = new Map<string, Pairing>();
    /** Aborted by stop(): deliveries give up. */
    private stopping = new AbortController();

    constructor(
        private readonly host: ApproverHost,
        private readonly options: ApproverOptions = {},
    ) {}

    private now(): number {
        return this.host.now?.() ?? Date.now();
    }

    private log(message: string, detail?: unknown): void {
        this.host.log?.(message, detail);
    }

    // -----------------------------------------------------------------------
    // Lifecycle

    start(): void {
        if (this.running) return;
        this.running = true;
        this.stopping = new AbortController();
        this.refresh();
    }

    stop(): void {
        this.running = false;
        this.stopping.abort();
        // An accept still running fails and cleans up after itself;
        // cleanups keep their relay connection until they settle. Accepted
        // pairings stay registered: the host decides about them.
        for (const pairing of this.pairings.values())
            if (pairing.accepting) pairing.abort.abort();
        this.closeUnusedRelays();
        this.requests.clear();
        const stopped = new ApproverStoppedError();
        for (const waiters of this.confirmWaiters.values()) {
            for (const w of waiters) w.reject(stopped);
        }
        this.confirmWaiters.clear();
    }

    /**
     * Re-reads host.relays() and host.agents(): connects to new relays,
     * drops unused ones, retries disconnected ones now, and hands the
     * hosted relay a newer pass if the host has one.
     */
    refresh(): void {
        if (!this.running) return;
        const now = this.now();
        for (const [id, claim] of this.claims) {
            if (claim.expiresAt <= now) this.claims.delete(id);
        }
        const listed = new Set(this.host.agents().map((a) => a.id));
        for (const id of this.paired.keys()) {
            if (listed.has(id)) this.paired.delete(id);
        }
        // Kept by the host: no longer a pairing to clean up.
        for (const [id, pairing] of this.pairings)
            if (listed.has(id) && !pairing.accepting && !pairing.cleanup)
                this.pairings.delete(id);
        const wanted = new Map<string, RelayTarget>();
        const want = (target: RelayTarget) => {
            try {
                const key = normalizeRelayUrl(target.url);
                if (!wanted.has(key)) wanted.set(key, target);
            } catch (error) {
                this.log("Skipping a relay with an unusable URL", {
                    url: target.url,
                    error,
                });
            }
        };
        this.host.relays().forEach(want);
        this.host.agents().forEach((a) => want(a.relay));
        this.claims.forEach((c) => want(c.relay));
        this.claiming.forEach((c) => want(c.relay));
        this.paired.forEach((a) => want(a.relay));
        this.pairings.forEach((pairing) => want(pairing.relay));

        for (const [key, entry] of this.relays) {
            if (!wanted.has(key)) {
                entry.session.stop();
                this.relays.delete(key);
            }
        }
        for (const [key, target] of wanted) {
            const entry = this.relays.get(key);
            if (!entry) {
                this.openRelay(key, target);
                continue;
            }
            entry.target = target;
            const conn = entry.session.connection;
            if (!conn) entry.session.retryNow();
            else if (target.kind === "hosted") void this.renewPass(entry, conn);
        }
    }

    /**
     * key: the relay's normalized URL with its base path, so two relays on
     * one host stay apart. Signatures still cover scheme and host only.
     */
    private openRelay(key: string, target: RelayTarget): RelayEntry {
        const entry: RelayEntry = {
            target,
            pass: null,
            passExpiresAt: 0,
            session: undefined as unknown as RelaySession,
        };
        entry.session = new RelaySession({
            relayUrl: target.url,
            identity: this.host.identity,
            openWebSocket: this.host.openWebSocket,
            backoff: this.options.backoff?.(),
            credentials: async () => {
                if (entry.target.kind === "custom") {
                    return {
                        role: Role.ROLE_APPROVER,
                        token: entry.target.token,
                    };
                }
                const pass = await this.host.getPass(entry.target);
                if (!pass)
                    throw new Error(
                        "No relay pass yet; unlock the vault to get one",
                    );
                entry.pass = pass;
                entry.passExpiresAt = passExpiry(pass);
                return { role: Role.ROLE_APPROVER, pass };
            },
            onConnected: (conn) => this.connected(key, entry, conn),
            onFrame: (conn, frame) => this.handleFrame(conn, frame),
            onDisconnected: (error) =>
                this.log("Relay connection ended", {
                    relay: key,
                    error: error.message,
                }),
        });
        this.relays.set(key, entry);
        entry.session.start();
        return entry;
    }

    private connected(
        key: string,
        entry: RelayEntry,
        conn: RelayConnection,
    ): void {
        if (conn.ready.passExpiresAt > 0) {
            entry.passExpiresAt = Math.max(
                entry.passExpiresAt,
                conn.ready.passExpiresAt,
            );
        }
        // Agents removed while this device was offline (revoked from another
        // device, or the agent unpaired itself) are missing from Ready. So
        // are all of them when the relay lost its database; the host keeps
        // that as a local state.
        const registered = new Set(conn.ready.agents.map(idOf));
        for (const agent of this.host.agents()) {
            if (this.keyOf(agent.relay) !== key) continue;
            if (registered.has(agent.id))
                this.host.onRelayListedAgent?.(agent.id);
            else this.revoked(agent.id);
        }
        // Answers waiting for this connection go out from deliver().
    }

    private async renewPass(
        entry: RelayEntry,
        conn: RelayConnection,
    ): Promise<void> {
        try {
            const pass = await this.host.getPass(entry.target);
            if (!pass || pass === entry.pass) return;
            const expires = passExpiry(pass);
            // Unreadable expiry: hand it over anyway, the relay decides.
            if (expires !== 0 && expires <= entry.passExpiresAt) return;
            await conn.renewPass(pass);
            entry.pass = pass;
            entry.passExpiresAt = expires;
        } catch (error) {
            this.log("Couldn't renew the relay pass", error);
        }
    }

    /** The relay's normalized URL, path included; null when unusable. */
    private keyOf(target: RelayTarget): string | null {
        try {
            return normalizeRelayUrl(target.url);
        } catch {
            return null;
        }
    }

    /** evenStopped: for pairing cleanups, which run also after stop(). */
    private relayFor(target: RelayTarget, evenStopped = false): RelayEntry {
        const key = normalizeRelayUrl(target.url);
        const entry = this.relays.get(key);
        if (entry) return entry;
        if (!this.running && !evenStopped)
            throw new Error("The approver isn't running");
        return this.openRelay(key, target);
    }

    private connection(target: RelayTarget): Promise<RelayConnection> {
        return this.relayFor(target).session.waitConnected(
            CONNECT_WAIT_MS,
            true,
        );
    }

    // -----------------------------------------------------------------------
    // Pairing

    /**
     * Claims the slot a scanned or pasted code names. The agent's terminal
     * then says "Code received"; the user has 3 minutes to accept().
     */
    async claim(codeText: string): Promise<ClaimedPairing> {
        const code = parsePairingCode(codeText);
        const relay = this.targetFor(code.relayUrl);
        // A first claim on the hosted relay saves a new pass, and the vault
        // change refreshes the approver before the claim is recorded below.
        const inFlight = { relay };
        this.claiming.add(inFlight);
        let claimed = false;
        try {
            const conn = await this.connection(relay).catch(
                (error: unknown) => {
                    if (isStatus(error, Status.STATUS_UNAUTHORIZED))
                        throw new RelayRefusedError({
                            kind: relay.kind,
                            url: relay.url,
                        });
                    throw error;
                },
            );
            const slot = await conn.claimSlot(code.slotId);
            const offer = parsePairingOffer(slot.offer, code.offerHash);
            const agentId = idOf(offer.signPublicKey);
            this.claims.set(agentId, {
                code,
                offer,
                relay,
                expiresAt: slot.expiresAt,
            });
            claimed = true;
            return { relay, offer, agentId, expiresAt: slot.expiresAt };
        } finally {
            this.claiming.delete(inFlight);
            // A failed claim leaves nothing that needs its relay.
            if (!claimed) this.refresh();
        }
    }

    private targetFor(relayUrl: string): RelayTarget {
        const key = normalizeRelayUrl(relayUrl);
        const known = [
            ...this.host.relays(),
            ...this.host.agents().map((a) => a.relay),
        ];
        const match = known.find((t) => this.keyOf(t) === key);
        if (match) return match;
        // The hosted relay this app is configured with, known before the
        // first agent pairs on it (and authenticated with a relay pass).
        const hosted = normalizeRelayUrl(
            this.host.hostedRelayUrl || HOSTED_RELAY_URL,
        );
        if (key === hosted) return { kind: "hosted", url: hosted };
        throw new UnknownRelayError(key);
    }

    /**
     * Registers the claimed agent with a fresh revocation key and answers its
     * code. Show the confirmation code; the pairing is done only when
     * waitConfirmed resolves (host.onAgentConfirmed fires too).
     */
    async accept(
        claim: ClaimedPairing,
        input: { agentName: string; keys: GrantedKeyInput[] },
    ): Promise<PairingResult> {
        if (!this.running) throw new ApproverStoppedError();
        const c = this.claims.get(claim.agentId);
        if (!c || c.expiresAt <= this.now()) {
            this.claims.delete(claim.agentId);
            throw new PairingExpiredError();
        }
        const agentKey = c.offer.signPublicKey;
        // The claim's relay, captured before RegisterAgent: the cleanup
        // reaches the agent there whatever happens afterwards.
        const pairing: Pairing = {
            relay: c.relay,
            agentKey,
            abort: new AbortController(),
            registered: false,
            accepting: null,
            cleanup: null,
        };
        this.pairings.set(claim.agentId, pairing);
        const run = this.acceptPairing(claim, input, c, pairing);
        pairing.accepting = run.catch(() => undefined);
        try {
            return await run;
        } catch (error) {
            this.paired.delete(claim.agentId);
            // The one owner of this registration: unregister it here.
            if (pairing.registered)
                void this.cleanupPairing(claim.agentId, pairing);
            else if (this.pairings.get(claim.agentId) === pairing)
                this.pairings.delete(claim.agentId);
            throw pairing.abort.signal.aborted
                ? new PairingCancelledError()
                : error;
        } finally {
            pairing.accepting = null;
            // Stopped meanwhile: release connections nobody needs now.
            if (!this.running) this.closeUnusedRelays();
        }
    }

    private async acceptPairing(
        claim: ClaimedPairing,
        input: { agentName: string; keys: GrantedKeyInput[] },
        c: Claim,
        pairing: Pairing,
    ): Promise<PairingResult> {
        const { signal } = pairing.abort;
        // Cancelled or stopped: settles at once, even while a call to the
        // relay is still waiting for its Result.
        const step = <T>(promise: Promise<T>) =>
            new Promise<T>((resolve, reject) => {
                const aborted = () => reject(new PairingCancelledError());
                if (signal.aborted) return aborted();
                signal.addEventListener("abort", aborted, { once: true });
                promise
                    .then(resolve, reject)
                    .finally(() =>
                        signal.removeEventListener("abort", aborted),
                    );
            });
        const conn = await step(this.connection(c.relay));
        const revocationSeed = ed25519.utils.randomSecretKey();
        const me = identityPeer(this.host.identity);
        const peer = {
            signPublicKey: pairing.agentKey,
            kemPublicKey: c.offer.kemPublicKey,
        };
        const keysRevision = 1;
        // Sealed before registering: a KEM key that only passes the length
        // check throws here, and leaves no registration on the relay.
        const envelope = sealPairingAccept(
            this.host.identity,
            peer,
            { secret: c.code.secret, offerHash: c.code.offerHash },
            {
                approverSignPublicKey: me.signPublicKey,
                approverKemPublicKey: me.kemPublicKey,
                approverName: this.host.deviceName,
                agentName: input.agentName,
                keys: input.keys.map((k) => ({
                    publicKey: k.publicKey,
                    comment: k.comment,
                })),
                keysRevision,
                relayToken: c.relay.kind === "custom" ? c.relay.token : "",
            },
            this.now() + REQUEST_LIFETIME_MS,
        );
        // Checked right before RegisterAgent goes out: cancelled or
        // stopped earlier, nothing is registered.
        if (signal.aborted || !this.running) throw new PairingCancelledError();
        pairing.registered = true;
        await step(
            conn.registerAgent(
                pairing.agentKey,
                revocationPublicKey(revocationSeed),
            ),
        );
        // Known before the answer goes out: the agent's PairingConfirm can
        // arrive before the host has stored the agent.
        this.paired.set(claim.agentId, {
            id: claim.agentId,
            peer,
            relay: c.relay,
            grantedKeys: input.keys.map((k) => k.publicKey),
        });
        await step(conn.answerSlot(c.code.slotId, envelope));
        this.claims.delete(claim.agentId);
        return {
            confirmationCode: confirmationCode(
                c.code.offerHash,
                me.signPublicKey,
                me.kemPublicKey,
            ),
            revocationSeed,
            keysRevision,
        };
    }

    /**
     * Ends a pairing the host didn't keep (cancelled, failed, the screen
     * closed): an accept still running is called off, and the registration
     * is unregistered through the claim's relay, bounded by
     * host.pairingCleanupMs, also after stop(). Settles then; never
     * rejects. Again for the same agent joins the same cleanup.
     */
    async cancelPairing(agentId: string): Promise<void> {
        this.paired.delete(agentId);
        this.confirmed.delete(agentId);
        this.claims.delete(agentId);
        for (const w of this.takeWaiters(agentId))
            w.reject(new Error("The pairing failed"));
        const pairing = this.pairings.get(agentId);
        if (!pairing) return;
        pairing.abort.abort();
        // A running accept starts the cleanup itself when it fails.
        if (pairing.accepting) await pairing.accepting;
        if (pairing.cleanup) return pairing.cleanup;
        if (pairing.registered) return this.cleanupPairing(agentId, pairing);
        if (this.pairings.get(agentId) === pairing)
            this.pairings.delete(agentId);
    }

    private cleanupPairing(agentId: string, pairing: Pairing): Promise<void> {
        pairing.cleanup ??= (async () => {
            const ms = this.host.pairingCleanupMs ?? PAIRING_CLEANUP_MS;
            let timer: ReturnType<typeof setTimeout> | undefined;
            const deadline = new Promise<void>((resolve) => {
                timer = setTimeout(() => {
                    this.log("A pairing's unregister timed out");
                    resolve();
                }, ms);
            });
            const unregister = (async () => {
                // Reconnect now rather than after the backoff; the bound
                // covers the wait.
                const { session } = this.relayFor(pairing.relay, true);
                if (!session.connection) session.retryNow();
                const conn = await session.waitConnected(ms);
                try {
                    await conn.unregisterAgent(pairing.agentKey);
                } catch (error) {
                    if (!isStatus(error, Status.STATUS_NOT_FOUND)) throw error;
                }
            })().catch((error: unknown) =>
                this.log("Couldn't unregister a pairing on its relay", error),
            );
            await Promise.race([unregister, deadline]);
            clearTimeout(timer);
        })().finally(() => {
            if (this.pairings.get(agentId) === pairing)
                this.pairings.delete(agentId);
            if (!this.running) this.closeUnusedRelays();
        });
        return pairing.cleanup;
    }

    /** Stopped: closes every relay connection no pairing cleanup needs. */
    private closeUnusedRelays() {
        const needed = new Set<string>();
        for (const pairing of this.pairings.values())
            if (pairing.cleanup || pairing.accepting)
                needed.add(normalizeRelayUrl(pairing.relay.url));
        for (const [key, entry] of this.relays) {
            if (needed.has(key)) continue;
            entry.session.stop();
            this.relays.delete(key);
        }
    }

    /**
     * Resolves when the agent's PairingConfirm arrives (the user pressed
     * Enter on the machine). Rejects if the agent is revoked meanwhile (the
     * user cancelled there), on timeout, or when the approver stops.
     */
    waitConfirmed(agentId: string, timeoutMs = 10 * 60_000): Promise<void> {
        if (this.confirmed.has(agentId)) return Promise.resolve();
        return new Promise((resolve, reject) => {
            const list = this.confirmWaiters.get(agentId) ?? [];
            const timer = setTimeout(() => {
                const i = list.indexOf(waiter);
                if (i >= 0) list.splice(i, 1);
                reject(
                    new Error("The agent didn't confirm the pairing in time"),
                );
            }, timeoutMs);
            const waiter: ConfirmWaiter = {
                resolve: () => {
                    clearTimeout(timer);
                    resolve();
                },
                reject: (error) => {
                    clearTimeout(timer);
                    reject(error);
                },
            };
            list.push(waiter);
            this.confirmWaiters.set(agentId, list);
        });
    }

    // -----------------------------------------------------------------------
    // Agents

    private isListed(id: string): boolean {
        return this.host.agents().some((a) => a.id === id);
    }

    private findAgent(id: string): KnownAgent | undefined {
        const listed = this.host.agents().find((a) => a.id === id);
        if (!listed) return this.paired.get(id);
        const { signPublicKey, kemPublicKey, relay, grantedKeys } = listed;
        return {
            id,
            peer: { signPublicKey, kemPublicKey },
            relay,
            grantedKeys,
        };
    }

    private requireAgent(agentId: string): KnownAgent {
        const agent = this.findAgent(agentId);
        if (!agent) throw new Error("Unknown agent");
        return agent;
    }

    /** Replaces the agent's keys with a retained KeysUpdate. */
    async sendKeys(
        agentId: string,
        input: { agentName: string; keys: GrantedKeyInput[]; revision: number },
    ): Promise<void> {
        const agent = this.requireAgent(agentId);
        const envelope = sealEnvelope(
            this.host.identity,
            agent.peer,
            {
                body: {
                    $case: "keysUpdate",
                    keysUpdate: {
                        keys: input.keys.map((k) => ({
                            publicKey: k.publicKey,
                            comment: k.comment,
                        })),
                        revision: input.revision,
                        agentName: input.agentName,
                    },
                },
            },
            {
                // A minute under the cap, so clock skew can't push it over.
                expiresAt: this.now() + MAX_RETAIN_LIFETIME_MS - 60_000,
                retain: true,
            },
        );
        const paired = this.paired.get(agentId);
        if (paired) paired.grantedKeys = input.keys.map((k) => k.publicKey);
        const conn = await this.connection(agent.relay);
        await conn.send(envelope);
    }

    /**
     * Removes the agent on its relay; the relay tells the agent. relay is for
     * an agent the host no longer lists (its record was deleted elsewhere).
     */
    async unregister(agentId: string, relay?: RelayTarget): Promise<void> {
        const target = relay ?? this.requireAgent(agentId).relay;
        const conn = await this.connection(target);
        try {
            await conn.unregisterAgent(base64UrlToUint8(agentId));
        } catch (error) {
            if (!isStatus(error, Status.STATUS_NOT_FOUND)) throw error;
        }
    }

    private revoked(agentId: string): void {
        for (const [id, entry] of this.requests) {
            if (entry.agent.id !== agentId) continue;
            this.requests.delete(id);
            if (!entry.answered && !entry.own) this.host.onRequestGone(id);
        }
        this.paired.delete(agentId);
        this.confirmed.delete(agentId);
        for (const w of this.takeWaiters(agentId))
            w.reject(new Error("The agent was removed from the relay"));
        this.host.onRelayDroppedAgent(agentId);
    }

    // -----------------------------------------------------------------------
    // Frames

    private handleFrame(conn: RelayConnection, frame: ServerFrame): void {
        // A frame the relay client queued before stop(): nobody is listening.
        if (!this.running) return;
        switch (frame.frame?.$case) {
            case "deliver":
                if (frame.frame.deliver.envelope) {
                    this.handleDeliver(conn, frame.frame.deliver.envelope);
                }
                return;
            case "revoked":
                this.revoked(idOf(frame.frame.revoked.agentKey));
                return;
        }
    }

    private handleDeliver(conn: RelayConnection, envelope: Envelope): void {
        let header: EnvelopeHeader;
        try {
            header = parseEnvelopeHeader(envelope);
        } catch {
            return;
        }
        try {
            this.open(envelope, header);
        } finally {
            try {
                conn.ack(header.messageId);
            } catch {
                // The relay redelivers after a reconnect.
            }
        }
    }

    private open(envelope: Envelope, header: EnvelopeHeader): void {
        const now = this.now();
        this.forgetExpired(now);
        const agent = this.findAgent(idOf(header.sender));
        if (!agent) return;
        let message;
        try {
            // Open before marking the ID seen: a tampered copy that arrives
            // first must not make the genuine envelope look like a repeat.
            message = openEnvelope(
                this.host.identity,
                agent.peer,
                envelope,
                now,
            ).message;
        } catch (error) {
            this.log("Dropped an envelope that didn't open", error);
            return;
        }
        const requestId = idOf(header.messageId);
        if (this.seen.has(requestId)) {
            // The agent reconnected and resent a request: send the answer
            // given before rather than asking twice. The host decides about
            // its answers; undecided requests get theirs when it decides.
            const entry = this.requests.get(requestId);
            if (entry?.own)
                void this.deliver(entry, entry.own).catch(() => undefined);
            else if (entry) this.host.onRepeat?.(requestId);
            return;
        }
        if (
            message.body?.$case === "signRequest" &&
            !this.isListed(agent.id) &&
            !this.confirmed.has(agent.id)
        ) {
            // Before PairingConfirm the user hasn't seen the codes match.
            // Not marked seen: the agent's resend after the confirmation
            // must count as new, not as a repeat with no stored answer.
            this.log("Ignored a request from an unconfirmed agent");
            return;
        }
        this.seen.set(requestId, header.expiresAt + CLOCK_SKEW_MS);
        switch (message.body?.$case) {
            case "pairingConfirm":
                this.handleConfirm(agent.id);
                return;
            case "signRequest":
                this.handleSignRequest(
                    agent,
                    header,
                    message.body.signRequest,
                    now,
                );
                return;
        }
    }

    private handleConfirm(agentId: string): void {
        this.confirmed.add(agentId);
        for (const w of this.takeWaiters(agentId)) w.resolve();
        this.host.onAgentConfirmed(agentId);
    }

    private takeWaiters(agentId: string): ConfirmWaiter[] {
        const waiters = this.confirmWaiters.get(agentId) ?? [];
        this.confirmWaiters.delete(agentId);
        return waiters;
    }

    private handleSignRequest(
        agent: KnownAgent,
        header: EnvelopeHeader,
        sign: SignRequest,
        now: number,
    ): void {
        const id = idOf(header.messageId);
        const entry: OpenRequest = {
            id,
            agent,
            header,
            answered: false,
            forgetAt: header.expiresAt + CLOCK_SKEW_MS,
        };
        this.requests.set(id, entry);
        const refuse = (refusal: RefusalReason) => {
            entry.own = { refusal };
            void this.deliver(entry, entry.own).catch(() => undefined);
        };
        // Sign requests live 90 s; a retained one could wait for 30 days.
        if (
            header.retain ||
            header.expiresAt > now + REQUEST_LIFETIME_MS + CLOCK_SKEW_MS
        ) {
            this.log("Refused a sign request with a long lifetime");
            return refuse(RefusalReason.REFUSAL_REASON_INVALID);
        }
        let check;
        try {
            check = checkSignRequest(sign);
        } catch (error) {
            if (!(error instanceof InvalidRequestError)) throw error;
            this.log("Refused an invalid request", error.message);
            return refuse(RefusalReason.REFUSAL_REASON_INVALID);
        }
        if (weakRsaRequest(sign, check)) {
            this.log("Refused an RSA request without a SHA-2 flag");
            return refuse(RefusalReason.REFUSAL_REASON_INVALID);
        }
        if (check.kind === "other") {
            this.log(
                "Refused a request to sign data that is neither a login nor SSHSIG",
            );
            return refuse(RefusalReason.REFUSAL_REASON_INVALID);
        }
        if (
            agent.grantedKeys &&
            !agent.grantedKeys.some((k) => equalBytes(k, sign.publicKey))
        ) {
            return refuse(RefusalReason.REFUSAL_REASON_KEY_NOT_GRANTED);
        }
        const waiting = this.pendingRequests().filter(
            (other) =>
                other !== id && this.requests.get(other)?.agent.id === agent.id,
        ).length;
        if (waiting >= MAX_PENDING_PER_AGENT) {
            this.log("Refused a request: too many waiting for this agent");
            return refuse(RefusalReason.REFUSAL_REASON_DENIED);
        }
        this.host.onRequest({
            id,
            agentId: agent.id,
            receivedAt: now,
            expiresAt: header.expiresAt,
            sign,
            check,
        });
    }

    /** Requests reported to the host and not answered yet, by ID. */
    pendingRequests(): string[] {
        const now = this.now();
        return [...this.requests.values()]
            .filter(
                (entry) =>
                    !entry.answered &&
                    !entry.own &&
                    entry.header.expiresAt > now,
            )
            .map((entry) => entry.id);
    }

    /**
     * Sends an answer to a request onRequest reported: now if connected,
     * else when the relay is back. Resolves once the relay took it. Rejects
     * with RequestGoneError for an unknown request or once its deadline
     * passes (checked right before every attempt), AnswerCancelledError
     * when options.signal aborts or options.beforeSend says no, and
     * ApproverStoppedError on stop(). A send the relay refused, or whose
     * Result never came, is tried again until the deadline. The host owns
     * the request; this is transport only, so an answer can be sent again
     * (a resend to a repeated request).
     */
    async answer(
        requestId: string,
        answer: SignAnswer,
        options: AnswerOptions = {},
    ): Promise<void> {
        const entry = this.requests.get(requestId);
        if (!entry) throw new RequestGoneError();
        await this.deliver(entry, answer, options);
        entry.answered = true;
    }

    private async deliver(
        entry: OpenRequest,
        answer: SignAnswer,
        options: AnswerOptions = {},
    ): Promise<void> {
        const deadline = entry.header.expiresAt;
        const progress = options.progress ?? {
            inFlight: false,
            uncertain: false,
        };
        const stopping = this.stopping.signal;
        const envelope = sealEnvelope(
            this.host.identity,
            entry.agent.peer,
            {
                body: {
                    $case: "signResponse",
                    signResponse: {
                        result:
                            "signature" in answer
                                ? {
                                      $case: "signature",
                                      signature: answer.signature,
                                  }
                                : { $case: "refusal", refusal: answer.refusal },
                    },
                },
            },
            {
                inReplyTo: entry.header.messageId,
                expiresAt: this.now() + REQUEST_LIFETIME_MS,
            },
        );
        for (;;) {
            if (stopping.aborted || !this.running)
                throw new ApproverStoppedError();
            if (options.signal?.aborted) throw new AnswerCancelledError();
            if (this.now() >= deadline) throw new RequestGoneError();
            const session = this.relayFor(entry.agent.relay).session;
            const conn = session.connection;
            if (!conn) {
                const wait = Math.min(deadline - this.now(), CONNECT_WAIT_MS);
                const connected = await this.until(
                    session.waitConnected(wait).then(
                        () => true,
                        () => false,
                    ),
                    options.signal,
                );
                // A session that can't wait (stopped): don't spin.
                if (!connected) await this.pause(200, options.signal);
                continue;
            }
            if (options.beforeSend && !options.beforeSend())
                throw new AnswerCancelledError();
            if (this.now() >= deadline) throw new RequestGoneError();
            progress.inFlight = true;
            try {
                await conn.send(envelope);
                progress.delivered = true;
                progress.inFlight = false;
                return;
            } catch (error) {
                // Settled: no longer on its way, before any retry pause.
                progress.inFlight = false;
                const refused =
                    error instanceof RelayStatusError && !error.fatal;
                // Sent, but no Result (timeout) or the connection went:
                // the relay may have passed it on.
                if (!refused) progress.uncertain = true;
                this.log("Answer not sent yet", error);
                if (refused || session.connection === conn)
                    await this.pause(RESEND_PAUSE_MS, options.signal);
            }
        }
    }

    /** promise, or undefined once signal or stop() aborts. */
    private until<T>(
        promise: Promise<T>,
        signal?: AbortSignal,
    ): Promise<T | undefined> {
        const signals = [this.stopping.signal, signal].filter(
            (item): item is AbortSignal => !!item,
        );
        return new Promise((resolve) => {
            const done = (value: T | undefined) => {
                for (const item of signals)
                    item.removeEventListener("abort", aborted);
                resolve(value);
            };
            const aborted = () => done(undefined);
            for (const item of signals) {
                if (item.aborted) return done(undefined);
                item.addEventListener("abort", aborted);
            }
            promise.then(done, () => done(undefined));
        });
    }

    private pause(ms: number, signal?: AbortSignal): Promise<void> {
        let timer: ReturnType<typeof setTimeout> | undefined;
        return this.until(
            new Promise<void>((resolve) => {
                timer = setTimeout(resolve, ms);
            }),
            signal,
        ).then(() => clearTimeout(timer));
    }

    private forgetExpired(now: number): void {
        for (const [id, until] of this.seen)
            if (until <= now) this.seen.delete(id);
        for (const [id, entry] of this.requests)
            if (entry.forgetAt <= now) this.requests.delete(id);
    }
}

/** A relay pass's expiry in unix ms as the relay counts it, or 0 if unreadable. */
function passExpiry(pass: string): number {
    try {
        const payload = JSON.parse(
            new TextDecoder().decode(
                base64UrlToUint8(pass.split(".")[0] ?? ""),
            ),
        ) as { exp?: unknown };
        // The relay allows 30 s of clock skew past exp (relay/pass.go).
        return typeof payload.exp === "number"
            ? payload.exp * 1000 + CLOCK_SKEW_MS
            : 0;
    } catch {
        return 0;
    }
}
