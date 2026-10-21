/**
 * @jest-environment node
 *
 * Cancelling a pairing the agent hasn't confirmed unregisters the agent on
 * the relay, also when no other agent keeps the approver running and when
 * the dashboard is torn down (the host disposed first). Otherwise the
 * registration stays there, counting against the relay's agent limit, with
 * no record here to remove it. Real WebAgentHost, AgentRuntime and
 * Approver over the fake relay.
 */
import { describe, expect, it } from "@jest/globals";
import { webcrypto } from "crypto";
import { Vault } from "@cryptex-industries/vault-core/vault-utils/vault";
import {
    generateAgentIdentity,
    identityPeer,
} from "@cryptex-industries/vault-core/agent/envelope";
import { Approver } from "@cryptex-industries/vault-core/agent/approver";
import {
    formatPairingCode,
    offerHash,
} from "@cryptex-industries/vault-core/agent/pairing";
import {
    PairingOffer,
    Status,
    type ClientFrame,
} from "@cryptex-industries/vault-core/proto/agent";
import { uint8ToBase64Url } from "@cryptex-industries/vault-core/encoding";
import { WebAgentHost } from "@/app_lib/agent/web-agent-host";
import { FakeLocks } from "../helpers/fake-locks";
import {
    FakeRelay,
    KEY,
    RELAY_URL,
    TOKEN,
    tick,
    until,
    type FakeSocket,
} from "../../../packages/vault-core/src/tests/helpers/fake-relay";

if (!globalThis.crypto)
    Object.defineProperty(globalThis, "crypto", { value: webcrypto });

/**
 * Lets `override` see each frame first; it returns true for the frames it
 * took over, and `pass` hands one on to the relay.
 */
function intercept(
    relay: FakeRelay,
    override: (
        socket: FakeSocket,
        frame: ClientFrame,
        pass: () => void,
    ) => boolean,
) {
    const handle = relay.handle.bind(relay);
    relay.handle = (socket, frame) => {
        const pass = () => handle(socket, frame);
        if (!override(socket, frame, pass)) pass();
    };
}

/** The relay commits a RegisterAgent (of `only`, if given) but sends no Result. */
function registerWithoutResult(
    relay: FakeRelay,
    frame: ClientFrame,
    only?: string,
): boolean {
    const inner = frame.frame;
    if (inner?.$case !== "registerAgent") return false;
    const agentId = uint8ToBase64Url(inner.registerAgent.agentKey);
    if (only && agentId !== only) return false;
    relay.frames.push(frame);
    relay.registered.set(agentId, inner.registerAgent.revocationKey);
    return true;
}

const outcome = (step: Promise<unknown>) =>
    step.then(
        () => null,
        (error: unknown) => error,
    );

/** A relay that refuses new agents past `limit`, like RELAY_MAX_AGENTS. */
function limitedRelay(limit: number, { dropUnregister = false } = {}) {
    const relay = new FakeRelay();
    intercept(relay, (socket, frame) => {
        const inner = frame.frame;
        if (dropUnregister && inner?.$case === "unregisterAgent") {
            relay.frames.push(frame);
            return true; // never answered
        }
        if (
            inner?.$case !== "registerAgent" ||
            relay.registered.has(
                uint8ToBase64Url(inner.registerAgent.agentKey),
            ) ||
            relay.registered.size < limit
        )
            return false;
        relay.frames.push(frame);
        socket.push({
            frame: {
                $case: "result",
                result: {
                    id: frame.id,
                    status: Status.STATUS_LIMIT_REACHED,
                    message: "the agent limit for this account is reached",
                },
            },
        });
        return true;
    });
    return relay;
}

function setup({
    limit = Infinity,
    dropUnregister = false,
    locks = new FakeLocks(),
} = {}) {
    let vault = new Vault();
    const identity = generateAgentIdentity();
    vault.AgentApprover = {
        SignSeed: identity.signSeed,
        KEMSeed: identity.kemSeed,
        CustomRelays: [{ Origin: RELAY_URL, Token: TOKEN }],
        RelayPass: "",
        RelayPassExpiresAt: 0,
        ApprovedAgents: [],
    };
    const relay = limitedRelay(limit, { dropUnregister });
    const host = new WebAgentHost({
        getVault: () => vault,
        canSign: () => true,
        persist: async (_kind, mutate) => {
            vault = await mutate(vault);
            return true;
        },
        hostedRelayUrl: "https://hosted.example.com",
        deviceName: () => "browser",
        requestPass: async () => null,
        locks,
        notifications: {
            show: () => undefined,
            close: () => undefined,
            closeAll: () => undefined,
        },
        isVisible: () => true,
        focusWindow: () => undefined,
        createApprover: (host) => new Approver(host),
        openWebSocket: relay.open,
        fetch: globalThis.fetch,
        sign: async () => new Uint8Array(),
        cancelPairingMs: 200,
    });
    host.sync();
    return { host, relay, vault: () => vault };
}

/** The connect dialog up to the claimed code (accept not pressed yet). */
async function claimCode(host: WebAgentHost, relay: FakeRelay) {
    const end = await host.beginPairing();
    const peer = identityPeer(generateAgentIdentity());
    const agentId = uint8ToBase64Url(peer.signPublicKey);
    const slotId = crypto.getRandomValues(new Uint8Array(16));
    const offer = PairingOffer.encode(
        PairingOffer.fromPartial({
            protocolVersion: 1,
            signPublicKey: peer.signPublicKey,
            kemPublicKey: peer.kemPublicKey,
        }),
    ).finish();
    relay.slots.set(uint8ToBase64Url(slotId), {
        offer,
        expiresAt: Date.now() + 180_000,
    });
    const claim = await host.claim(
        formatPairingCode({
            version: 1,
            relayUrl: RELAY_URL,
            slotId,
            secret: new Uint8Array(32).fill(1),
            offerHash: offerHash(offer),
        }),
    );
    return { end, agentId, claim };
}

/** The connect dialog up to the confirmation code. */
async function answer(host: WebAgentHost, relay: FakeRelay) {
    const { end, agentId, claim } = await claimCode(host, relay);
    await host.accept(claim, {
        agentName: "new box",
        keys: [{ publicKey: KEY, comment: "key" }],
    });
    expect(relay.registered.has(agentId)).toBe(true);
    return { end, agentId };
}

/** The dialog's cleanup on Cancel: start the cancel, end the hold. */
async function cancel(
    host: WebAgentHost,
    pairing: { end: () => void; agentId: string },
) {
    const cancelling = host.cancelPairing(pairing.agentId);
    pairing.end();
    await cancelling;
    for (let i = 0; i < 5; i++) await tick();
}

describe("cancelling a pairing", () => {
    it("unregisters the agent before the hold stops the approver", async () => {
        const t = setup({ limit: 1 });
        try {
            const first = await answer(t.host, t.relay);
            await cancel(t.host, first);
            expect(t.relay.of("unregisterAgent")).toHaveLength(1);
            expect(t.relay.registered.has(first.agentId)).toBe(false);
            // No agent left here: the approver stopped afterwards.
            expect(t.host.isLeader).toBe(false);
            expect(t.vault().ConnectedAgents ?? []).toHaveLength(0);
            // The relay's one slot is free for the next machine.
            const second = await answer(t.host, t.relay);
            expect(t.relay.registered.size).toBe(1);
            await cancel(t.host, second);
            expect(t.relay.registered.size).toBe(0);
        } finally {
            t.host.dispose();
        }
    });

    it("leaves nothing behind after many cancellations", async () => {
        const t = setup({ limit: 25 });
        try {
            for (let i = 0; i < 25; i++)
                await cancel(t.host, await answer(t.host, t.relay));
            expect(t.relay.registered.size).toBe(0);
            await answer(t.host, t.relay);
        } finally {
            t.host.dispose();
        }
    }, 20_000);

    it("unregisters on dashboard teardown, without leading again afterwards", async () => {
        const locks = new FakeLocks();
        const t = setup({ locks });
        const pairing = await answer(t.host, t.relay);
        // The dashboard unmounts: the host is disposed before the dialog's
        // cleanup runs.
        t.host.dispose();
        await cancel(t.host, pairing);
        expect(t.relay.of("unregisterAgent")).toHaveLength(1);
        expect(t.relay.registered.has(pairing.agentId)).toBe(false);
        expect(t.host.isLeader).toBe(false);
        // The approver lock is free for another tab.
        expect((locks as unknown as { holder: unknown }).holder).toBeNull();
    });

    it("stops waiting for a relay that never answers, then lets the approver stop", async () => {
        const t = setup({ dropUnregister: true });
        try {
            const pairing = await answer(t.host, t.relay);
            const cancelling = t.host.cancelPairing(pairing.agentId);
            pairing.end();
            await tick();
            // Still up while the unregister waits.
            expect(t.host.isLeader).toBe(true);
            await cancelling;
            for (let i = 0; i < 5; i++) await tick();
            expect(t.relay.of("unregisterAgent")).toHaveLength(1);
            expect(t.host.isLeader).toBe(false);
        } finally {
            t.host.dispose();
        }
    });

    it("keeps a confirmed agent registered when the dashboard goes away during its save", async () => {
        const t = setup();
        const pairing = await answer(t.host, t.relay);
        // The agent confirmed: the dialog is saving its record now.
        (t.host as unknown as { unconfirmed: Set<string> }).unconfirmed.delete(
            pairing.agentId,
        );
        t.host.dispose();
        await cancel(t.host, pairing);
        expect(t.relay.of("unregisterAgent")).toHaveLength(0);
        expect(t.relay.registered.has(pairing.agentId)).toBe(true);
    });
});

describe("pairing cleanups at the edges", () => {
    const settle = async () => {
        for (let i = 0; i < 10; i++) await tick();
    };

    it.each(["close", "dispose"])(
        "unregisters on %s while RegisterAgent's Result is still on its way",
        async (action) => {
            const t = setup({ limit: 1 });
            try {
                const { end, agentId, claim } = await claimCode(
                    t.host,
                    t.relay,
                );
                // The relay commits the registration; its Result is late.
                intercept(t.relay, (_socket, frame) =>
                    registerWithoutResult(t.relay, frame),
                );
                const accepting = outcome(
                    t.host.accept(claim, {
                        agentName: "box",
                        keys: [{ publicKey: KEY, comment: "key" }],
                    }),
                );
                for (
                    let i = 0;
                    i < 100 && !t.relay.registered.has(agentId);
                    i++
                )
                    await tick();
                if (action === "dispose") t.host.dispose();
                end();
                expect(await accepting).toBeInstanceOf(Error);
                await until(() => !t.relay.registered.has(agentId));
                expect(t.relay.of("unregisterAgent")).toHaveLength(1);
                expect(t.vault().ConnectedAgents ?? []).toHaveLength(0);
            } finally {
                t.host.dispose();
            }
        },
    );

    it("starts no accept once dispose has begun, even one already waiting for the runtime", async () => {
        const t = setup();
        try {
            const first = await claimCode(t.host, t.relay);
            // A's registration loses its Result; its cleanup's unregister is
            // held, so the runtime stays up for it.
            let finishCleanup: (() => void) | undefined;
            intercept(t.relay, (socket, frame, pass) => {
                if (registerWithoutResult(t.relay, frame, first.agentId)) {
                    socket.drop();
                    return true;
                }
                if (frame.frame?.$case !== "unregisterAgent") return false;
                finishCleanup = pass;
                return true;
            });
            await expect(
                t.host.accept(first.claim, {
                    agentName: "a",
                    keys: [],
                }),
            ).rejects.toBeInstanceOf(Error);
            await until(() => !!finishCleanup);
            const second = await claimCode(t.host, t.relay);
            const accepting = outcome(
                t.host.accept(second.claim, {
                    agentName: "b",
                    keys: [{ publicKey: KEY, comment: "key" }],
                }),
            );
            // Dispose while that accept waits for the runtime.
            queueMicrotask(() =>
                queueMicrotask(() => {
                    t.host.dispose();
                    first.end();
                    second.end();
                }),
            );
            for (let i = 0; i < 10; i++) await tick();
            finishCleanup?.();
            expect(await accepting).toBeInstanceOf(Error);
            for (let i = 0; i < 10; i++) await tick();
            expect(t.relay.registered.has(second.agentId)).toBe(false);
            expect(
                t.relay
                    .of("registerAgent")
                    .filter(
                        (frame) =>
                            frame.frame?.$case === "registerAgent" &&
                            uint8ToBase64Url(
                                frame.frame.registerAgent.agentKey,
                            ) === second.agentId,
                    ),
            ).toHaveLength(0);
        } finally {
            t.host.dispose();
        }
    });

    it("unregisters a confirmed pairing whose save fails after the dashboard went away", async () => {
        const t = setup();
        try {
            const { end, agentId, claim } = await claimCode(t.host, t.relay);
            await t.host.accept(claim, {
                agentName: "box",
                keys: [{ publicKey: KEY, comment: "key" }],
            });
            // Confirmed: the dialog saves the record next.
            (
                t.host as unknown as { unconfirmed: Set<string> }
            ).unconfirmed.delete(agentId);
            // The dashboard unmounts while that save runs, then it fails.
            t.host.dispose();
            end();
            await settle();
            t.host.pairingFailed(agentId);
            await until(() => !t.relay.registered.has(agentId));
            expect(t.vault().ConnectedAgents ?? []).toHaveLength(0);
        } finally {
            t.host.dispose();
        }
    });

    it("keeps a failed accept's cleanup alive through dispose", async () => {
        const t = setup({ limit: 1 });
        try {
            const { end, agentId, claim } = await claimCode(t.host, t.relay);
            // The relay commits the registration, then the connection drops
            // before its Result; the cleanup's reconnect is slow.
            let resume: (() => void) | undefined;
            intercept(t.relay, (socket, frame, pass) => {
                if (registerWithoutResult(t.relay, frame)) {
                    socket.drop();
                    return true;
                }
                if (frame.frame?.$case !== "auth" || resume) return false;
                resume = pass;
                return true;
            });
            expect(
                await outcome(
                    t.host.accept(claim, {
                        agentName: "box",
                        keys: [{ publicKey: KEY, comment: "key" }],
                    }),
                ),
            ).toBeInstanceOf(Error);
            await until(() => !!resume);
            t.host.dispose();
            await settle();
            resume!();
            await until(() => !t.relay.registered.has(agentId));
            expect(t.relay.of("unregisterAgent")).toHaveLength(1);
            end();
        } finally {
            t.host.dispose();
        }
    });

    it("keeps a failed pairing's cleanup alive through the relay's reconnect after the dialog closes", async () => {
        const t = setup({ limit: 1 });
        try {
            const pairing = await answer(t.host, t.relay);
            let resume: (() => void) | undefined;
            intercept(t.relay, (_socket, frame, pass) => {
                if (frame.frame?.$case !== "auth" || resume) return false;
                resume = pass;
                return true;
            });
            t.relay.last.drop();
            await tick();
            t.host.pairingFailed(pairing.agentId);
            await until(() => !!resume);
            // The failed dialog closes while the handshake is pending.
            pairing.end();
            await settle();
            expect(t.host.isLeader).toBe(true);
            resume!();
            await until(() => !t.relay.registered.has(pairing.agentId));
            expect(t.relay.of("unregisterAgent")).toHaveLength(1);
            await until(() => !t.host.isLeader);
        } finally {
            t.host.dispose();
        }
    });
});
