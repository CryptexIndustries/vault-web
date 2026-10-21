import { ed25519 } from "@noble/curves/ed25519.js";
import {
    ClientFrame,
    Envelope,
    Ready,
    RevokeRequest,
    Role,
    ServerFrame,
    Status,
    type SlotOffer,
} from "../proto/agent";
import type { WebSocketLike } from "./approver-types";
import {
    identityId,
    MAX_ENVELOPE_SIZE,
    PROTOCOL_VERSION,
    type AgentIdentity,
} from "./envelope";
import { signRelayAuth, signRevoke } from "./pairing";

/**
 * Client side of the agent relay (agent.proto, /v1/connect and
 * /v1/revoke), over the small WebSocket interface browsers and React Native
 * share. Mirrors services/internal/relayclient.
 */

export const SUBPROTOCOL = "cryptex-agent.v1";
export const CONNECT_PATH = "/v1/connect";
export const REVOKE_PATH = "/v1/revoke";
/** The hosted relay; cryptex-agent pairs with it unless told otherwise. */
export const HOSTED_RELAY_URL = "https://relay.cryptex-vault.com";

/** The relay gives clients 10 s to authenticate. */
const HANDSHAKE_TIMEOUT_MS = 10_000;
/** A relay that never answers a call isn't one to wait for. */
const CALL_TIMEOUT_MS = 30_000;
const DEFAULT_KEEPALIVE_MS = 240_000;
/**
 * Frames waiting for next(). A relay that sends faster than the client takes
 * them gets the connection closed, rather than growing memory without bound.
 */
export const MAX_QUEUED_FRAMES = 256;
const WS_OPEN = 1;

/** A non-OK Result, or a fatal Error frame. */
export class RelayStatusError extends Error {
    constructor(
        readonly status: Status,
        readonly relayMessage: string,
        /** Error frames: the relay closes the connection afterwards. */
        readonly fatal: boolean,
    ) {
        super(
            relayMessage ||
                `relay: ${Status[status]?.replace("STATUS_", "").toLowerCase().replaceAll("_", " ") ?? status}`,
        );
    }
}

export type RelayClosedReason =
    | "closed"
    | "stale"
    | "flooded"
    | "protocol"
    | "timeout";

/** The connection ended without an Error frame. */
export class RelayClosedError extends Error {
    constructor(
        readonly reason: RelayClosedReason,
        message?: string,
    ) {
        super(message ?? `relay connection ${reason}`);
    }
}

export function isStatus(error: unknown, status: Status): boolean {
    return error instanceof RelayStatusError && error.status === status;
}

// ---------------------------------------------------------------------------
// URLs

type ParsedURL = {
    scheme: "http" | "https";
    /** Authority as written, minus nothing (userinfo is refused). */
    authority: string;
    hostname: string;
    port: string;
    path: string;
};

class RelayURLError extends Error {
    constructor(raw: string, why: string) {
        super(`${JSON.stringify(raw)} ${why}`);
    }
}

/**
 * Parses an http(s) URL the way Go's url.Parse splits it. Written out by
 * hand because React Native's URL is incomplete. Hosts with percent escapes
 * or odd characters are refused rather than guessed at.
 */
function parseHttpURL(raw: string): ParsedURL {
    let s = raw.trim();
    const hash = s.indexOf("#");
    if (hash >= 0) s = s.slice(0, hash);
    const match = /^([A-Za-z][A-Za-z0-9+.-]*):(.*)$/s.exec(s);
    const scheme = match?.[1]!.toLowerCase();
    if (!match || (scheme !== "http" && scheme !== "https")) {
        throw new RelayURLError(raw, "is not an http(s) URL");
    }
    let rest = match[2]!;
    const query = rest.indexOf("?");
    if (query >= 0) rest = rest.slice(0, query);
    if (!rest.startsWith("//")) {
        throw new RelayURLError(raw, "is not an http(s) URL");
    }
    rest = rest.slice(2);
    const slash = rest.indexOf("/");
    const authority = slash >= 0 ? rest.slice(0, slash) : rest;
    const path = slash >= 0 ? rest.slice(slash) : "";
    if (authority.includes("@")) {
        throw new RelayURLError(raw, "is not an http(s) URL");
    }
    let hostname: string;
    let portPart: string;
    if (authority.startsWith("[")) {
        const close = authority.indexOf("]");
        if (close < 0) throw new RelayURLError(raw, "has a bad IPv6 address");
        hostname = authority.slice(1, close);
        portPart = authority.slice(close + 1);
        if (canonicalIPv6(hostname.toLowerCase()) === null) {
            throw new RelayURLError(raw, "has a bad IPv6 address");
        }
    } else {
        const colon = authority.lastIndexOf(":");
        hostname = colon >= 0 ? authority.slice(0, colon) : authority;
        portPart = colon >= 0 ? authority.slice(colon) : "";
        if (/[^\x21-\x7e]/.test(hostname)) {
            throw new RelayURLError(
                raw,
                "has a non-ASCII host; use its xn-- form",
            );
        }
        if (!/^[A-Za-z0-9._~!$&'()*+,;=-]+$/.test(hostname)) {
            throw new RelayURLError(raw, "is not an http(s) URL");
        }
    }
    if (portPart !== "" && !/^:[0-9]*$/.test(portPart)) {
        throw new RelayURLError(raw, "has an invalid port");
    }
    if (hostname === "") throw new RelayURLError(raw, "is not an http(s) URL");
    return { scheme, authority, hostname, port: portPart.slice(1), path };
}

/**
 * The origin a browser reports for a URL, as serverkit.NormalizeOrigin
 * computes it. Clients sign it into Auth and revoke requests, and the relay
 * compares exactly, so the two must agree byte for byte.
 */
export function normalizeOrigin(raw: string): string {
    const u = parseHttpURL(raw);
    let host = u.hostname.toLowerCase();
    if (host.includes(":")) {
        if (canonicalIPv6(host) !== host) {
            throw new RelayURLError(raw, "has a non-canonical IP address");
        }
        host = `[${host}]`;
    } else if (/^[0-9.]*$/.test(host) && !canonicalIPv4(host)) {
        throw new RelayURLError(
            raw,
            "has an IPv4 address a browser would rewrite",
        );
    }
    let port = u.port;
    if (port !== "") {
        const n = Number(port);
        if (!Number.isInteger(n) || n < 1 || n > 65535 || String(n) !== port) {
            throw new RelayURLError(raw, "has an invalid port");
        }
    }
    if (
        (u.scheme === "https" && port === "443") ||
        (u.scheme === "http" && port === "80")
    ) {
        port = "";
    }
    return `${u.scheme}://${host}${port ? `:${port}` : ""}`;
}

/**
 * The relay URL to connect to: the normalized origin plus any base path
 * (without a trailing slash, query or fragment), as cryptex-agent keeps it.
 * Signatures cover only normalizeOrigin of it, as on the Go side.
 */
export function normalizeRelayUrl(raw: string): string {
    const origin = normalizeOrigin(raw);
    const path = parseHttpURL(raw).path.replace(/\/+$/, "");
    if (/[^\x21-\x7e]/.test(path)) {
        throw new RelayURLError(
            raw,
            "has spaces or non-ASCII text in its path",
        );
    }
    return origin + path;
}

function canonicalIPv4(host: string): boolean {
    const parts = host.split(".");
    return (
        parts.length === 4 &&
        parts.every((p) => /^(0|[1-9][0-9]{0,2})$/.test(p) && Number(p) <= 255)
    );
}

/** RFC 5952 form as netip.Addr.String prints it, or null if not IPv6. */
function canonicalIPv6(host: string): string | null {
    let groups: number[] = [];
    let v4: number[] | null = null;
    const halves = host.split("::");
    if (halves.length > 2) return null;
    const parse = (part: string, allowV4: boolean): number[] | null => {
        if (part === "") return [];
        const out: number[] = [];
        const items = part.split(":");
        for (let i = 0; i < items.length; i++) {
            const item = items[i]!;
            if (allowV4 && i === items.length - 1 && item.includes(".")) {
                if (!canonicalIPv4(item)) return null;
                v4 = item.split(".").map(Number);
                out.push((v4[0]! << 8) | v4[1]!, (v4[2]! << 8) | v4[3]!);
            } else if (/^[0-9a-f]{1,4}$/.test(item)) {
                out.push(parseInt(item, 16));
            } else {
                return null;
            }
        }
        return out;
    };
    if (halves.length === 2) {
        const head = parse(halves[0]!, false);
        const tail = parse(halves[1]!, true);
        if (!head || !tail || head.length + tail.length > 7) return null;
        groups = [
            ...head,
            ...Array.from({ length: 8 - head.length - tail.length }, () => 0),
            ...tail,
        ];
    } else {
        const all = parse(host, true);
        if (!all || all.length !== 8) return null;
        groups = all;
    }
    if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
        const a = groups[6]!;
        const b = groups[7]!;
        return `::ffff:${a >> 8}.${a & 0xff}.${b >> 8}.${b & 0xff}`;
    }
    let bestStart = -1;
    let bestLength = 1;
    for (let i = 0; i < 8; ) {
        let j = i;
        while (j < 8 && groups[j] === 0) j++;
        if (j - i > bestLength) {
            bestStart = i;
            bestLength = j - i;
        }
        i = j === i ? i + 1 : j;
    }
    const hex = groups.map((g) => g.toString(16));
    if (bestStart < 0) return hex.join(":");
    return `${hex.slice(0, bestStart).join(":")}::${hex.slice(bestStart + bestLength).join(":")}`;
}

/** Plain URL of an HTTP endpoint below the relay URL, keeping a base path. */
export function httpURL(relayUrl: string, path: string): string {
    const u = parseHttpURL(relayUrl);
    return `${u.scheme}://${u.authority}${u.path.replace(/\/$/, "")}${path}`;
}

/** ws(s) URL of an endpoint, as httpURL. */
export function webSocketURL(relayUrl: string, path: string): string {
    return httpURL(relayUrl, path).replace(/^http/, "ws");
}

// ---------------------------------------------------------------------------
// One connection

export type RelayCredentials = {
    role: Role;
    /** A relay pass (approvers on the hosted relay). */
    pass?: string;
    /** The access token of a self-hosted relay in token mode. */
    token?: string;
};

export type ConnectOptions = {
    relayUrl: string;
    identity: AgentIdentity;
    credentials: RelayCredentials;
    openWebSocket: (url: string, protocols: string[]) => WebSocketLike;
};

type Waiter<T> = { resolve: (v: T) => void; reject: (e: Error) => void };

/**
 * One authenticated WebSocket to /v1/connect. Frames that answer a call
 * (Result, SlotOffer) go to the caller; Deliver, Revoked and the rest wait
 * for next().
 */
export class RelayConnection {
    ready!: Ready;

    private keepaliveMs = DEFAULT_KEEPALIVE_MS;
    private phase: "connecting" | "challenge" | "auth" | "open" = "connecting";
    private handshake: Waiter<ServerFrame | null> | null = null;
    /** Handshake frames that came before step() asked for them. */
    private readonly early: ServerFrame[] = [];
    private error: Error | null = null;
    private nextId = 0;
    private readonly pending = new Map<number, Waiter<ServerFrame>>();
    private readonly queue: ServerFrame[] = [];
    private readonly readers: Waiter<ServerFrame>[] = [];
    private lastSent = Date.now();
    private lastReceived = Date.now();
    private keepaliveTimer: ReturnType<typeof setInterval> | undefined;

    private constructor(private readonly ws: WebSocketLike) {
        ws.binaryType = "arraybuffer";
        ws.onopen = () => this.handshake?.resolve(null);
        ws.onerror = () => {
            // Browsers follow with close; some sockets don't while connecting.
            if (this.phase === "connecting") {
                this.fail(
                    new RelayClosedError(
                        "closed",
                        "couldn't connect to the relay",
                    ),
                );
            }
        };
        ws.onclose = (ev) =>
            this.fail(
                new RelayClosedError(
                    "closed",
                    ev?.code === 1000 || !ev
                        ? undefined
                        : `relay connection closed (${ev.code}${ev.reason ? `: ${ev.reason}` : ""})`,
                ),
            );
        ws.onmessage = (ev) => this.receive(ev.data);
    }

    /** Dials, answers the Challenge and waits for Ready. */
    static async connect(options: ConnectOptions): Promise<RelayConnection> {
        const origin = normalizeOrigin(options.relayUrl);
        const url = webSocketURL(options.relayUrl, CONNECT_PATH);
        const ws = options.openWebSocket(url, [SUBPROTOCOL]);
        const conn = new RelayConnection(ws);
        try {
            await conn.step();
            const protocol = (ws as { protocol?: unknown }).protocol;
            if (
                typeof protocol === "string" &&
                protocol !== "" &&
                protocol !== SUBPROTOCOL
            ) {
                throw new RelayClosedError(
                    "protocol",
                    `the relay doesn't speak ${SUBPROTOCOL}`,
                );
            }
            conn.phase = "challenge";
            const first = await conn.step();
            if (first?.frame?.$case !== "challenge") {
                throw new RelayClosedError(
                    "protocol",
                    "the relay didn't start with a Challenge",
                );
            }
            const challenge = first.frame.challenge;
            if (challenge.protocolVersion !== PROTOCOL_VERSION) {
                throw new RelayClosedError(
                    "protocol",
                    `the relay speaks protocol version ${challenge.protocolVersion}, this client ${PROTOCOL_VERSION}`,
                );
            }
            if (challenge.keepaliveSeconds > 0) {
                conn.keepaliveMs = challenge.keepaliveSeconds * 1000;
            }
            conn.phase = "auth";
            const reply = conn.step({
                id: 0,
                frame: {
                    $case: "auth",
                    auth: {
                        publicKey: identityId(options.identity),
                        signature: signRelayAuth(
                            options.identity,
                            origin,
                            challenge.nonce,
                        ),
                        pass: options.credentials.pass ?? "",
                        token: options.credentials.token ?? "",
                        role: options.credentials.role,
                    },
                },
            });
            const answer = await reply;
            if (answer?.frame?.$case !== "ready") {
                throw new RelayClosedError(
                    "protocol",
                    "the relay didn't answer Auth with Ready",
                );
            }
            conn.ready = answer.frame.ready;
        } catch (error) {
            conn.fail(error as Error);
            throw conn.error ?? error;
        }
        conn.phase = "open";
        conn.lastReceived = Date.now();
        conn.startKeepalive();
        return conn;
    }

    /** Sends frame (if any) and waits for the next handshake event. */
    private step(frame?: ClientFrame): Promise<ServerFrame | null> {
        return new Promise((resolve, reject) => {
            if (this.error) return reject(this.error);
            const early = frame ? undefined : this.early.shift();
            if (early) return resolve(early);
            const timer = setTimeout(
                () =>
                    this.fail(
                        new RelayClosedError(
                            "timeout",
                            "the relay didn't answer in time",
                        ),
                    ),
                HANDSHAKE_TIMEOUT_MS,
            );
            this.handshake = {
                resolve: (v) => {
                    clearTimeout(timer);
                    this.handshake = null;
                    resolve(v);
                },
                reject: (e) => {
                    clearTimeout(timer);
                    this.handshake = null;
                    reject(e);
                },
            };
            if (frame) {
                try {
                    this.write(frame);
                } catch (error) {
                    this.fail(error as Error);
                }
            }
        });
    }

    private receive(data: ArrayBuffer | Uint8Array | string): void {
        if (this.error) return;
        if (typeof data === "string") {
            this.fail(
                new RelayClosedError(
                    "protocol",
                    "the relay sent a text message",
                ),
            );
            return;
        }
        let frame: ServerFrame;
        try {
            frame = ServerFrame.decode(
                data instanceof Uint8Array ? data : new Uint8Array(data),
            );
        } catch {
            this.fail(
                new RelayClosedError(
                    "protocol",
                    "the relay sent a malformed frame",
                ),
            );
            return;
        }
        this.lastReceived = Date.now();
        const f = frame.frame;
        if (f?.$case === "error") {
            this.fail(
                new RelayStatusError(f.error.status, f.error.message, true),
            );
            return;
        }
        if (this.phase !== "open") {
            // Frames right after Ready can arrive in the same tick, before
            // connect() resumes, and belong to the open connection.
            if (this.phase === "auth" && f?.$case === "ready")
                this.phase = "open";
            if (this.handshake) this.handshake.resolve(frame);
            else this.early.push(frame);
            return;
        }
        switch (f?.$case) {
            case "pong":
                return;
            case "result":
                return this.answer(f.result.id, frame);
            case "slotOffer":
                return this.answer(f.slotOffer.id, frame);
        }
        const reader = this.readers.shift();
        if (reader) {
            reader.resolve(frame);
            return;
        }
        if (this.queue.length >= MAX_QUEUED_FRAMES) {
            this.fail(
                new RelayClosedError(
                    "flooded",
                    "the relay sent more than this client could keep up with",
                ),
            );
            return;
        }
        this.queue.push(frame);
    }

    private answer(id: number, frame: ServerFrame): void {
        const waiter = this.pending.get(id);
        this.pending.delete(id);
        waiter?.resolve(frame);
    }

    private startKeepalive(): void {
        const staleAfter = 2 * this.keepaliveMs + 10_000;
        this.keepaliveTimer = setInterval(
            () => {
                const now = Date.now();
                if (now - this.lastReceived > staleAfter) {
                    this.fail(
                        new RelayClosedError(
                            "stale",
                            "the relay stopped answering",
                        ),
                    );
                    return;
                }
                if (now - this.lastSent >= this.keepaliveMs) {
                    try {
                        this.write({
                            id: 0,
                            frame: { $case: "ping", ping: {} },
                        });
                    } catch (error) {
                        this.fail(error as Error);
                    }
                }
            },
            Math.max(this.keepaliveMs / 4, 50),
        );
    }

    private write(frame: ClientFrame): void {
        if (this.error) throw this.error;
        if (this.ws.readyState !== WS_OPEN) {
            throw new RelayClosedError("closed");
        }
        this.ws.send(ClientFrame.encode(frame).finish());
        this.lastSent = Date.now();
    }

    private fail(error: Error): void {
        if (this.error) return;
        this.error = error;
        clearInterval(this.keepaliveTimer);
        this.handshake?.reject(error);
        for (const waiter of this.pending.values()) waiter.reject(error);
        this.pending.clear();
        // Readers only wait while the queue is empty.
        for (const reader of this.readers.splice(0)) reader.reject(error);
        try {
            this.ws.close(1000);
        } catch {
            // Already closed.
        }
    }

    /** Null while open; why it ended afterwards. */
    get closedError(): Error | null {
        return this.error;
    }

    close(): void {
        this.fail(new RelayClosedError("closed"));
    }

    /**
     * The next Deliver, Revoked or other unsolicited frame. Frames that came
     * before the end are still returned; then it rejects with the reason.
     */
    next(): Promise<ServerFrame> {
        const frame = this.queue.shift();
        if (frame) return Promise.resolve(frame);
        if (this.error) return Promise.reject(this.error);
        return new Promise((resolve, reject) =>
            this.readers.push({ resolve, reject }),
        );
    }

    private call(frame: ClientFrame): Promise<ServerFrame> {
        return new Promise((resolve, reject) => {
            if (this.error) return reject(this.error);
            this.nextId = this.nextId >= 0xffffffff ? 1 : this.nextId + 1;
            const id = this.nextId;
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(
                    new RelayClosedError(
                        "timeout",
                        "the relay didn't answer in time",
                    ),
                );
            }, CALL_TIMEOUT_MS);
            this.pending.set(id, {
                resolve: (reply) => {
                    clearTimeout(timer);
                    const f = reply.frame;
                    if (
                        f?.$case === "result" &&
                        f.result.status !== Status.STATUS_OK
                    ) {
                        reject(
                            new RelayStatusError(
                                f.result.status,
                                f.result.message,
                                false,
                            ),
                        );
                    } else {
                        resolve(reply);
                    }
                },
                reject: (e) => {
                    clearTimeout(timer);
                    reject(e);
                },
            });
            try {
                this.write({ ...frame, id });
            } catch (error) {
                this.pending.delete(id);
                clearTimeout(timer);
                reject(error);
            }
        });
    }

    /** Hands an envelope to the relay. */
    async send(envelope: Envelope): Promise<void> {
        if (Envelope.encode(envelope).finish().length > MAX_ENVELOPE_SIZE) {
            throw new RelayStatusError(
                Status.STATUS_TOO_LARGE,
                "the envelope is larger than the relay accepts",
                false,
            );
        }
        await this.call({
            id: 0,
            frame: { $case: "send", send: { envelope } },
        });
    }

    /** Removes a delivered envelope from this client's queue on the relay. */
    ack(messageId: Uint8Array): void {
        this.write({ id: 0, frame: { $case: "ack", ack: { messageId } } });
    }

    async registerAgent(
        agentKey: Uint8Array,
        revocationKey: Uint8Array,
    ): Promise<void> {
        await this.call({
            id: 0,
            frame: {
                $case: "registerAgent",
                registerAgent: { agentKey, revocationKey },
            },
        });
    }

    async unregisterAgent(agentKey: Uint8Array): Promise<void> {
        await this.call({
            id: 0,
            frame: { $case: "unregisterAgent", unregisterAgent: { agentKey } },
        });
    }

    async renewPass(pass: string): Promise<void> {
        await this.call({
            id: 0,
            frame: { $case: "renewPass", renewPass: { pass } },
        });
    }

    async claimSlot(slotId: Uint8Array): Promise<SlotOffer> {
        const reply = await this.call({
            id: 0,
            frame: { $case: "claimSlot", claimSlot: { slotId } },
        });
        if (reply.frame?.$case !== "slotOffer") {
            throw new RelayClosedError(
                "protocol",
                "the relay answered ClaimSlot without an offer",
            );
        }
        return reply.frame.slotOffer;
    }

    async answerSlot(slotId: Uint8Array, envelope: Envelope): Promise<void> {
        await this.call({
            id: 0,
            frame: { $case: "answerSlot", answerSlot: { slotId, envelope } },
        });
    }
}

// ---------------------------------------------------------------------------
// Reconnecting

/**
 * Reconnect waits: 1 s doubling to 60 s, each randomized down to half so
 * clients that lost the relay together don't come back together.
 */
export class Backoff {
    private next = 0;

    constructor(
        readonly minMs = 1000,
        readonly maxMs = 60_000,
    ) {}

    nextDelay(): number {
        if (this.next < this.minMs) this.next = this.minMs;
        const d = this.next;
        this.next = Math.min(this.next * 2, this.maxMs);
        return d / 2 + Math.random() * (d / 2);
    }

    reset(): void {
        this.next = 0;
    }
}

export type RelaySessionOptions = {
    relayUrl: string;
    identity: AgentIdentity;
    openWebSocket: (url: string, protocols: string[]) => WebSocketLike;
    /** Called before every attempt, so a renewed pass is picked up. */
    credentials: () => Promise<RelayCredentials>;
    /** Called once per connection, after Ready. */
    onConnected?: (conn: RelayConnection) => void;
    /** Every frame next() yields, in order. May be async; frames wait. */
    onFrame: (
        conn: RelayConnection,
        frame: ServerFrame,
    ) => void | Promise<void>;
    onDisconnected?: (error: Error) => void;
    backoff?: Backoff;
};

/** Keeps one connection to a relay up until stop(). */
export class RelaySession {
    private running = false;
    private conn: RelayConnection | null = null;
    private wake: (() => void) | null = null;
    private readonly waiters: (Waiter<RelayConnection> & {
        failFast: boolean;
    })[] = [];
    private readonly backoff: Backoff;
    /** Why the last attempt or connection ended. */
    lastError: Error | null = null;

    constructor(private readonly options: RelaySessionOptions) {
        this.backoff = options.backoff ?? new Backoff();
    }

    get connection(): RelayConnection | null {
        return this.conn && !this.conn.closedError ? this.conn : null;
    }

    start(): void {
        if (this.running) return;
        this.running = true;
        void this.loop();
    }

    stop(): void {
        this.running = false;
        this.conn?.close();
        this.wake?.();
        const error = new RelayClosedError("closed", "stopped");
        for (const w of this.waiters.splice(0)) w.reject(error);
    }

    /** Skips the current backoff wait (a pass arrived, the app resumed). */
    retryNow(): void {
        this.backoff.reset();
        this.wake?.();
    }

    /**
     * The live connection, waiting up to timeoutMs. failFast rejects at the
     * next failed attempt instead, for a user who is waiting on a screen.
     */
    waitConnected(
        timeoutMs: number,
        failFast = false,
    ): Promise<RelayConnection> {
        const live = this.connection;
        if (live) return Promise.resolve(live);
        if (!this.running)
            return Promise.reject(
                new RelayClosedError("closed", "not started"),
            );
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                const i = this.waiters.indexOf(waiter);
                if (i >= 0) this.waiters.splice(i, 1);
                reject(
                    this.lastError ??
                        new RelayClosedError(
                            "timeout",
                            "couldn't reach the relay",
                        ),
                );
            }, timeoutMs);
            const waiter = {
                failFast,
                resolve: (c: RelayConnection) => {
                    clearTimeout(timer);
                    resolve(c);
                },
                reject: (e: Error) => {
                    clearTimeout(timer);
                    reject(e);
                },
            };
            this.waiters.push(waiter);
            if (failFast) this.retryNow();
        });
    }

    private async loop(): Promise<void> {
        while (this.running) {
            let conn: RelayConnection | null = null;
            try {
                const credentials = await this.options.credentials();
                if (!this.running) break;
                conn = await RelayConnection.connect({
                    relayUrl: this.options.relayUrl,
                    identity: this.options.identity,
                    credentials,
                    openWebSocket: this.options.openWebSocket,
                });
            } catch (error) {
                this.lastError = error as Error;
                for (const w of this.waiters.filter((w) => w.failFast)) {
                    this.waiters.splice(this.waiters.indexOf(w), 1);
                    w.reject(error as Error);
                }
            }
            if (conn) {
                if (!this.running) {
                    conn.close();
                    break;
                }
                this.conn = conn;
                this.backoff.reset();
                this.lastError = null;
                this.options.onConnected?.(conn);
                for (const w of this.waiters.splice(0)) w.resolve(conn);
                const error = await this.serve(conn);
                this.conn = null;
                this.lastError = error;
                this.options.onDisconnected?.(error);
            }
            if (!this.running) break;
            await this.sleep(this.backoff.nextDelay());
        }
    }

    private async serve(conn: RelayConnection): Promise<Error> {
        for (;;) {
            let frame: ServerFrame;
            try {
                frame = await conn.next();
            } catch (error) {
                return error as Error;
            }
            try {
                await this.options.onFrame(conn, frame);
            } catch {
                // A frame handler bug must not end the connection loop.
            }
        }
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => {
            const timer = setTimeout(done, ms);
            function done() {
                clearTimeout(timer);
                resolve();
            }
            this.wake = () => {
                this.wake = null;
                done();
            };
        });
    }
}

// ---------------------------------------------------------------------------
// Revoke

/**
 * Revokes an agent through POST /v1/revoke with the revocation key from the
 * agent record, as any device holding the vault can. Resolves with the HTTP
 * status: 204 revoked, 404 unknown agent (already gone), 403 bad signature
 * or clock, 400 malformed, 429 rate limited. signal cancels the request.
 */
export async function revokeOverHttp(
    relayUrl: string,
    revocationSeed: Uint8Array,
    agentKey: Uint8Array,
    fetchImpl: typeof fetch,
    now = Date.now(),
    signal?: AbortSignal,
): Promise<number> {
    const origin = normalizeOrigin(relayUrl);
    const body = RevokeRequest.encode(
        signRevoke(revocationSeed, origin, agentKey, now),
    ).finish();
    const response = await fetchImpl(httpURL(relayUrl, REVOKE_PATH), {
        method: "POST",
        headers: { "Content-Type": "application/x-protobuf" },
        body: body as BodyInit,
        signal,
    });
    return response.status;
}

/** The public half of a revocation seed, registered with RegisterAgent. */
export function revocationPublicKey(revocationSeed: Uint8Array): Uint8Array {
    return ed25519.getPublicKey(revocationSeed);
}
