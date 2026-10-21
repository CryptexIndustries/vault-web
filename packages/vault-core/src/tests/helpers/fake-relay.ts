/**
 * Fakes for the agent tests: a relay behind a fake WebSocket, the real
 * runtime and approver over it, and runtime dependencies without a relay.
 * The real Go relay and agent are in agent-integration.test.ts.
 */
import { uint8ToBase64, uint8ToBase64Url } from "../../encoding";
import { SSHWriter } from "../../internal/ssh/wire";
import {
    ClientFrame,
    Envelope,
    PairingOffer,
    Role,
    ServerFrame,
    Status,
    type SignRequest,
} from "../../proto/agent";
import {
    AgentRequestOutcome,
    type AgentRequestRecord,
} from "../../proto/vault";
import { Approver } from "../../agent/approver";
import type {
    IncomingRequest,
    RequestCheck,
    WebSocketLike,
} from "../../agent/approver-types";
import {
    generateAgentIdentity,
    identityPeer,
    openEnvelope,
    sealEnvelope,
} from "../../agent/envelope";
import { formatPairingCode, offerHash } from "../../agent/pairing";
import { Backoff } from "../../agent/relay-client";
import {
    AgentRuntime,
    type ApproverPort,
    type CachedAgent,
    type LocalAgentApproval,
    type RuntimeDeps,
} from "../../agent/runtime";

export const RELAY_URL = "https://relay.example.com";
export const ORIGIN = "https://relay.example.com";
export const TOKEN = "relay-token";

export const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

export async function until(cond: () => boolean, what = "condition") {
    for (let i = 0; i < 400; i++) {
        if (cond()) return;
        await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error(`timed out waiting for ${what}`);
}

export class FakeSocket implements WebSocketLike {
    binaryType = "blob";
    readyState = 0;
    protocol = "cryptex-agent.v1";
    onopen: ((ev: unknown) => void) | null = null;
    onclose: ((ev: { code: number; reason: string }) => void) | null = null;
    onerror: ((ev: unknown) => void) | null = null;
    onmessage:
        | ((ev: { data: ArrayBuffer | Uint8Array | string }) => void)
        | null = null;

    constructor(
        private readonly relay: FakeRelay,
        readonly url: string,
        readonly protocols: string[],
    ) {
        void Promise.resolve().then(() => {
            if (relay.refuseConnections) {
                this.readyState = 3;
                this.onerror?.({});
                this.onclose?.({ code: 1006, reason: "" });
                return;
            }
            this.readyState = 1;
            this.onopen?.({});
            this.push({
                frame: {
                    $case: "challenge",
                    challenge: {
                        protocolVersion: 1,
                        nonce: (this.nonce = crypto.getRandomValues(
                            new Uint8Array(32),
                        )),
                        keepaliveSeconds: relay.keepaliveSeconds,
                        serverTime: Date.now(),
                    },
                },
            });
        });
    }

    nonce = new Uint8Array(0);

    send(data: Uint8Array): void {
        const frame = ClientFrame.decode(data);
        void Promise.resolve().then(() => this.relay.handle(this, frame));
    }

    close(code = 1000): void {
        if (this.readyState === 3) return;
        this.readyState = 3;
        void Promise.resolve().then(() => this.onclose?.({ code, reason: "" }));
    }

    push(frame: ServerFrame): void {
        if (this.readyState !== 1) return;
        this.onmessage?.({ data: ServerFrame.encode(frame).finish() });
    }

    /** The relay goes away. */
    drop(): void {
        this.readyState = 3;
        this.onclose?.({ code: 1006, reason: "" });
    }
}

export type Slot = { offer: Uint8Array; expiresAt: number };

export class FakeRelay {
    sockets: FakeSocket[] = [];
    frames: ClientFrame[] = [];
    /** The socket each frame came on. */
    socketOf = new Map<ClientFrame, FakeSocket>();
    sent: Envelope[] = [];
    registered = new Map<string, Uint8Array>();
    slots = new Map<string, Slot>();
    keepaliveSeconds = 240;
    authError: { status: Status; message: string } | null = null;
    readyAgents: Uint8Array[] | null = null;
    refuseConnections = false;

    open = (url: string, protocols: string[]): WebSocketLike => {
        const socket = new FakeSocket(this, url, protocols);
        this.sockets.push(socket);
        return socket;
    };

    get last(): FakeSocket {
        return this.sockets[this.sockets.length - 1]!;
    }

    of<C extends NonNullable<ClientFrame["frame"]>["$case"]>(c: C) {
        return this.frames.filter((f) => f.frame?.$case === c);
    }

    /** Answers frame with a Result. */
    result(
        socket: FakeSocket,
        frame: ClientFrame,
        status = Status.STATUS_OK,
        message = "",
    ): void {
        socket.push({
            frame: {
                $case: "result",
                result: { id: frame.id, status, message },
            },
        });
    }

    handle(socket: FakeSocket, frame: ClientFrame): void {
        this.frames.push(frame);
        this.socketOf.set(frame, socket);
        const result = (status = Status.STATUS_OK) =>
            this.result(socket, frame, status);
        const f = frame.frame;
        switch (f?.$case) {
            case "auth":
                if (this.authError) {
                    socket.push({
                        frame: { $case: "error", error: this.authError },
                    });
                    socket.close();
                    return;
                }
                socket.push({
                    frame: {
                        $case: "ready",
                        ready: {
                            role: Role.ROLE_APPROVER,
                            passExpiresAt: 0,
                            agents:
                                this.readyAgents ??
                                [...this.registered.keys()].map(fromId),
                        },
                    },
                });
                return;
            case "ping":
                socket.push({ frame: { $case: "pong", pong: {} } });
                return;
            case "registerAgent":
                this.registered.set(
                    uint8ToBase64Url(f.registerAgent.agentKey),
                    f.registerAgent.revocationKey,
                );
                return result();
            case "unregisterAgent":
                this.registered.delete(
                    uint8ToBase64Url(f.unregisterAgent.agentKey),
                );
                result();
                socket.push({
                    frame: {
                        $case: "revoked",
                        revoked: { agentKey: f.unregisterAgent.agentKey },
                    },
                });
                return;
            case "claimSlot": {
                const slot = this.slots.get(
                    uint8ToBase64Url(f.claimSlot.slotId),
                );
                if (!slot) return result(Status.STATUS_NOT_FOUND);
                socket.push({
                    frame: {
                        $case: "slotOffer",
                        slotOffer: {
                            id: frame.id,
                            offer: slot.offer,
                            expiresAt: slot.expiresAt,
                        },
                    },
                });
                return;
            }
            case "send":
                this.sent.push(f.send.envelope!);
                return result();
            case "answerSlot":
            case "renewPass":
                return result();
        }
    }
}

type FrameCase = NonNullable<ClientFrame["frame"]>["$case"];

/**
 * Frames of kind go to override instead of the relay; pass() hands the
 * frame to the relay after all.
 */
export function intercept(
    relay: FakeRelay,
    kind: FrameCase,
    override: (
        socket: FakeSocket,
        frame: ClientFrame,
        pass: () => void,
    ) => void,
) {
    const handle = relay.handle.bind(relay);
    relay.handle = (socket, frame) =>
        frame.frame?.$case === kind
            ? override(socket, frame, () => handle(socket, frame))
            : handle(socket, frame);
}

/** A pairing slot on the relay for a new agent, and its pairing code. */
export function pairingSlot(
    relay: FakeRelay,
    {
        relayUrl = RELAY_URL,
        expiresIn = 180_000,
        kemPublicKey,
    }: {
        relayUrl?: string;
        expiresIn?: number;
        kemPublicKey?: Uint8Array;
    } = {},
) {
    const agent = generateAgentIdentity();
    const peer = identityPeer(agent);
    const offer = PairingOffer.encode({
        protocolVersion: 1,
        signPublicKey: peer.signPublicKey,
        kemPublicKey: kemPublicKey ?? peer.kemPublicKey,
        hostname: "arch-desktop",
        os: "linux",
        arch: "amd64",
        agentVersion: "0.1.0",
    }).finish();
    const slotId = crypto.getRandomValues(new Uint8Array(16));
    relay.slots.set(uint8ToBase64Url(slotId), {
        offer,
        expiresAt: Date.now() + expiresIn,
    });
    const code = {
        version: 1,
        relayUrl,
        slotId,
        secret: crypto.getRandomValues(new Uint8Array(32)),
        offerHash: offerHash(offer),
    };
    return {
        agent,
        peer,
        id: uint8ToBase64Url(peer.signPublicKey),
        code,
        text: formatPairingCode(code),
    };
}

export const fromId = (id: string) =>
    Uint8Array.from(Buffer.from(id, "base64url"));

export function sshsig(namespace: string): Uint8Array {
    const body = new SSHWriter()
        .string(namespace)
        .string("")
        .string("sha512")
        .string(new Uint8Array(64))
        .toBytes();
    return new Uint8Array([...new TextEncoder().encode("SSHSIG"), ...body]);
}

export const KEY = new SSHWriter()
    .string("ssh-ed25519")
    .string(new Uint8Array(32).fill(7))
    .toBytes();

export function signRequest(
    data = sshsig("git"),
    publicKey = KEY,
): SignRequest {
    return {
        publicKey,
        data,
        flags: 0,
        processes: [],
        sessionBinds: [],
        hostname: "arch-desktop",
    };
}

/** Approvers and runtimes the helpers started; cleanupRelayHarness stops them. */
export const liveApprovers: Approver[] = [];
const liveRuntimes: AgentRuntime[] = [];

export function cleanupRelayHarness() {
    for (const runtime of liveRuntimes.splice(0)) runtime.stop();
    for (const approver of liveApprovers.splice(0)) approver.stop();
}

/** A git commit -S request: remembered "process" rules apply to it. */
export function gitSignRequest(): SignRequest {
    return {
        ...signRequest(),
        processes: [
            {
                pid: 10,
                uid: 1000,
                exe: "/usr/bin/git",
                args: ["git", "commit", "-S"],
                cwd: "/src",
            },
        ],
    };
}

/**
 * The real runtime and approver over the fake relay, with one paired agent
 * granted KEY. state switches the vault lock, pause and grant; deps
 * overrides runtime dependencies.
 */
export async function runtimeOnRelay(
    deps: Partial<RuntimeDeps> = {},
    { withAgent = true }: { withAgent?: boolean } = {},
) {
    const relay = new FakeRelay();
    const agent = generateAgentIdentity();
    const peer = identityPeer(agent);
    const agentId = uint8ToBase64Url(peer.signPublicKey);
    relay.registered.set(agentId, new Uint8Array(32));
    const identity = generateAgentIdentity();
    const approverPeer = identityPeer(identity);
    const history: AgentRequestRecord[] = [];
    /** paused: the cache's flag; livePaused: the live vault record's. */
    const state = {
        unlocked: true,
        paused: false,
        livePaused: false,
        granted: true,
    };
    /** More agents in the cache (one being paired, say). */
    const extraAgents: CachedAgent[] = [];
    /** Agents besides the first whose key the vault grants. */
    const grants = new Set<string>();
    /** Records saved in the vault that the cache doesn't show yet. */
    const savedRecords = new Set<string>();
    const local: LocalAgentApproval[] = withAgent
        ? [{ agentId, keys: [uint8ToBase64(KEY)] }]
        : [];
    let saveGate: Promise<void> | null = null;
    let historyGate: Promise<void> | null = null;
    const cached = (): CachedAgent => ({
        id: agentId,
        name: "box",
        signPublicKey: uint8ToBase64(peer.signPublicKey),
        kemPublicKey: uint8ToBase64(peer.kemPublicKey),
        relayOrigin: RELAY_URL,
        grantedKeys: [uint8ToBase64(KEY)],
        paused: state.paused,
    });
    const appendHistory = async (entries: AgentRequestRecord[]) => {
        if (historyGate) await historyGate;
        // Locked: the runtime queues it for the next unlock.
        if (!state.unlocked) return false;
        history.push(...entries);
        return true;
    };
    let approver: Approver | null = null;
    const runtime = new AgentRuntime({
        createApprover: (host) => {
            approver = new Approver(host, {
                backoff: () => new Backoff(10, 40),
            });
            liveApprovers.push(approver);
            return approver;
        },
        loadIdentity: async () => identity,
        deviceName: () => "Pixel",
        loadAgentCache: async () => [
            ...(withAgent ? [cached()] : []),
            ...extraAgents,
        ],
        loadCustomRelays: async () => [{ origin: RELAY_URL, token: TOKEN }],
        localApprovals: {
            load: async () => structuredClone(local),
            save: async (next) => {
                if (saveGate) await saveGate;
                local.splice(0, local.length, ...next);
            },
        },
        hostedRelayUrl: "https://relay.cryptex-vault.com",
        getPass: async () => null,
        vault: {
            canSign: () => state.unlocked,
            grantedKey: (id) =>
                !state.unlocked
                    ? "locked"
                    : state.granted && (id === agentId || grants.has(id))
                      ? {
                            credentialId: "cred",
                            name: "key",
                            sshKey: {} as never,
                        }
                      : null,
            isPaused: (id) => id === agentId && state.livePaused,
            // Saved records: the first agent, cached ones, and savedRecords.
            hasAgentRecord: (id) =>
                (withAgent && id === agentId) ||
                extraAgents.some((agent) => agent.id === id) ||
                savedRecords.has(id),
            appendHistory: (_agentId, entry) => appendHistory([entry]),
            appendHistoryEntries: (_agentId, entries) => appendHistory(entries),
        },
        sign: async () => new Uint8Array([42]),
        ui: {
            isForeground: () => true,
            openRequest: () => undefined,
            showNotification: () => undefined,
            cancelNotification: () => undefined,
        },
        openWebSocket: relay.open,
        fetch,
        ...deps,
    });
    liveRuntimes.push(runtime);
    await runtime.reload();
    const up = () =>
        until(
            () => relay.of("auth").length > 0 && relay.last.readyState === 1,
            "connected",
        );
    // No agent: nothing connects until a pairing starts.
    if (withAgent) await up();
    /** The agent sends a sign request; returns its envelope (for repeats). */
    const send = (expiresIn = 90_000, sign: SignRequest = signRequest()) => {
        const envelope = sealEnvelope(
            agent,
            approverPeer,
            { body: { $case: "signRequest", signRequest: sign } },
            { expiresAt: Date.now() + expiresIn },
        );
        relay.last.push({ frame: { $case: "deliver", deliver: { envelope } } });
        return envelope;
    };
    const redeliver = (envelope: Envelope) =>
        relay.last.push({ frame: { $case: "deliver", deliver: { envelope } } });
    /** Answers to this agent (envelopes to other agents are skipped). */
    const replies = () =>
        relay.sent.flatMap((envelope) => {
            try {
                const body = openEnvelope(agent, approverPeer, envelope).message
                    .body;
                return [
                    body?.$case === "signResponse"
                        ? body.signResponse.result?.$case
                        : body?.$case,
                ];
            } catch {
                return [];
            }
        });
    return {
        relay,
        runtime,
        approver: () => approver!,
        agent,
        agentId,
        approverPeer,
        history,
        state,
        send,
        redeliver,
        replies,
        outcomes: () => history.map((entry) => entry.Outcome),
        extraAgents,
        grants,
        savedRecords,
        local,
        /** History writes wait until the returned function runs. */
        holdHistory: () => {
            let release: () => void = () => undefined;
            historyGate = new Promise<void>((resolve) => {
                release = () => {
                    historyGate = null;
                    resolve();
                };
            });
            return () => release();
        },
        /** Local-approval saves wait until the returned function runs. */
        holdSaves: () => {
            let release: () => void = () => undefined;
            saveGate = new Promise<void>((resolve) => {
                release = () => {
                    saveGate = null;
                    resolve();
                };
            });
            return () => release();
        },
        /** The relay goes away and stays away until reconnect(). */
        disconnect: () => {
            relay.refuseConnections = true;
            relay.last.drop();
        },
        reconnect: async () => {
            const auths = relay.of("auth").length;
            relay.refuseConnections = false;
            await until(
                () =>
                    relay.of("auth").length > auths &&
                    relay.last.readyState === 1,
                "reconnect",
            );
        },
    };
}

/** An approver that does nothing; claim and accept throw. */
export function fakeApprover(
    overrides: Partial<ApproverPort> = {},
): ApproverPort {
    return {
        start: () => undefined,
        stop: () => undefined,
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
        ...overrides,
    };
}

/** Runtime deps for one agent "agent-a" granted KEY, locked, without a relay. */
export function fakeRuntimeDeps(
    overrides: Partial<RuntimeDeps> = {},
): RuntimeDeps {
    return {
        createApprover: () => fakeApprover(),
        loadIdentity: async () => ({
            signSeed: new Uint8Array(32),
            kemSeed: new Uint8Array(32),
        }),
        deviceName: () => "Pixel",
        loadAgentCache: async () => [
            {
                id: "agent-a",
                name: "workstation",
                signPublicKey: "",
                kemPublicKey: "",
                relayOrigin: "",
                grantedKeys: [uint8ToBase64(KEY)],
            },
        ],
        loadCustomRelays: async () => [],
        localApprovals: {
            load: async () => [
                { agentId: "agent-a", keys: [uint8ToBase64(KEY)] },
            ],
            save: async () => undefined,
        },
        hostedRelayUrl: "https://relay.cryptex-vault.com",
        getPass: async () => null,
        vault: {
            hasAgentRecord: () => false,
            isPaused: () => false,
            canSign: () => false,
            grantedKey: () => "locked",
            appendHistory: async () => true,
            appendHistoryEntries: async () => true,
        },
        sign: async () => new Uint8Array([42]),
        ui: {
            isForeground: () => false,
            openRequest: () => undefined,
            showNotification: () => undefined,
            cancelNotification: () => undefined,
        },
        openWebSocket: () => {
            throw new Error("unused");
        },
        fetch: (() => undefined) as never,
        ...overrides,
    };
}

export const loginCheck = (
    overrides: Partial<RequestCheck> = {},
): RequestCheck => ({
    kind: "login",
    user: "git",
    verifiedHost: {
        hostKey: new Uint8Array(1),
        fingerprint: "SHA256:host",
        names: ["github.com"],
    },
    forwardedVia: [],
    destinationUnknown: false,
    ...overrides,
});

let nextRequestId = 0;

/** A verified login from agent-a with KEY, made by git push (git, then ssh). */
export function incomingRequest(
    overrides: Partial<IncomingRequest> & { exe?: string; pid?: number } = {},
): IncomingRequest {
    const { exe = "/usr/bin/git", pid = 100, ...rest } = overrides;
    return {
        id: `r${++nextRequestId}`,
        agentId: "agent-a",
        receivedAt: Date.now(),
        expiresAt: Date.now() + 90_000,
        sign: {
            publicKey: KEY,
            data: new Uint8Array([7]),
            flags: 0,
            processes: [
                {
                    pid: pid + 1,
                    uid: 1000,
                    exe: "/usr/bin/ssh",
                    args: ["ssh", "git@github.com"],
                    cwd: "/home/u",
                },
                {
                    pid,
                    uid: 1000,
                    exe,
                    args: ["git", "push"],
                    cwd: "/home/u/src",
                },
            ],
            sessionBinds: [],
            hostname: "box",
        },
        check: loginCheck(),
        ...rest,
    };
}

export { AgentRequestOutcome };
