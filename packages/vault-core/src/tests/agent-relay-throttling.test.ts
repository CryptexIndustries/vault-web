/**
 * @jest-environment node
 *
 * The web approver runs in a browser tab. Chrome throttles timers in tabs
 * that have been hidden for 5 minutes to one wake-up a minute, aligned to
 * the minute ("intensive wake-up throttling"); WebSocket messages still
 * arrive at once. This runs RelaySession against a simulated relay with
 * every timer pushed to the next whole minute, and checks that the
 * keep-alive still beats the relay's idle limit (2 x keepalive + 10 s) for
 * the hosted (90 s) and self-hosted (240 s) relays, and that a dropped or
 * silent relay is reconnected.
 */
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

import type { WebSocketLike } from "../agent/approver-types";
import { generateAgentIdentity, PROTOCOL_VERSION } from "../agent/envelope";
import { Backoff, RelaySession } from "../agent/relay-client";
import { ClientFrame, Role, ServerFrame } from "../proto/agent";

const MINUTE = 60_000;
/** The relay's grace on top of twice the keep-alive (relay/server.go). */
const IDLE_GRACE_MS = 10_000;

type Timer = { at: number; fn: () => void; period?: number };

/** A virtual clock whose timers fire no earlier than the next whole minute. */
class ThrottledClock {
    now = 10 * MINUTE + 1234;
    private timers = new Map<number, Timer>();
    private nextId = 1;
    private saved: Record<string, unknown> = {};

    private align(at: number) {
        return Math.ceil(at / MINUTE) * MINUTE;
    }

    install() {
        const g = globalThis as Record<string, unknown>;
        for (const name of [
            "setTimeout",
            "setInterval",
            "clearTimeout",
            "clearInterval",
        ])
            this.saved[name] = g[name];
        this.saved.now = Date.now;
        g.setTimeout = (fn: () => void, ms = 0) => this.add(fn, ms);
        g.setInterval = (fn: () => void, ms = 0) =>
            this.add(fn, ms, Math.max(ms, 1));
        g.clearTimeout = g.clearInterval = (id: number) =>
            this.timers.delete(id);
        Date.now = () => this.now;
    }

    uninstall() {
        const g = globalThis as Record<string, unknown>;
        for (const [name, value] of Object.entries(this.saved))
            if (name !== "now") g[name] = value;
        Date.now = this.saved.now as () => number;
    }

    private add(fn: () => void, ms: number, period?: number) {
        const id = this.nextId++;
        this.timers.set(id, { at: this.align(this.now + ms), fn, period });
        return id;
    }

    /** Runs timers up to `until`, letting promises settle between them. */
    async advance(until: number, onTick?: () => void) {
        for (;;) {
            await flush();
            let next: [number, Timer] | null = null;
            for (const entry of this.timers)
                if (!next || entry[1].at < next[1].at) next = entry;
            if (!next || next[1].at > until) break;
            const [id, timer] = next;
            this.now = timer.at;
            if (timer.period) timer.at = this.align(this.now + timer.period);
            else this.timers.delete(id);
            timer.fn();
            onTick?.();
        }
        this.now = until;
        await flush();
    }
}

const realSetImmediate = setImmediate;
const flush = async () => {
    for (let i = 0; i < 5; i++)
        await new Promise((resolve) => realSetImmediate(resolve));
};

/** A relay over a fake socket: answers Auth and Ping, enforces the idle limit. */
class FakeRelay {
    sockets: FakeSocket[] = [];
    connects = 0;
    idleCloses = 0;
    answering = true;
    /** Longest silence from a client, in ms. */
    longestSilence = 0;

    constructor(
        readonly clock: ThrottledClock,
        readonly keepaliveSeconds: number,
    ) {}

    open = (): WebSocketLike => {
        const socket = new FakeSocket(this);
        this.sockets.push(socket);
        this.connects++;
        realSetImmediate(() => socket.accept());
        return socket;
    };

    /** The relay's read deadline: it closes sockets silent for too long. */
    check() {
        const limit = 2 * this.keepaliveSeconds * 1000 + IDLE_GRACE_MS;
        for (const socket of this.sockets) {
            if (socket.readyState !== 1) continue;
            const silence = this.clock.now - socket.lastFromClient;
            this.longestSilence = Math.max(this.longestSilence, silence);
            if (silence > limit) {
                this.idleCloses++;
                socket.serverClose(1006);
            }
        }
    }
}

class FakeSocket implements WebSocketLike {
    binaryType = "arraybuffer";
    readyState = 0;
    lastFromClient: number;
    onopen: ((ev: unknown) => void) | null = null;
    onclose: ((ev: { code: number; reason: string }) => void) | null = null;
    onerror: ((ev: unknown) => void) | null = null;
    onmessage:
        | ((ev: { data: ArrayBuffer | Uint8Array | string }) => void)
        | null = null;

    constructor(private readonly relay: FakeRelay) {
        this.lastFromClient = relay.clock.now;
    }

    accept() {
        this.readyState = 1;
        this.onopen?.({});
        this.push({
            frame: {
                $case: "challenge",
                challenge: {
                    protocolVersion: PROTOCOL_VERSION,
                    nonce: new Uint8Array(32),
                    keepaliveSeconds: this.relay.keepaliveSeconds,
                    serverTime: this.relay.clock.now,
                },
            },
        });
    }

    private push(frame: ServerFrame) {
        // Network events aren't throttled.
        realSetImmediate(() => {
            if (this.readyState === 1)
                this.onmessage?.({ data: ServerFrame.encode(frame).finish() });
        });
    }

    send(data: Uint8Array) {
        this.lastFromClient = this.relay.clock.now;
        if (!this.relay.answering) return;
        const frame = ClientFrame.decode(data).frame;
        if (frame?.$case === "auth")
            this.push({
                frame: {
                    $case: "ready",
                    ready: {
                        role: Role.ROLE_APPROVER,
                        passExpiresAt: 0,
                        agents: [],
                    },
                },
            });
        if (frame?.$case === "ping")
            this.push({ frame: { $case: "pong", pong: {} } });
    }

    close() {
        this.readyState = 3;
    }

    serverClose(code: number) {
        if (this.readyState !== 1) return;
        this.readyState = 3;
        realSetImmediate(() => this.onclose?.({ code, reason: "" }));
    }
}

describe("the relay connection in a throttled background tab", () => {
    let clock: ThrottledClock;
    let session: RelaySession | null;

    beforeEach(() => {
        clock = new ThrottledClock();
        clock.install();
        session = null;
    });

    afterEach(() => {
        session?.stop();
        clock.uninstall();
    });

    const start = (relay: FakeRelay) => {
        const events = { connected: 0, disconnected: 0 };
        session = new RelaySession({
            relayUrl: "https://relay.example.com",
            identity: generateAgentIdentity(),
            openWebSocket: relay.open,
            backoff: new Backoff(),
            credentials: async () => ({ role: Role.ROLE_APPROVER, token: "t" }),
            onConnected: () => void events.connected++,
            onDisconnected: () => void events.disconnected++,
            onFrame: () => undefined,
        });
        session.start();
        return events;
    };

    for (const keepalive of [90, 240]) {
        it(`keeps a ${keepalive} s keep-alive connection up for an hour`, async () => {
            const relay = new FakeRelay(clock, keepalive);
            const events = start(relay);
            await clock.advance(clock.now + 60 * MINUTE, () => relay.check());
            expect(events.connected).toBe(1);
            expect(events.disconnected).toBe(0);
            expect(relay.idleCloses).toBe(0);
            // A ping goes out at most a minute after it is due.
            expect(relay.longestSilence).toBeLessThanOrEqual(
                (keepalive + 60) * 1000,
            );
        });
    }

    it("reconnects within two minutes after the relay drops the connection", async () => {
        const relay = new FakeRelay(clock, 90);
        const events = start(relay);
        await clock.advance(clock.now + 5 * MINUTE, () => relay.check());
        const dropped = clock.now;
        relay.sockets.at(-1)!.serverClose(1001);
        await clock.advance(dropped + 2 * MINUTE, () => relay.check());
        expect(events.disconnected).toBe(1);
        expect(events.connected).toBe(2);
    });

    it("notices a relay that stopped answering and reconnects", async () => {
        const relay = new FakeRelay(clock, 90);
        const events = start(relay);
        await clock.advance(clock.now + 5 * MINUTE);
        relay.answering = false;
        const silent = clock.now;
        // Stale after 2 x 90 s + 10 s, checked once a minute; then a retry.
        await clock.advance(silent + 5 * MINUTE);
        expect(events.disconnected).toBeGreaterThanOrEqual(1);
        relay.answering = true;
        await clock.advance(clock.now + 3 * MINUTE);
        expect(events.connected).toBeGreaterThanOrEqual(2);
        expect(session!.connection).not.toBeNull();
    });
});
