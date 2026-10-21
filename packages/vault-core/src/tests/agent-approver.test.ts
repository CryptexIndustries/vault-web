/**
 * The relay client and approver against a fake relay behind a fake
 * WebSocket. The real Go relay and agent are in agent-integration.test.ts.
 *
 * @jest-environment node
 */
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { ed25519 } from "@noble/curves/ed25519.js";

import { uint8ToBase64Url } from "../encoding";
import { VaultLockedError } from "../agent/runtime";
import { AgentRequestOutcome } from "../proto/vault";
import { SSHWriter } from "../internal/ssh/wire";
import {
    type Envelope,
    RefusalReason,
    RevokeRequest,
    Role,
    Status,
    type SignRequest,
} from "../proto/agent";
import {
    AnswerCancelledError,
    Approver,
    MAX_PENDING_PER_AGENT,
    PairingExpiredError,
    RequestGoneError,
    UnknownRelayError,
} from "../agent/approver";
import type {
    ApprovedAgent,
    ApproverHost,
    IncomingRequest,
    RelayTarget,
} from "../agent/approver-types";
import {
    generateAgentIdentity,
    identityPeer,
    openEnvelope,
    parseEnvelopeHeader,
    sealEnvelope,
} from "../agent/envelope";
import {
    confirmationCode,
    relayAuthInput,
    revokeInput,
} from "../agent/pairing";
import {
    Backoff,
    MAX_QUEUED_FRAMES,
    RelayClosedError,
    RelayConnection,
    RelaySession,
    RelayStatusError,
    revokeOverHttp,
} from "../agent/relay-client";

import {
    cleanupRelayHarness,
    FakeRelay,
    intercept,
    KEY,
    liveApprovers,
    pairingSlot,
    ORIGIN,
    RELAY_URL,
    runtimeOnRelay,
    signRequest,
    sshsig,
    tick,
    TOKEN,
    until,
} from "./helpers/fake-relay";

afterEach(() => cleanupRelayHarness());

type Harness = {
    relay: FakeRelay;
    approver: Approver;
    host: ApproverHost;
    agents: ApprovedAgent[];
    requests: IncomingRequest[];
    gone: string[];
    repeats: string[];
    confirmed: string[];
    revoked: string[];
    passes: string[];
};

afterEach(() => {
    jest.useRealTimers();
});

function harness(
    options: {
        relays?: RelayTarget[];
        hostedRelayUrl?: string;
    } = {},
): Harness {
    const relay = new FakeRelay();
    const h: Partial<Harness> = {
        relay,
        agents: [],
        requests: [],
        gone: [],
        repeats: [],
        confirmed: [],
        revoked: [],
        passes: [],
    };
    const host: ApproverHost = {
        identity: generateAgentIdentity(),
        deviceName: "Test phone",
        openWebSocket: relay.open,
        fetch,
        getPass: async () => h.passes!.at(-1) ?? null,
        relays: () =>
            options.relays ?? [
                { kind: "custom", url: RELAY_URL, token: TOKEN },
            ],
        agents: () => h.agents!,
        onRequest: (r) => h.requests!.push(r),
        onRequestGone: (id) => h.gone!.push(id),
        onRepeat: (id) => h.repeats!.push(id),
        onAgentConfirmed: (id) => h.confirmed!.push(id),
        onRelayDroppedAgent: (id) => h.revoked!.push(id),
        hostedRelayUrl: options.hostedRelayUrl,
    };
    const approver = new Approver(host, { backoff: () => new Backoff(10, 40) });
    liveApprovers.push(approver);
    return { ...(h as Harness), host, approver };
}

/** A paired agent known to the host, and a way to send as it. */
function addAgent(h: Harness, granted: Uint8Array[] | undefined = [KEY]) {
    const agent = generateAgentIdentity();
    const peer = identityPeer(agent);
    const id = uint8ToBase64Url(peer.signPublicKey);
    h.relay.registered.set(id, new Uint8Array(32));
    h.agents.push({
        id,
        ...peer,
        relay: { kind: "custom", url: RELAY_URL, token: TOKEN },
        grantedKeys: granted,
    });
    const approverPeer = identityPeer(h.host.identity);
    const deliver = (envelope: Envelope) =>
        h.relay.last.push({
            frame: { $case: "deliver", deliver: { envelope } },
        });
    const request = (sign: SignRequest, expiresIn = 90_000) => {
        const envelope = sealEnvelope(
            agent,
            approverPeer,
            { body: { $case: "signRequest", signRequest: sign } },
            { expiresAt: Date.now() + expiresIn },
        );
        deliver(envelope);
        return envelope;
    };
    const open = (envelope: Envelope) =>
        openEnvelope(agent, approverPeer, envelope);
    return { agent, id, deliver, request, open };
}

const connected = (h: Harness) =>
    until(
        () => h.relay.of("auth").length > 0 && h.relay.last.readyState === 1,
        "auth",
    );

describe("RelayConnection", () => {
    const connect = (relay: FakeRelay, relayUrl = RELAY_URL, token = TOKEN) =>
        RelayConnection.connect({
            relayUrl,
            identity: generateAgentIdentity(),
            credentials: { role: Role.ROLE_APPROVER, token },
            openWebSocket: relay.open,
        });

    it("authenticates with a signature over the relay origin and nonce", async () => {
        const relay = new FakeRelay();
        const conn = await connect(relay, `${RELAY_URL}/`);
        expect(relay.last.url).toBe("wss://relay.example.com/v1/connect");
        expect(relay.last.protocols).toEqual(["cryptex-agent.v1"]);
        const auth = relay.of("auth")[0]!.frame as {
            $case: "auth";
            auth: import("../proto/agent").Auth;
        };
        expect(auth.auth.role).toBe(Role.ROLE_APPROVER);
        expect(auth.auth.token).toBe(TOKEN);
        expect(
            ed25519.verify(
                auth.auth.signature,
                relayAuthInput(ORIGIN, relay.last.nonce),
                auth.auth.publicKey,
            ),
        ).toBe(true);
        expect(conn.ready.role).toBe(Role.ROLE_APPROVER);
        conn.close();
    });

    it("turns an Error frame into a fatal status error", async () => {
        const relay = new FakeRelay();
        relay.authError = {
            status: Status.STATUS_UNAUTHORIZED,
            message: "bad token",
        };
        const attempt = connect(relay, RELAY_URL, "nope");
        await expect(attempt).rejects.toMatchObject({
            status: Status.STATUS_UNAUTHORIZED,
            fatal: true,
        });
        await expect(attempt).rejects.toBeInstanceOf(RelayStatusError);
    });

    it("pings after the announced silence", async () => {
        jest.useFakeTimers({ doNotFake: ["setImmediate"] });
        const relay = new FakeRelay();
        relay.keepaliveSeconds = 10;
        const conn = await connect(relay);
        await jest.advanceTimersByTimeAsync(9_000);
        expect(relay.of("ping")).toHaveLength(0);
        await jest.advanceTimersByTimeAsync(2_000);
        expect(relay.of("ping")).toHaveLength(1);
        // A relay that goes silent past 2 x keepalive + 10 s is given up on.
        relay.handle = () => {};
        await jest.advanceTimersByTimeAsync(35_000);
        expect(conn.closedError).toBeInstanceOf(RelayClosedError);
        expect((conn.closedError as RelayClosedError).reason).toBe("stale");
    });

    it("closes when the relay floods frames nobody takes", async () => {
        const relay = new FakeRelay();
        const conn = await connect(relay);
        for (let i = 0; i <= MAX_QUEUED_FRAMES; i++) {
            relay.last.push({
                frame: {
                    $case: "revoked",
                    revoked: { agentKey: new Uint8Array(32) },
                },
            });
        }
        expect((conn.closedError as RelayClosedError).reason).toBe("flooded");
        // Frames that came before the end are still handed out.
        await expect(conn.next()).resolves.toMatchObject({
            frame: { $case: "revoked" },
        });
    });

    it("rejects calls with the Result status", async () => {
        const relay = new FakeRelay();
        const conn = await connect(relay);
        await expect(conn.claimSlot(new Uint8Array(16))).rejects.toMatchObject({
            status: Status.STATUS_NOT_FOUND,
            fatal: false,
        });
        conn.close();
    });
});

describe("RelaySession", () => {
    it("reconnects with backoff after the relay goes away", async () => {
        const relay = new FakeRelay();
        const changes: boolean[] = [];
        const session = new RelaySession({
            relayUrl: RELAY_URL,
            identity: generateAgentIdentity(),
            openWebSocket: relay.open,
            credentials: async () => ({
                role: Role.ROLE_APPROVER,
                token: TOKEN,
            }),
            onConnected: () => changes.push(true),
            onDisconnected: () => changes.push(false),
            onFrame: () => {},
            backoff: new Backoff(10, 20),
        });
        session.start();
        await session.waitConnected(1000);
        relay.refuseConnections = true;
        relay.last.drop();
        await until(() => relay.sockets.length >= 3, "retries");
        relay.refuseConnections = false;
        await until(() => changes.filter(Boolean).length === 2, "reconnect");
        expect(changes).toEqual([true, false, true]);
        session.stop();
    });

    it("fails fast for a waiting user when the relay refuses", async () => {
        const relay = new FakeRelay();
        relay.authError = { status: Status.STATUS_UNAUTHORIZED, message: "" };
        const session = new RelaySession({
            relayUrl: RELAY_URL,
            identity: generateAgentIdentity(),
            openWebSocket: relay.open,
            credentials: async () => ({ role: Role.ROLE_APPROVER, token: "x" }),
            onFrame: () => {},
            backoff: new Backoff(1000, 1000),
        });
        session.start();
        await expect(session.waitConnected(5000, true)).rejects.toMatchObject({
            status: Status.STATUS_UNAUTHORIZED,
        });
        session.stop();
    });
});

describe("Approver pairing", () => {
    const offerFor = (h: Harness, relayUrl = RELAY_URL, expiresIn?: number) =>
        pairingSlot(h.relay, { relayUrl, expiresIn });

    it("claims, registers, answers and waits for PairingConfirm", async () => {
        const h = harness();
        h.approver.start();
        const { agent, peer, code, text } = offerFor(h);
        const claim = await h.approver.claim(`  ${text}\n`);
        expect(claim.agentId).toBe(uint8ToBase64Url(peer.signPublicKey));
        expect(claim.offer.hostname).toBe("arch-desktop");
        expect(claim.relay).toEqual({
            kind: "custom",
            url: RELAY_URL,
            token: TOKEN,
        });

        const result = await h.approver.accept(claim, {
            agentName: "workstation",
            keys: [{ publicKey: KEY, comment: "GitHub (Cryptex Vault)" }],
        });
        const me = identityPeer(h.host.identity);
        expect(result.confirmationCode).toBe(
            confirmationCode(code.offerHash, me.signPublicKey, me.kemPublicKey),
        );
        expect(result.confirmationCode).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
        expect(result.keysRevision).toBe(1);

        const register = h.relay.of("registerAgent")[0]!.frame as {
            $case: "registerAgent";
            registerAgent: { agentKey: Uint8Array; revocationKey: Uint8Array };
        };
        expect(register.registerAgent.agentKey).toEqual(peer.signPublicKey);
        expect(register.registerAgent.revocationKey).toEqual(
            ed25519.getPublicKey(result.revocationSeed),
        );
        const order = h.relay.frames.map((f) => f.frame?.$case);
        expect(order.indexOf("registerAgent")).toBeLessThan(
            order.indexOf("answerSlot"),
        );
        const answer = h.relay.of("answerSlot")[0]!.frame as {
            $case: "answerSlot";
            answerSlot: { slotId: Uint8Array; envelope: Envelope };
        };
        expect(answer.answerSlot.slotId).toEqual(code.slotId);
        expect(answer.answerSlot.envelope.pairingMac).toHaveLength(32);

        // The confirm can come before the app stored the agent.
        const confirmed = h.approver.waitConfirmed(claim.agentId, 2000);
        const envelope = sealEnvelope(
            agent,
            me,
            {
                body: {
                    $case: "pairingConfirm",
                    pairingConfirm: { agentVersion: "0.1.0" },
                },
            },
            { expiresAt: Date.now() + 60_000, retain: true },
        );
        h.relay.last.push({
            frame: { $case: "deliver", deliver: { envelope } },
        });
        await confirmed;
        expect(h.confirmed).toEqual([claim.agentId]);
        await until(() => h.relay.of("ack").length === 1, "ack");
    });

    it("rejects waitConfirmed when the agent is removed (cancelled on the machine)", async () => {
        const h = harness();
        h.approver.start();
        const { peer, text } = offerFor(h);
        const claim = await h.approver.claim(text);
        await h.approver.accept(claim, { agentName: "box", keys: [] });
        const waiting = h.approver.waitConfirmed(claim.agentId, 2000);
        h.relay.last.push({
            frame: {
                $case: "revoked",
                revoked: { agentKey: peer.signPublicKey },
            },
        });
        await expect(waiting).rejects.toThrow(/removed/);
        expect(h.revoked).toEqual([claim.agentId]);
    });

    it("refuses codes for unknown relays and expired claims", async () => {
        const h = harness();
        h.approver.start();
        // Named with its path, in words that don't ask for a token.
        const unknown = await h.approver
            .claim(offerFor(h, "https://example.com/relay/").text)
            .catch((e: unknown) => e);
        expect(unknown).toBeInstanceOf(UnknownRelayError);
        expect((unknown as UnknownRelayError).relayUrl).toBe(
            "https://example.com/relay",
        );
        expect((unknown as Error).message).toBe(
            "This code uses a relay at example.com that this device doesn't know.",
        );
        const { text } = offerFor(h, RELAY_URL, -1);
        const claim = await h.approver.claim(text);
        await expect(
            h.approver.accept(claim, { agentName: "x", keys: [] }),
        ).rejects.toBeInstanceOf(PairingExpiredError);
        await expect(h.approver.claim("cryptex-pair:nonsense")).rejects.toThrow(
            "Invalid pairing code",
        );
    });

    it("keeps the relay a claim is connecting to when the host refreshes", async () => {
        // A first pairing fetches and saves a relay pass; that vault change
        // refreshes the approver while the claim is still connecting.
        const hosted = "https://hosted.example.com/relay";
        const h = harness({ relays: [], hostedRelayUrl: hosted });
        h.passes.push(fakePass(2_000_000_000));
        h.approver.start();
        const claiming = h.approver.claim(offerFor(h, hosted).text);
        h.approver.refresh();
        const claim = await claiming;
        expect(claim.relay).toEqual({ kind: "hosted", url: hosted });
    });

    it("pairs on the configured hosted relay before any agent uses it", async () => {
        const hosted = "https://hosted.example.com/relay";
        const h = harness({ relays: [], hostedRelayUrl: hosted });
        h.passes.push(fakePass(2_000_000_000));
        h.approver.start();
        const claim = await h.approver.claim(offerFor(h, `${hosted}/`).text);
        expect(claim.relay).toEqual({ kind: "hosted", url: hosted });
        expect(h.relay.last.url).toBe(
            "wss://hosted.example.com/relay/v1/connect",
        );
        const auth = h.relay.of("auth")[0]!.frame as {
            $case: "auth";
            auth: { pass: string; token: string };
        };
        expect(auth.auth.pass).toBe(h.passes[0]);
    });

    it("keeps two relays on one host apart by their path", async () => {
        const a = {
            kind: "custom" as const,
            url: `${ORIGIN}/relay-a`,
            token: "a",
        };
        const b = {
            kind: "custom" as const,
            url: `${ORIGIN}/relay-b`,
            token: "b",
        };
        const h = harness({ relays: [a, b] });
        h.approver.start();
        await until(() => h.relay.of("auth").length === 2, "both relays");
        expect(h.relay.sockets.map((socket) => socket.url).sort()).toEqual([
            "wss://relay.example.com/relay-a/v1/connect",
            "wss://relay.example.com/relay-b/v1/connect",
        ]);
        const claim = await h.approver.claim(offerFor(h, b.url).text);
        expect(claim.relay).toEqual(b);
        const claimed = h.relay.of("claimSlot")[0]!;
        expect(h.relay.socketOf.get(claimed)?.url).toBe(
            "wss://relay.example.com/relay-b/v1/connect",
        );
    });

    it("registers nothing for an offer whose KEM key doesn't work", async () => {
        const h = harness();
        h.approver.start();
        // Right length, but not a usable X-Wing key.
        const { text } = pairingSlot(h.relay, {
            kemPublicKey: new Uint8Array(1216).fill(0xff),
        });
        const claim = await h.approver.claim(text);
        await expect(
            h.approver.accept(claim, { agentName: "box", keys: [] }),
        ).rejects.toThrow(/publicKey/);
        expect(h.relay.of("registerAgent")).toHaveLength(0);
        expect(h.relay.of("answerSlot")).toHaveLength(0);
    });

    it("unregisters an agent itself when AnswerSlot fails (it registered it)", async () => {
        const h = harness();
        h.approver.start();
        const { peer, text } = offerFor(h);
        const claim = await h.approver.claim(text);
        intercept(h.relay, "answerSlot", (socket, frame) =>
            h.relay.result(
                socket,
                frame,
                Status.STATUS_NOT_FOUND,
                "slot expired",
            ),
        );
        await expect(
            h.approver.accept(claim, { agentName: "box", keys: [] }),
        ).rejects.toThrow(/slot expired/);
        const id = uint8ToBase64Url(peer.signPublicKey);
        await until(() => !h.relay.registered.has(id), "unregistered");
        expect(h.relay.of("unregisterAgent")).toHaveLength(1);
    });

    it("closes its relay connection when stop interrupts an accept before RegisterAgent", async () => {
        const h = harness();
        h.approver.start();
        const claim = await h.approver.claim(offerFor(h).text);
        let resume: (() => void) | undefined;
        intercept(h.relay, "auth", (_socket, _frame, pass) => (resume = pass));
        h.relay.last.drop();
        const accepting = h.approver
            .accept(claim, { agentName: "box", keys: [] })
            .then(
                () => null,
                (error: unknown) => error,
            );
        await until(() => !!resume, "reconnect handshake");
        h.approver.stop();
        expect(await accepting).toBeInstanceOf(Error);
        resume!();
        await new Promise((r) => setTimeout(r, 50));
        expect(h.relay.of("registerAgent")).toHaveLength(0);
        expect(h.relay.sockets.every((socket) => socket.readyState === 3)).toBe(
            true,
        );
    });

    it("registers nothing once it has stopped", async () => {
        const h = harness();
        h.approver.start();
        const claim = await h.approver.claim(offerFor(h).text);
        h.approver.stop();
        await expect(
            h.approver.accept(claim, { agentName: "box", keys: [] }),
        ).rejects.toBeInstanceOf(Error);
        expect(h.relay.of("registerAgent")).toHaveLength(0);
    });

    it("uses the hosted relay with a pass for hosted codes", async () => {
        const h = harness({ relays: [] });
        h.passes.push(fakePass(2_000_000_000));
        h.approver.start();
        const { text } = offerFor(h, "https://relay.cryptex-vault.com");
        const claim = await h.approver.claim(text);
        expect(claim.relay).toEqual({
            kind: "hosted",
            url: "https://relay.cryptex-vault.com",
        });
        const auth = h.relay.of("auth")[0]!.frame as {
            $case: "auth";
            auth: { pass: string; token: string };
        };
        expect(auth.auth.pass).toBe(h.passes[0]);
        expect(auth.auth.token).toBe("");
    });
});

function fakePass(exp: number): string {
    const payload = Buffer.from(JSON.stringify({ v: 1, exp })).toString(
        "base64url",
    );
    return `${payload}.c2ln`;
}

describe("Approver requests", () => {
    const refusalsOf = (
        a: ReturnType<typeof addAgent>,
        h: Harness,
    ): (RefusalReason | null)[] =>
        h.relay.sent.map((e) => {
            const body = a.open(e).message.body;
            return body?.$case === "signResponse" &&
                body.signResponse.result?.$case === "refusal"
                ? body.signResponse.result.refusal
                : null;
        });

    it("checks, asks once, and answers in reply to the request", async () => {
        const h = harness();
        const a = addAgent(h);
        h.approver.start();
        await connected(h);
        const env = a.request(signRequest(sshsig("git")));
        await until(() => h.requests.length === 1, "request");
        const request = h.requests[0]!;
        expect(request.agentId).toBe(a.id);
        expect(request.check).toMatchObject({
            kind: "signature",
            namespace: "git",
            destinationUnknown: false,
        });

        const signature = new Uint8Array([1, 2, 3]);
        await h.approver.answer(request.id, { signature });
        const reply = a.open(h.relay.sent[0]!);
        expect(reply.header.inReplyTo).toEqual(
            Uint8Array.from(Buffer.from(request.id, "base64url")),
        );
        expect(reply.message.body).toEqual({
            $case: "signResponse",
            signResponse: { result: { $case: "signature", signature } },
        });
        expect(h.approver.pendingRequests()).toEqual([]);

        // The agent reconnects and resends the same request: no second
        // prompt; the host gets it as a repeat (it resends its answer).
        h.relay.last.drop();
        await until(
            () => h.relay.sockets.length === 2 && h.relay.last.readyState === 1,
            "reconnect",
        );
        await until(() => h.relay.of("auth").length === 2, "second auth");
        a.deliver(env);
        await until(() => h.repeats.length === 1, "repeat");
        expect(h.repeats).toEqual([request.id]);
        expect(h.requests).toHaveLength(1);
        // Transport only: the same answer can go out again.
        await h.approver.answer(request.id, { signature });
        const again = a.open(h.relay.sent[1]!);
        expect(again.header.inReplyTo).toEqual(reply.header.inReplyTo);
    });

    it("refuses invalid data, other data, retained requests and keys not granted without asking", async () => {
        const h = harness();
        const a = addAgent(h);
        h.approver.start();
        await connected(h);
        a.request(signRequest(sshsig("")));
        a.request(signRequest(new Uint8Array([1, 2, 3])));
        a.request(
            signRequest(
                sshsig("git"),
                new SSHWriter()
                    .string("ssh-ed25519")
                    .string(new Uint8Array(32))
                    .toBytes(),
            ),
        );
        // Retained, so it could wait for 30 days.
        a.deliver(
            sealEnvelope(
                a.agent,
                identityPeer(h.host.identity),
                { body: { $case: "signRequest", signRequest: signRequest() } },
                { expiresAt: Date.now() + 7 * 24 * 60 * 60_000, retain: true },
            ),
        );
        await until(() => h.relay.sent.length === 4, "refusals");
        expect(refusalsOf(a, h)).toEqual([
            RefusalReason.REFUSAL_REASON_INVALID,
            RefusalReason.REFUSAL_REASON_INVALID,
            RefusalReason.REFUSAL_REASON_KEY_NOT_GRANTED,
            RefusalReason.REFUSAL_REASON_INVALID,
        ]);
        expect(h.requests).toHaveLength(0);
    });

    it("caps waiting requests per agent", async () => {
        const h = harness();
        const a = addAgent(h);
        h.approver.start();
        await connected(h);
        for (let i = 0; i <= MAX_PENDING_PER_AGENT; i++)
            a.request(signRequest());
        await until(() => h.relay.sent.length === 1, "refusal");
        expect(h.requests).toHaveLength(MAX_PENDING_PER_AGENT);
        const body = a.open(h.relay.sent[0]!).message.body;
        expect(body).toMatchObject({
            signResponse: {
                result: { refusal: RefusalReason.REFUSAL_REASON_DENIED },
            },
        });
    });

    it("sends nothing after a request's deadline, and leaves expiry to the host", async () => {
        const h = harness();
        const a = addAgent(h);
        h.approver.start();
        await connected(h);
        a.request(signRequest(), 30);
        await until(() => h.requests.length === 1, "request");
        await new Promise((resolve) => setTimeout(resolve, 60));
        // The approver reports transport facts only; the runtime owns expiry.
        expect(h.gone).toEqual([]);
        expect(h.approver.pendingRequests()).toEqual([]);
        await expect(
            h.approver.answer(h.requests[0]!.id, {
                refusal: RefusalReason.REFUSAL_REASON_DENIED,
            }),
        ).rejects.toBeInstanceOf(RequestGoneError);
    });

    it("sends an answer when the relay is back, unless beforeSend says no", async () => {
        const h = harness();
        const a = addAgent(h);
        h.approver.start();
        await connected(h);
        a.request(signRequest());
        await until(() => h.requests.length === 1, "request");
        h.relay.refuseConnections = true;
        h.relay.last.drop();
        let valid = true;
        const answering = h.approver.answer(
            h.requests[0]!.id,
            { signature: new Uint8Array([42]) },
            { beforeSend: () => valid },
        );
        // The vault locks before the relay is back.
        valid = false;
        h.relay.refuseConnections = false;
        await expect(answering).rejects.toBeInstanceOf(AnswerCancelledError);
        await tick();
        expect(h.relay.sent).toHaveLength(0);
        // Still open: another answer goes out.
        expect(h.approver.pendingRequests()).toEqual([h.requests[0]!.id]);
        await connected(h);
        await h.approver.answer(h.requests[0]!.id, {
            signature: new Uint8Array([43]),
        });
        expect(h.relay.sent).toHaveLength(1);
    });

    it("withdraws a waiting answer when its signal aborts", async () => {
        const h = harness();
        const a = addAgent(h);
        h.approver.start();
        await connected(h);
        a.request(signRequest());
        await until(() => h.requests.length === 1, "request");
        h.relay.refuseConnections = true;
        h.relay.last.drop();
        const abort = new AbortController();
        const answering = h.approver.answer(
            h.requests[0]!.id,
            { signature: new Uint8Array([42]) },
            { signal: abort.signal },
        );
        abort.abort();
        await expect(answering).rejects.toBeInstanceOf(AnswerCancelledError);
        h.relay.refuseConnections = false;
        await connected(h);
        await tick();
        expect(h.relay.sent).toHaveLength(0);
    });

    it("tries a send again when the relay's Result doesn't come, and says so", async () => {
        const h = harness();
        const a = addAgent(h);
        h.approver.start();
        await connected(h);
        a.request(signRequest(), 1_500);
        await until(() => h.requests.length === 1, "request");
        // The relay passes the envelope on but never answers with a Result,
        // and the connection stays up.
        let withheld = 0;
        intercept(h.relay, "send", (socket, frame, pass) => {
            if (withheld++ > 0 || frame.frame?.$case !== "send") return pass();
            h.relay.sent.push(frame.frame.send.envelope!);
            socket.close();
        });
        const progress = { inFlight: false, uncertain: false };
        await h.approver.answer(
            h.requests[0]!.id,
            { signature: new Uint8Array([42]) },
            { progress },
        );
        expect(progress.uncertain).toBe(true);
        expect(h.relay.sent).toHaveLength(2);
    });

    it("hands repeats of a request to the host, and resends its own refusals", async () => {
        const h = harness();
        const a = addAgent(h, []);
        h.approver.start();
        await connected(h);
        const refused = a.request(signRequest());
        await until(() => h.relay.sent.length === 1, "refusal");
        a.deliver(refused);
        await until(() => h.relay.sent.length === 2, "refusal again");
        expect(h.repeats).toEqual([]);
        h.agents[0]!.grantedKeys = [KEY];
        const asked = a.request(signRequest());
        await until(() => h.requests.length === 1, "request");
        a.deliver(asked);
        await until(() => h.repeats.length === 1, "repeat");
        expect(h.repeats).toEqual([h.requests[0]!.id]);
    });

    it("ignores envelopes from unknown agents and tampered ones", async () => {
        const h = harness();
        const a = addAgent(h);
        h.approver.start();
        await connected(h);
        const stranger = generateAgentIdentity();
        h.relay.last.push({
            frame: {
                $case: "deliver",
                deliver: {
                    envelope: sealEnvelope(
                        stranger,
                        identityPeer(h.host.identity),
                        {
                            body: {
                                $case: "signRequest",
                                signRequest: signRequest(),
                            },
                        },
                        { expiresAt: Date.now() + 60_000 },
                    ),
                },
            },
        });
        const genuine = sealEnvelope(
            a.agent,
            identityPeer(h.host.identity),
            { body: { $case: "signRequest", signRequest: signRequest() } },
            { expiresAt: Date.now() + 60_000 },
        );
        // A tampered copy first must not make the genuine one look repeated.
        a.deliver({
            ...genuine,
            ciphertext: genuine.ciphertext.map((b, i) => (i === 0 ? b ^ 1 : b)),
        });
        a.deliver(genuine);
        await until(() => h.requests.length === 1, "request");
        await tick();
        expect(h.requests).toHaveLength(1);
    });

    it("withdraws requests of a revoked agent", async () => {
        const h = harness();
        const a = addAgent(h);
        h.approver.start();
        await connected(h);
        a.request(signRequest());
        await until(() => h.requests.length === 1, "request");
        await h.approver.unregister(a.id);
        await until(() => h.revoked.length === 1, "revoked");
        expect(h.gone).toEqual([h.requests[0]!.id]);
        expect(h.relay.registered.has(a.id)).toBe(false);
    });

    it("reports agents missing from Ready as revoked", async () => {
        const h = harness();
        const a = addAgent(h);
        h.relay.readyAgents = [];
        h.approver.start();
        await until(() => h.revoked.length === 1, "revoked");
        expect(h.revoked).toEqual([a.id]);
    });

    it("refuses RSA requests that would make a SHA-1 signature", async () => {
        const h = harness();
        const rsa = new SSHWriter()
            .string("ssh-rsa")
            .mpint(65537n)
            .mpint((1n << 2047n) + 1n)
            .toBytes();
        const a = addAgent(h, [rsa]);
        h.approver.start();
        await connected(h);
        a.request({ ...signRequest(sshsig("git"), rsa), flags: 0 });
        await until(() => h.relay.sent.length === 1, "refusal");
        expect(refusalsOf(a, h)).toEqual([
            RefusalReason.REFUSAL_REASON_INVALID,
        ]);
        a.request({ ...signRequest(sshsig("git"), rsa), flags: 4 });
        await until(() => h.requests.length === 1, "request");
    });

    it("tells the host when Ready lists an agent again", async () => {
        const h = harness();
        const a = addAgent(h);
        const listed: string[] = [];
        h.host.onRelayListedAgent = (id) => listed.push(id);
        h.approver.start();
        await until(() => listed.length === 1, "listed");
        expect(listed).toEqual([a.id]);
        expect(h.revoked).toEqual([]);
    });
});

describe("Approver before PairingConfirm", () => {
    it("ignores sign requests from an agent that hasn't confirmed", async () => {
        const h = harness();
        h.approver.start();
        const { agent, text } = pairingSlot(h.relay);
        const claim = await h.approver.claim(text);
        await h.approver.accept(claim, {
            agentName: "box",
            keys: [{ publicKey: KEY, comment: "k" }],
        });
        const me = identityPeer(h.host.identity);
        const deliver = (envelope: ReturnType<typeof sealEnvelope>) =>
            h.relay.last.push({
                frame: { $case: "deliver", deliver: { envelope } },
            });
        const seal = (body: Parameters<typeof sealEnvelope>[2]) =>
            sealEnvelope(agent, me, body, { expiresAt: Date.now() + 60_000 });
        const early = seal({
            body: { $case: "signRequest", signRequest: signRequest() },
        });
        deliver(early);
        await until(() => h.relay.of("ack").length === 1, "ack");
        expect(h.requests).toHaveLength(0);
        deliver(
            seal({
                body: {
                    $case: "pairingConfirm",
                    pairingConfirm: { agentVersion: "0.1.0" },
                },
            }),
        );
        await until(() => h.confirmed.length === 1, "confirm");
        deliver(
            seal({
                body: { $case: "signRequest", signRequest: signRequest() },
            }),
        );
        await until(() => h.requests.length === 1, "request");
        // The agent resends the ignored request after a reconnect: now it
        // counts, rather than looking like a repeat of an answered one.
        deliver(early);
        await until(() => h.requests.length === 2, "the resent request");
        expect(h.requests[1]!.id).toBe(
            uint8ToBase64Url(parseEnvelopeHeader(early).messageId),
        );
    });
});

describe("Approver key updates and passes", () => {
    it("sends a retained KeysUpdate", async () => {
        const h = harness();
        const a = addAgent(h);
        h.approver.start();
        await h.approver.sendKeys(a.id, {
            agentName: "renamed",
            keys: [{ publicKey: KEY, comment: "Work" }],
            revision: 4,
        });
        const opened = a.open(h.relay.sent[0]!);
        expect(opened.header.retain).toBe(true);
        expect(opened.header.expiresAt).toBeGreaterThan(
            Date.now() + 29 * 24 * 3600_000,
        );
        expect(opened.message.body).toEqual({
            $case: "keysUpdate",
            keysUpdate: {
                keys: [{ publicKey: KEY, comment: "Work" }],
                revision: 4,
                agentName: "renamed",
            },
        });
    });

    it("hands the hosted relay a newer pass on refresh", async () => {
        const hosted: RelayTarget = {
            kind: "hosted",
            url: "https://relay.cryptex-vault.com",
        };
        const h = harness({ relays: [hosted] });
        h.passes.push(fakePass(1_900_000_000));
        h.approver.start();
        await connected(h);
        h.approver.refresh();
        await tick();
        expect(h.relay.of("renewPass")).toHaveLength(0);
        h.passes.push(fakePass(1_900_100_000));
        h.approver.refresh();
        await until(() => h.relay.of("renewPass").length === 1, "renew");
        expect(h.relay.of("renewPass")[0]!.frame).toEqual({
            $case: "renewPass",
            renewPass: { pass: h.passes[1] },
        });
    });

    it("waits for a pass before connecting to the hosted relay", async () => {
        const hosted: RelayTarget = {
            kind: "hosted",
            url: "https://relay.cryptex-vault.com",
        };
        const h = harness({ relays: [hosted] });
        h.approver.start();
        await new Promise((r) => setTimeout(r, 50));
        expect(h.relay.sockets).toHaveLength(0);
        h.passes.push(fakePass(1_900_000_000));
        h.approver.refresh();
        await connected(h);
    });
});

describe("revokeOverHttp", () => {
    it("posts a signed RevokeRequest for the relay origin", async () => {
        const seed = ed25519.utils.randomSecretKey();
        const agentKey = crypto.getRandomValues(new Uint8Array(32));
        const calls: { url: string; init: RequestInit }[] = [];
        const fakeFetch = (async (url: string, init: RequestInit) => {
            calls.push({ url, init });
            return new Response(null, { status: 204 });
        }) as unknown as typeof fetch;
        const status = await revokeOverHttp(
            "https://Relay.example.com:443/base/",
            seed,
            agentKey,
            fakeFetch,
            1_800_000_000_000,
        );
        expect(status).toBe(204);
        expect(calls[0]!.url).toBe(
            "https://Relay.example.com:443/base/v1/revoke",
        );
        expect(calls[0]!.init.method).toBe("POST");
        expect(
            (calls[0]!.init.headers as Record<string, string>)["Content-Type"],
        ).toBe("application/x-protobuf");
        const body = RevokeRequest.decode(calls[0]!.init.body as Uint8Array);
        expect(body.agentKey).toEqual(agentKey);
        expect(body.issuedAt).toBe(1_800_000_000_000);
        expect(
            ed25519.verify(
                body.signature,
                revokeInput(
                    "https://relay.example.com",
                    agentKey,
                    body.issuedAt,
                ),
                ed25519.getPublicKey(seed),
            ),
        ).toBe(true);
    });
});

describe("an approval waiting for the relay connection", () => {
    async function approving(choice: "once" | "process" = "once") {
        const t = await runtimeOnRelay();
        t.send();
        await until(() => t.runtime.waitingCount() === 1, "request");
        const id = t.runtime.pendingRequests()[0]!.id;
        t.disconnect();
        const result = t.runtime.approve(id, choice).then(
            () => "approved",
            (error: unknown) => error,
        );
        await tick();
        return { ...t, id, result };
    }

    it("gives way to Deny: only the refusal goes out", async () => {
        const t = await approving("process");
        const denying = t.runtime.deny(t.id);
        await t.reconnect();
        await denying;
        await expect(t.result).resolves.toBeInstanceOf(RequestGoneError);
        await until(() => t.relay.sent.length > 0, "refusal");
        await tick();
        expect(t.replies()).toEqual(["refusal"]);
        expect(t.outcomes()).toEqual([AgentRequestOutcome.AgentOutcomeDenied]);
        expect(t.runtime.remembered.size).toBe(0);
    });

    it("gives way to a pause synced from another device", async () => {
        const t = await approving();
        t.state.paused = true;
        const reloading = t.runtime.reload();
        await t.reconnect();
        await reloading;
        await expect(t.result).resolves.toBeInstanceOf(RequestGoneError);
        await until(() => t.relay.sent.length > 0, "refusal");
        await tick();
        expect(t.replies()).toEqual(["refusal"]);
        expect(t.outcomes()).toEqual([AgentRequestOutcome.AgentOutcomeRefused]);
    });

    it("sends nothing after a lock and keeps the request waiting for the next unlock", async () => {
        const t = await approving();
        t.runtime.setLocking(true);
        t.state.unlocked = false;
        await expect(t.result).resolves.toBeInstanceOf(VaultLockedError);
        await t.reconnect();
        await tick();
        expect(t.replies()).toEqual([]);
        expect(t.runtime.getRequest(t.id)).toBeDefined();
        t.state.unlocked = true;
        await t.runtime.onVaultUnlocked();
        await t.runtime.approve(t.id);
        expect(t.replies()).toEqual(["signature"]);
        expect(t.outcomes()).toEqual([
            AgentRequestOutcome.AgentOutcomeApproved,
        ]);
    });

    it("records only Expired when the request runs out first", async () => {
        const t = await runtimeOnRelay();
        t.send(300);
        await until(() => t.runtime.waitingCount() === 1, "request");
        const id = t.runtime.pendingRequests()[0]!.id;
        t.disconnect();
        const result = t.runtime.approve(id).catch((error: unknown) => error);
        await expect(result).resolves.toBeInstanceOf(RequestGoneError);
        await t.reconnect();
        await tick();
        expect(t.replies()).toEqual([]);
        expect(t.outcomes()).toEqual([AgentRequestOutcome.AgentOutcomeExpired]);
    });

    it("doesn't resend a signature to a repeated request after the lock", async () => {
        const t = await runtimeOnRelay();
        const envelope = t.send();
        await until(() => t.runtime.waitingCount() === 1, "request");
        await t.runtime.approve(t.runtime.pendingRequests()[0]!.id);
        await until(() => t.relay.sent.length === 1, "signature");
        t.runtime.setLocking(true);
        t.state.unlocked = false;
        t.relay.last.push({
            frame: { $case: "deliver", deliver: { envelope } },
        });
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(t.replies()).toEqual(["signature"]);
    });
});
