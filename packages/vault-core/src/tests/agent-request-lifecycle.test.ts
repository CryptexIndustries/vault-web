/**
 * @jest-environment node
 *
 * The life of one sign request in the runtime (runtime.ts): one tracked
 * object from onRequest to its single history entry, whatever happens
 * meanwhile (Deny, Pause, lock, expiry, withdrawal, stop, revoke, lost
 * Results). Most cases run the real runtime and approver over the fake
 * relay; the transition table at the end uses a fake approver.
 */
import { afterEach, describe, expect, it } from "@jest/globals";

import { uint8ToBase64 } from "../encoding";
import { Status, type ServerFrame } from "../proto/agent";
import { AgentRequestOutcome } from "../proto/vault";
import { PairingCancelledError, RequestGoneError } from "../agent/approver";
import { setAgentPaused } from "../agent/agent-actions";
import type { ApproverHost, SignAnswer } from "../agent/approver-types";
import { openEnvelope, sealEnvelope } from "../agent/envelope";
import {
    AgentRuntime,
    AnswerUncertainError,
    VaultLockedError,
    type RuntimeDeps,
} from "../agent/runtime";
import {
    cleanupRelayHarness,
    fakeApprover,
    fakeRuntimeDeps,
    fromId,
    gitSignRequest,
    incomingRequest,
    intercept,
    KEY,
    pairingSlot,
    RELAY_URL,
    runtimeOnRelay,
    signRequest,
    tick,
    until,
    type FakeRelay,
} from "./helpers/fake-relay";

afterEach(() => cleanupRelayHarness());

const { AgentOutcomeApproved, AgentOutcomeApprovedByRule } =
    AgentRequestOutcome;
const { AgentOutcomeDenied, AgentOutcomeExpired, AgentOutcomeRefused } =
    AgentRequestOutcome;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A signer the test releases by hand; abort-aware like ssh-sign. */
function handSigner() {
    const signer = {
        started: 0,
        release: (_signature?: Uint8Array) => undefined as void,
        hold: false,
        sign: (async (_key, _blob, _data, _flags, options) => {
            if (!signer.hold) return new Uint8Array([42]);
            signer.started++;
            return new Promise<Uint8Array>((resolve, reject) => {
                signer.release = (signature = new Uint8Array([43])) =>
                    resolve(signature);
                options?.signal?.addEventListener("abort", () =>
                    reject(new Error("cancelled")),
                );
            });
        }) as RuntimeDeps["sign"],
    };
    return signer;
}

/**
 * The relay takes sends but keeps their Result; then, with drop, it goes
 * away before the Result.
 */
function withholdResults(
    t: Awaited<ReturnType<typeof runtimeOnRelay>>,
    drop = false,
    taken?: () => void,
) {
    intercept(t.relay, "send", (_socket, frame) => {
        if (frame.frame?.$case === "send")
            t.relay.sent.push(frame.frame.send.envelope!);
        taken?.();
        if (drop) t.disconnect();
    });
}

/** A claim of a new agent's pairing code on the fake relay. */
async function claimNew(t: Awaited<ReturnType<typeof runtimeOnRelay>>) {
    const slot = pairingSlot(t.relay);
    return { ...slot, claim: await t.runtime.claim(slot.text) };
}

/** Holds the first Auth of the next handshake until resume() runs. */
function holdNextAuth(relay: FakeRelay) {
    let resume: (() => void) | undefined;
    intercept(relay, "auth", (_socket, _frame, pass) => {
        if (resume) return pass();
        resume = pass;
    });
    return () => resume;
}

async function waitingRequest(
    t: Awaited<ReturnType<typeof runtimeOnRelay>>,
    expiresIn?: number,
    sign = signRequest(),
) {
    const envelope = t.send(expiresIn, sign);
    await until(() => t.runtime.waitingCount() === 1, "request");
    return { envelope, id: t.runtime.pendingRequests()[0]!.id };
}

describe("answers to repeats", () => {
    it("resends an approved signature to a repeat in the same unlock session", async () => {
        const t = await runtimeOnRelay();
        const { envelope, id } = await waitingRequest(t);
        await t.runtime.approve(id);
        expect(t.replies()).toEqual(["signature"]);
        t.redeliver(envelope);
        await until(() => t.replies().length === 2, "resend");
        expect(t.replies()).toEqual(["signature", "signature"]);
        expect(t.runtime.waitingCount()).toBe(0);
        expect(t.outcomes()).toEqual([AgentOutcomeApproved]);
    });

    it("resends it after a reconnect too", async () => {
        const t = await runtimeOnRelay();
        const { envelope, id } = await waitingRequest(t);
        await t.runtime.approve(id);
        t.disconnect();
        await t.reconnect();
        t.redeliver(envelope);
        await until(() => t.replies().length === 2, "resend");
        expect(t.replies()).toEqual(["signature", "signature"]);
    });

    it("stops resending once the agent is paused or the key's grant is gone", async () => {
        const t = await runtimeOnRelay();
        const first = await waitingRequest(t);
        await t.runtime.approve(first.id);
        t.state.granted = false;
        t.redeliver(first.envelope);
        await sleep(30);
        expect(t.replies()).toEqual(["signature"]);

        t.state.granted = true;
        const second = await waitingRequest(t);
        await t.runtime.approve(second.id);
        await t.runtime.setPaused(t.agentId, true);
        t.redeliver(second.envelope);
        await sleep(30);
        expect(t.replies()).toEqual(["signature", "signature"]);
    });
});

describe("lost relay Results", () => {
    it("keeps trying until the deadline, then records the possibly delivered signature", async () => {
        const t = await runtimeOnRelay();
        withholdResults(t);
        // The relay client gives a call 30 s; shorten only that one.
        const realSetTimeout = global.setTimeout;
        global.setTimeout = ((
            callback: () => void,
            ms?: number,
            ...rest: unknown[]
        ) =>
            realSetTimeout(
                callback,
                ms === 30_000 ? 20 : ms,
                ...rest,
            )) as typeof setTimeout;
        try {
            const { id } = await waitingRequest(t, 400);
            const error = await t.runtime.approve(id).catch((e: unknown) => e);
            expect(error).toBeInstanceOf(AnswerUncertainError);
            expect(t.replies()[0]).toBe("signature");
            expect(t.runtime.waitingCount()).toBe(0);
            expect(t.outcomes()).toEqual([AgentOutcomeApproved]);
        } finally {
            global.setTimeout = realSetTimeout;
        }
    });

    it("settles approve at expiry while a send is still on its way", async () => {
        const t = await runtimeOnRelay();
        withholdResults(t);
        const { id } = await waitingRequest(t, 300);
        const started = Date.now();
        const error = await t.runtime.approve(id).catch((e: unknown) => e);
        expect(Date.now() - started).toBeLessThan(2_000);
        expect(error).toBeInstanceOf(AnswerUncertainError);
        expect(t.outcomes()).toEqual([AgentOutcomeApproved]);
    });

    it("lets Deny win during a send: Denied only, and no rule", async () => {
        const t = await runtimeOnRelay();
        withholdResults(t);
        const { id } = await waitingRequest(t, 90_000, gitSignRequest());
        const approving = t.runtime.approve(id, "process").catch((e) => e);
        await until(() => t.relay.sent.length === 1, "signature sent");
        await t.runtime.deny(id);
        expect(await approving).toBeInstanceOf(RequestGoneError);
        expect(t.outcomes()).toEqual([AgentOutcomeDenied]);
        expect(t.runtime.remembered.size).toBe(0);
        expect(t.replies()).toEqual(["signature", "refusal"]);
    });
});

describe("deadlines", () => {
    it("checks the deadline right before sending, whatever the timers do", async () => {
        let clock = Date.now();
        const timers: Array<() => void> = [];
        const t = await runtimeOnRelay({
            now: () => clock,
            // Timers that never fire on their own (a throttled background tab).
            setTimer: (callback) => timers.push(callback),
            clearTimer: () => undefined,
        });
        const { id } = await waitingRequest(t);
        t.disconnect();
        const approving = t.runtime.approve(id).catch((e: unknown) => e);
        await tick();
        clock += 91_000;
        await t.reconnect();
        expect(await approving).toBeInstanceOf(RequestGoneError);
        await sleep(30);
        expect(t.replies()).toEqual([]);
        expect(t.outcomes()).toEqual([AgentOutcomeExpired]);
        for (const fire of timers) fire();
        await tick();
        expect(t.outcomes()).toEqual([AgentOutcomeExpired]);
    });
});

describe("remembered approvals", () => {
    async function withRule() {
        const signer = handSigner();
        const t = await runtimeOnRelay({ sign: signer.sign });
        const { id } = await waitingRequest(t, 90_000, gitSignRequest());
        await t.runtime.approve(id, "process");
        expect(t.runtime.remembered.size).toBe(1);
        signer.hold = true;
        return { t, signer };
    }

    it("are refused by a synced pause while queued, and a resume doesn't revive them", async () => {
        const { t, signer } = await withRule();
        t.send(90_000, gitSignRequest());
        await until(() => signer.started === 1, "signing");
        expect(t.runtime.waitingCount()).toBe(0);
        t.disconnect();
        signer.release();
        await tick();
        t.state.paused = true;
        await t.runtime.reload();
        t.state.paused = false;
        await t.runtime.reload();
        await t.reconnect();
        await until(() => t.replies().length === 2, "refusal");
        await sleep(30);
        expect(t.replies()).toEqual(["signature", "refusal"]);
        expect(t.outcomes()).toEqual([
            AgentOutcomeApproved,
            AgentOutcomeRefused,
        ]);
    });

    it("expire on time while the signer hangs, and a late signature goes nowhere", async () => {
        const { t, signer } = await withRule();
        t.send(300, gitSignRequest());
        await until(() => signer.started === 1, "signing");
        await sleep(400);
        expect(t.outcomes()).toEqual([
            AgentOutcomeApproved,
            AgentOutcomeExpired,
        ]);
        signer.release();
        await sleep(30);
        expect(t.outcomes()).toEqual([
            AgentOutcomeApproved,
            AgentOutcomeExpired,
        ]);
        expect(t.replies()).toEqual(["signature"]);
    });

    it("don't come back as a prompt when the runtime stops while signing", async () => {
        const opened: string[] = [];
        const signer = handSigner();
        const t = await runtimeOnRelay({
            sign: signer.sign,
            ui: {
                isForeground: () => true,
                openRequest: (id) => opened.push(id),
                showNotification: () => undefined,
                cancelNotification: () => undefined,
            },
        });
        const { id } = await waitingRequest(t, 90_000, gitSignRequest());
        await t.runtime.approve(id, "process");
        opened.length = 0;
        signer.hold = true;
        t.send(90_000, gitSignRequest());
        await until(() => signer.started === 1, "signing");
        t.runtime.stop();
        await sleep(30);
        expect(t.runtime.running).toBe(false);
        expect(t.runtime.waitingCount()).toBe(0);
        expect(opened).toEqual([]);
        expect(t.outcomes()).toEqual([AgentOutcomeApproved]);
    });

    it("wait like any request when a lock calls them off", async () => {
        const { t, signer } = await withRule();
        t.send(90_000, gitSignRequest());
        await until(() => signer.started === 1, "signing");
        t.runtime.setLocking(true);
        t.state.unlocked = false;
        await tick();
        expect(t.runtime.waitingCount()).toBe(1);
        expect(t.replies()).toEqual(["signature"]);
        expect(t.outcomes()).toEqual([AgentOutcomeApproved]);
    });

    it("record ApprovedByRule when sent", async () => {
        const { t, signer } = await withRule();
        signer.hold = false;
        t.send(90_000, gitSignRequest());
        await until(() => t.replies().length === 2, "rule signature");
        await until(() => t.history.length === 2, "history");
        expect(t.outcomes()).toEqual([
            AgentOutcomeApproved,
            AgentOutcomeApprovedByRule,
        ]);
    });
});

describe("pairing", () => {
    async function pairNew(
        t: Awaited<ReturnType<typeof runtimeOnRelay>>,
        holdSave = false,
    ) {
        const end = await t.runtime.beginPairing();
        const { agent, peer, id, claim } = await claimNew(t);
        const release = holdSave ? t.holdSaves() : () => undefined;
        const accepting = t.runtime.accept(claim, {
            agentName: "new-box",
            keys: [{ publicKey: KEY, comment: "key" }],
        });
        if (holdSave)
            await until(
                () => t.relay.of("answerSlot").length === 1,
                "answered",
            );
        else await accepting;
        const deliver = (body: unknown) => {
            const envelope = sealEnvelope(
                agent,
                t.approverPeer,
                { body } as never,
                { expiresAt: Date.now() + 90_000 },
            );
            t.relay.last.push({
                frame: { $case: "deliver", deliver: { envelope } },
            } as ServerFrame);
            return envelope;
        };
        const replies = () =>
            t.relay.sent.flatMap((envelope) => {
                try {
                    const body = openEnvelope(agent, t.approverPeer, envelope)
                        .message.body;
                    return body?.$case === "signResponse"
                        ? [body.signResponse.result?.$case]
                        : [];
                } catch {
                    return [];
                }
            });
        return {
            id,
            end,
            accepting,
            release,
            replies,
            confirm: async () => {
                deliver({
                    $case: "pairingConfirm",
                    pairingConfirm: { agentVersion: "0.1.0" },
                });
                await tick();
                await tick();
            },
            request: () =>
                deliver({ $case: "signRequest", signRequest: signRequest() }),
            save: async () => {
                t.extraAgents.push({
                    id,
                    name: "new-box",
                    signPublicKey: uint8ToBase64(peer.signPublicKey),
                    kemPublicKey: uint8ToBase64(peer.kemPublicKey),
                    relayOrigin: RELAY_URL,
                    grantedKeys: [uint8ToBase64(KEY)],
                });
                t.grants.add(id);
                await t.runtime.reload();
            },
        };
    }

    it("holds a first request that comes while the local approval is saving", async () => {
        const t = await runtimeOnRelay();
        const p = await pairNew(t, true);
        await p.confirm();
        p.request();
        await sleep(30);
        expect(p.replies()).toEqual([]);
        expect(t.runtime.waitingCount()).toBe(0);
        p.release();
        await p.accepting;
        await p.save();
        await until(() => t.runtime.waitingCount() === 1, "served request");
        await t.runtime.approve(t.runtime.pendingRequests()[0]!.id);
        expect(p.replies()).toEqual(["signature"]);
        p.end();
    });

    it("forgets an agent whose pairing failed, also while another agent keeps the approver up", async () => {
        const t = await runtimeOnRelay();
        const p = await pairNew(t);
        await p.confirm();
        t.runtime.pairingFailed(p.id);
        p.end();
        await sleep(30);
        await t.runtime.reload();
        t.runtime.setLocking(true);
        t.state.unlocked = false;
        p.request();
        await sleep(30);
        expect(t.runtime.running).toBe(true);
        expect(t.runtime.waitingCount()).toBe(0);
    });

    it("doesn't confirm a pairing the relay removed while the local approval saved", async () => {
        const t = await runtimeOnRelay();
        const p = await pairNew(t, true);
        await p.confirm();
        // The machine unpairs before the save finishes.
        t.relay.registered.delete(p.id);
        t.relay.last.push({
            frame: {
                $case: "revoked",
                revoked: {
                    agentKey: fromId(p.id),
                },
            },
        } as ServerFrame);
        await tick();
        await tick();
        p.release();
        await p.accepting;
        expect(t.runtime.relayForgot(p.id)).toBe(true);
        await expect(t.runtime.waitForConfirmation(p.id)).rejects.toThrow(
            /removed/,
        );
        p.end();
    });

    it("unregisters through the claimed relay when cancelled while RegisterAgent's Result is pending", async () => {
        const t = await runtimeOnRelay();
        const end = await t.runtime.beginPairing();
        const { id, claim } = await claimNew(t);
        // The relay commits the registration; its Result is late.
        intercept(t.relay, "registerAgent", (_socket, frame) => {
            t.relay.frames.push(frame);
            t.relay.registered.set(id, new Uint8Array(32));
        });
        const accepting = t.runtime
            .accept(claim, {
                agentName: "box",
                keys: [{ publicKey: KEY, comment: "key" }],
            })
            .then(
                () => null,
                (error: unknown) => error,
            );
        await until(() => t.relay.registered.has(id), "registered");
        await t.runtime.cancelPairing(id);
        expect(t.relay.of("unregisterAgent")).toHaveLength(1);
        expect(t.relay.registered.has(id)).toBe(false);
        expect(await accepting).toBeInstanceOf(PairingCancelledError);
        expect(t.runtime.approvesLocally(id)).toBe(false);
        await end();
    });

    it("keeps a failed pairing's relay connection until its cleanup is done, also when the hold ends", async () => {
        const t = await runtimeOnRelay({}, { withAgent: false });
        const p = await pairNew(t);
        const resume = holdNextAuth(t.relay);
        t.relay.last.drop();
        await tick();
        t.runtime.pairingFailed(p.id);
        await until(() => !!resume(), "reconnect handshake");
        // The pairing screen closes while the handshake is pending.
        const ending = p.end();
        await sleep(30);
        expect(t.runtime.running).toBe(true);
        resume()!();
        await ending;
        expect(t.relay.of("unregisterAgent")).toHaveLength(1);
        expect(t.relay.registered.has(p.id)).toBe(false);
        await until(() => !t.runtime.running, "approver stopped");
    });

    it("still unregisters a pairing that wasn't kept after the runtime stops", async () => {
        const t = await runtimeOnRelay({}, { withAgent: false });
        const p = await pairNew(t);
        const resume = holdNextAuth(t.relay);
        t.relay.last.drop();
        await tick();
        // The pairing screen closes: the cleanup waits for the relay, and
        // with no agent kept the runtime stops meanwhile.
        const ending = p.end();
        await until(() => !!resume(), "reconnect handshake");
        t.runtime.stop();
        expect(t.runtime.running).toBe(false);
        resume()!();
        await ending;
        await until(() => !t.relay.registered.has(p.id), "unregistered");
        expect(t.relay.of("unregisterAgent")).toHaveLength(1);
    });

    it("keeps a pairing whose record was saved, even before the cache shows it", async () => {
        const t = await runtimeOnRelay({}, { withAgent: false });
        const p = await pairNew(t);
        await p.confirm();
        // Saved in the vault; the cache write failed, so nothing serves it.
        t.savedRecords.add(p.id);
        await p.end();
        await sleep(30);
        expect(t.relay.registered.has(p.id)).toBe(true);
        expect(t.relay.of("unregisterAgent")).toHaveLength(0);
    });

    it("unregisters an unsaved pairing whose failure is reported after stop", async () => {
        const t = await runtimeOnRelay();
        const p = await pairNew(t);
        t.runtime.stop();
        await t.runtime.cancelPairing(p.id);
        await until(() => !t.relay.registered.has(p.id), "unregistered");
        expect(t.relay.of("unregisterAgent")).toHaveLength(1);
    });

    it("unregisters an accept that stop interrupted during its local save", async () => {
        const t = await runtimeOnRelay();
        const p = await pairNew(t, true);
        const accepting = p.accepting.then(
            () => null,
            (error: unknown) => error,
        );
        t.runtime.stop();
        p.release();
        expect(await accepting).toBeInstanceOf(Error);
        await until(() => !t.relay.registered.has(p.id), "unregistered");
    });

    it("unregisters once when the relay refuses AnswerSlot", async () => {
        const t = await runtimeOnRelay();
        const end = await t.runtime.beginPairing();
        const { id, claim } = await claimNew(t);
        intercept(t.relay, "answerSlot", (socket, frame) =>
            t.relay.result(socket, frame, Status.STATUS_NOT_FOUND),
        );
        await expect(
            t.runtime.accept(claim, {
                agentName: "box",
                keys: [{ publicKey: KEY, comment: "key" }],
            }),
        ).rejects.toBeInstanceOf(Error);
        await end();
        await sleep(30);
        expect(t.relay.of("unregisterAgent")).toHaveLength(1);
        expect(t.relay.registered.has(id)).toBe(false);
    });

    it("unregisters an answered pairing on the relay when it fails", async () => {
        const t = await runtimeOnRelay();
        const p = await pairNew(t);
        expect(t.relay.registered.has(p.id)).toBe(true);
        // The agent never confirms; the pairing screen closes.
        p.end();
        await until(
            () => t.relay.of("unregisterAgent").length === 1,
            "unregister",
        );
        expect(t.relay.registered.has(p.id)).toBe(false);
        // A second failure report (or a cancel) is harmless.
        t.runtime.pairingFailed(p.id);
        await sleep(30);
        expect(t.relay.of("unregisterAgent")).toHaveLength(1);
    });

    it("refuses held requests when the pairing fails", async () => {
        const t = await runtimeOnRelay();
        const p = await pairNew(t, true);
        await p.confirm();
        p.request();
        await sleep(30);
        p.release();
        await p.accepting;
        t.runtime.pairingFailed(p.id);
        await until(() => p.replies().length === 1, "refusal");
        expect(p.replies()).toEqual(["refusal"]);
        expect(t.outcomes()).toEqual([AgentOutcomeRefused]);
        p.end();
    });
});

describe("request transitions", () => {
    type Event =
        | "deny"
        | "pause"
        | "expire"
        | "withdraw"
        | "relayForgot"
        | "lock"
        | "stop"
        | "revoke";

    function tableRuntime() {
        const answers: SignAnswer[] = [];
        const outcomes: AgentRequestOutcome[] = [];
        const timers = new Map<number, () => void>();
        const state = { unlocked: true, hold: false };
        let releaseSign: () => void = () => undefined;
        let nextTimer = 0;
        let host!: ApproverHost;
        const runtime = new AgentRuntime(
            fakeRuntimeDeps({
                createApprover: (value) => {
                    host = value;
                    return fakeApprover({
                        answer: async (_id, answer) => {
                            answers.push(answer);
                        },
                    });
                },
                vault: {
                    hasAgentRecord: () => false,
                    isPaused: () => false,
                    canSign: () => state.unlocked,
                    grantedKey: () =>
                        state.unlocked
                            ? {
                                  credentialId: "cred",
                                  name: "key",
                                  sshKey: {} as never,
                              }
                            : "locked",
                    appendHistory: async (_id, entry) => {
                        outcomes.push(entry.Outcome);
                        return true;
                    },
                    appendHistoryEntries: async (_id, entries) => {
                        outcomes.push(...entries.map((entry) => entry.Outcome));
                        return true;
                    },
                },
                sign: () =>
                    state.hold
                        ? new Promise((resolve) => {
                              releaseSign = () => resolve(new Uint8Array([42]));
                          })
                        : Promise.resolve(new Uint8Array([42])),
                setTimer: (callback) => {
                    timers.set(++nextTimer, callback);
                    return nextTimer;
                },
                clearTimer: (handle) => void timers.delete(handle as number),
            }),
        );
        const request = incomingRequest({ id: "r1" });
        const fire: Record<Event, () => unknown> = {
            deny: () => runtime.deny("r1"),
            pause: () => runtime.setPaused("agent-a", true),
            expire: () => {
                // The deadline passes and the request's timer runs.
                request.expiresAt = Date.now() - 1;
                for (const callback of timers.values()) callback();
            },
            withdraw: () => host.onRequestGone("r1"),
            relayForgot: () => host.onRelayDroppedAgent("agent-a"),
            lock: () => {
                runtime.setLocking(true);
                state.unlocked = false;
            },
            stop: () => runtime.stop(),
            revoke: () => runtime.unregister("agent-a"),
        };
        return {
            runtime,
            answers,
            outcomes,
            state,
            request,
            fire,
            release: () => releaseSign(),
        };
    }

    const O = AgentRequestOutcome;
    // [event, history from waiting, from signing, answer sent, still waiting
    //  afterwards, what an approve underway settles with]
    const table: Array<
        [
            Event,
            AgentRequestOutcome[],
            "refusal" | null,
            boolean,
            (new () => Error) | null,
        ]
    > = [
        ["deny", [O.AgentOutcomeDenied], "refusal", false, RequestGoneError],
        ["pause", [O.AgentOutcomeRefused], "refusal", false, RequestGoneError],
        ["expire", [O.AgentOutcomeExpired], null, false, RequestGoneError],
        ["withdraw", [O.AgentOutcomeRefused], null, false, RequestGoneError],
        ["relayForgot", [O.AgentOutcomeRefused], null, false, RequestGoneError],
        ["lock", [], null, true, VaultLockedError],
        ["stop", [], null, false, VaultLockedError],
        ["revoke", [O.AgentOutcomeRefused], null, false, RequestGoneError],
    ];

    it.each(table)(
        "waiting, then %s",
        async (event, history, answer, stillWaiting) => {
            const r = tableRuntime();
            await r.runtime.reload();
            await r.runtime.onRequest(r.request);
            expect(r.runtime.waitingCount()).toBe(1);
            await r.fire[event]();
            await tick();
            expect(r.outcomes).toEqual(history);
            expect(r.answers.map((item) => Object.keys(item)[0])).toEqual(
                answer ? [answer] : [],
            );
            expect(r.runtime.waitingCount()).toBe(stillWaiting ? 1 : 0);
        },
    );

    it.each(table)(
        "signing, then %s",
        async (event, history, answer, stillWaiting, settles) => {
            const r = tableRuntime();
            await r.runtime.reload();
            await r.runtime.onRequest(r.request);
            r.state.hold = true;
            const approving = r.runtime.approve("r1").then(
                () => null,
                (error: Error) => error,
            );
            await tick();
            await r.fire[event]();
            expect(await approving).toBeInstanceOf(settles!);
            // The signature that comes after never goes out.
            r.release();
            await tick();
            await tick();
            expect(r.outcomes).toEqual(history);
            expect(r.answers.map((item) => Object.keys(item)[0])).toEqual(
                answer ? [answer] : [],
            );
            expect(r.runtime.waitingCount()).toBe(stillWaiting ? 1 : 0);
        },
    );

    it("waiting, then approved: one Approved entry and the signature", async () => {
        const r = tableRuntime();
        await r.runtime.reload();
        await r.runtime.onRequest(r.request);
        await r.runtime.approve("r1");
        expect(r.outcomes).toEqual([AgentOutcomeApproved]);
        expect(r.answers.map((item) => Object.keys(item)[0])).toEqual([
            "signature",
        ]);
        // Ended: nothing changes it any more.
        await r.runtime.deny("r1");
        r.fire.expire();
        await tick();
        expect(r.outcomes).toEqual([AgentOutcomeApproved]);
    });
});

describe("permission that ends", () => {
    it("records an explicit relay refusal as Expired, not as possibly delivered", async () => {
        const t = await runtimeOnRelay();
        let refused = 0;
        intercept(t.relay, "send", (socket, frame) => {
            refused++;
            t.relay.result(socket, frame, Status.STATUS_RATE_LIMITED);
        });
        const { id } = await waitingRequest(t, 300);
        const error = await t.runtime.approve(id).catch((e: unknown) => e);
        expect(refused).toBeGreaterThan(0);
        expect(error).toBeInstanceOf(RequestGoneError);
        expect(error).not.toBeInstanceOf(AnswerUncertainError);
        expect(t.relay.sent).toEqual([]);
        expect(t.outcomes()).toEqual([AgentOutcomeExpired]);
    });

    it("keeps the evidence of a possibly delivered signature across a lock", async () => {
        const t = await runtimeOnRelay();
        let taken = 0;
        withholdResults(t, true, () => taken++);
        const { id } = await waitingRequest(t, 350);
        const approving = t.runtime.approve(id).catch((e: unknown) => e);
        await until(() => taken === 1, "signature taken");
        await tick();
        t.runtime.setLocking(true);
        t.state.unlocked = false;
        expect(await approving).toBeInstanceOf(VaultLockedError);
        await sleep(450);
        t.state.unlocked = true;
        await t.runtime.onVaultUnlocked();
        expect(t.replies()).toEqual(["signature"]);
        expect(t.outcomes()).toEqual([AgentOutcomeApproved]);
    });

    it("admits nothing from a Deliver the relay client queued before stop", async () => {
        const opened: string[] = [];
        const t = await runtimeOnRelay({
            ui: {
                isForeground: () => true,
                openRequest: (id) => opened.push(id),
                showNotification: () => undefined,
                cancelNotification: () => undefined,
            },
        });
        t.send();
        t.runtime.stop();
        await sleep(30);
        expect(t.runtime.waitingCount()).toBe(0);
        expect(opened).toEqual([]);
    });

    it.each(["pause", "grant"])(
        "drops a stored signature for good when the %s ends",
        async (change) => {
            const t = await runtimeOnRelay();
            const { envelope, id } = await waitingRequest(t);
            await t.runtime.approve(id);
            if (change === "pause") {
                await t.runtime.setPaused(t.agentId, true);
                await t.runtime.setPaused(t.agentId, false);
            } else {
                t.state.granted = false;
                await t.runtime.reload();
                t.state.granted = true;
                await t.runtime.reload();
            }
            t.redeliver(envelope);
            await sleep(50);
            expect(t.replies()).toEqual(["signature"]);
            expect(t.outcomes()).toEqual([AgentOutcomeApproved]);
        },
    );

    it("refuses an approval whose key grant is removed while signing; a regrant doesn't revive it", async () => {
        const signer = handSigner();
        let signal: AbortSignal | undefined;
        const t = await runtimeOnRelay({
            sign: (key, blob, data, flags, options) => {
                signal = options?.signal;
                return signer.sign(key, blob, data, flags, options);
            },
        });
        signer.hold = true;
        const { id } = await waitingRequest(t);
        const approving = t.runtime.approve(id).catch((e: unknown) => e);
        await until(() => signer.started === 1, "signing");
        t.state.granted = false;
        await t.runtime.reload();
        expect(signal?.aborted).toBe(true);
        expect(await approving).toBeInstanceOf(RequestGoneError);
        t.state.granted = true;
        await t.runtime.reload();
        signer.release();
        await sleep(30);
        expect(t.replies()).toEqual(["refusal"]);
        expect(t.outcomes()).toEqual([AgentOutcomeRefused]);
    });

    it("refuses an approval whose key grant is removed while it waits for the relay", async () => {
        const t = await runtimeOnRelay();
        const { id } = await waitingRequest(t);
        t.disconnect();
        const approving = t.runtime.approve(id).catch((e: unknown) => e);
        await tick();
        t.state.granted = false;
        await t.runtime.reload();
        expect(await approving).toBeInstanceOf(RequestGoneError);
        t.state.granted = true;
        await t.runtime.reload();
        await t.reconnect();
        await until(() => t.replies().length === 1, "refusal");
        await sleep(30);
        expect(t.replies()).toEqual(["refusal"]);
        expect(t.outcomes()).toEqual([AgentOutcomeRefused]);
    });

    it("denies signing when the live vault record says Paused, whatever the cache says", async () => {
        const t = await runtimeOnRelay();
        const first = await waitingRequest(t, 90_000, gitSignRequest());
        await t.runtime.approve(first.id, "process");
        expect(t.runtime.remembered.size).toBe(1);
        // A stale agent cache still says unpaused; the vault says Paused.
        t.state.livePaused = true;
        t.send(90_000, gitSignRequest());
        await until(() => t.replies().length === 2, "answer");
        expect(t.replies()).toEqual(["signature", "refusal"]);
        // No resend of the stored signature either.
        t.redeliver(first.envelope);
        await sleep(30);
        expect(t.replies()).toEqual(["signature", "refusal"]);
        expect(t.outcomes()).toEqual([
            AgentOutcomeApproved,
            AgentOutcomeRefused,
        ]);
    });
});

describe("pause while saving, and delivery evidence through a lock", () => {
    it("keeps a pause whose record is still saving, through a reload of the old cache", async () => {
        const t = await runtimeOnRelay();
        const first = await waitingRequest(t, 90_000, gitSignRequest());
        await t.runtime.approve(first.id, "process");
        expect(t.runtime.remembered.size).toBe(1);
        let finishSave: () => void = () => undefined;
        const changeAgent = (_id: string, changes: { Paused?: boolean }) =>
            new Promise<boolean>((resolve) => {
                finishSave = () => {
                    t.state.livePaused = !!changes.Paused;
                    resolve(true);
                };
            });
        const pausing = setAgentPaused(t.agentId, true, {
            changeAgent,
            runtime: t.runtime,
        });
        await tick();
        // A cache sync from before the Pause finishes while it saves.
        await t.runtime.reload();
        t.send(90_000, gitSignRequest());
        await until(() => t.replies().length === 2, "answer");
        expect(t.replies()).toEqual(["signature", "refusal"]);
        // Nor does the stored signature go out again.
        t.redeliver(first.envelope);
        await sleep(30);
        expect(t.replies()).toEqual(["signature", "refusal"]);
        finishSave();
        await pausing;
        expect(t.outcomes()).toEqual([
            AgentOutcomeApproved,
            AgentOutcomeRefused,
        ]);
    });

    it("ends stored signatures when Pause starts, even if a reload races its history write", async () => {
        const t = await runtimeOnRelay();
        const first = await waitingRequest(t);
        await t.runtime.approve(first.id);
        await waitingRequest(t);
        const release = t.holdHistory();
        const changeAgent = async (
            _id: string,
            changes: { Paused?: boolean },
        ) => {
            t.state.livePaused = !!changes.Paused;
            return true;
        };
        const pausing = setAgentPaused(t.agentId, true, {
            changeAgent,
            runtime: t.runtime,
        });
        await tick();
        await t.runtime.reload();
        release();
        await pausing;
        await setAgentPaused(t.agentId, false, {
            changeAgent,
            runtime: t.runtime,
        });
        t.redeliver(first.envelope);
        await sleep(30);
        expect(t.replies()).toEqual(["signature", "refusal"]);
    });

    it.each([1, 2, 3])(
        "finalizes an acknowledged signature as Approved when a lock comes %i microtask(s) after the Result",
        async (hops) => {
            const t = await runtimeOnRelay();
            const { id } = await waitingRequest(t, 300);
            intercept(t.relay, "send", (_socket, _frame, pass) => {
                pass();
                let later = Promise.resolve();
                for (let i = 1; i < hops; i++) later = later.then(() => {});
                void later.then(() => {
                    t.runtime.setLocking(true);
                    t.state.unlocked = false;
                });
            });
            await expect(t.runtime.approve(id)).resolves.toBeUndefined();
            await sleep(350);
            t.state.unlocked = true;
            await t.runtime.onVaultUnlocked();
            expect(t.replies()).toEqual(["signature"]);
            expect(t.outcomes()).toEqual([AgentOutcomeApproved]);
        },
    );

    it("keeps a rule approval's source when its possibly delivered signature expires after a lock", async () => {
        const t = await runtimeOnRelay();
        const first = await waitingRequest(t, 90_000, gitSignRequest());
        await t.runtime.approve(first.id, "process");
        withholdResults(t, true);
        t.send(300, gitSignRequest());
        await until(() => t.replies().length === 2, "rule signature taken");
        await tick();
        t.runtime.setLocking(true);
        t.state.unlocked = false;
        await sleep(400);
        t.state.unlocked = true;
        await t.runtime.onVaultUnlocked();
        // ApprovedByRule: KnownHosts learns names only from Approved.
        expect(t.outcomes()).toEqual([
            AgentOutcomeApproved,
            AgentOutcomeApprovedByRule,
        ]);
    });
});

describe("pause operations", () => {
    const changeAgentFor =
        (t: Awaited<ReturnType<typeof runtimeOnRelay>>, saved = true) =>
        async (_id: string, changes: { Paused?: boolean }) => {
            if (!saved) return false;
            t.state.livePaused = !!changes.Paused;
            return true;
        };

    it("lets a Resume saved on another device count once this pause is saved", async () => {
        const t = await runtimeOnRelay();
        await setAgentPaused(t.agentId, true, {
            changeAgent: changeAgentFor(t),
            runtime: t.runtime,
        });
        // A linked device resumes before any reload here saw the pause.
        t.state.livePaused = false;
        t.state.paused = false;
        await t.runtime.reload();
        await t.runtime.reload();
        const { id } = await waitingRequest(t);
        await t.runtime.approve(id);
        expect(t.replies()).toEqual(["signature"]);
    });

    it("doesn't let an older pause's save end a newer pause", async () => {
        const t = await runtimeOnRelay();
        const first = t.runtime.setPaused(t.agentId, true);
        const older = t.runtime.pauseToken(t.agentId)!;
        await first;
        await t.runtime.setPaused(t.agentId, false);
        await t.runtime.setPaused(t.agentId, true);
        t.runtime.pauseSaved(t.agentId, older);
        await t.runtime.reload();
        t.send();
        await until(() => t.replies().length === 1, "answer");
        expect(t.replies()).toEqual(["refusal"]);
    });

    it.each([true, false])(
        "doesn't let a reload of an older pause end a newer unsaved one (newer save works: %s)",
        async (newerSaves) => {
            const t = await runtimeOnRelay();
            const seed = await waitingRequest(t, 90_000, gitSignRequest());
            await t.runtime.approve(seed.id, "process");
            let finishOlder: (saved: boolean) => void = () => undefined;
            let finishNewer: (saved: boolean) => void = () => undefined;
            const older = setAgentPaused(t.agentId, true, {
                runtime: t.runtime,
                changeAgent: () =>
                    new Promise<boolean>((resolve) => (finishOlder = resolve)),
            });
            await tick();
            const newer = setAgentPaused(t.agentId, true, {
                runtime: t.runtime,
                changeAgent: () =>
                    new Promise<boolean>((resolve) => (finishNewer = resolve)),
            }).catch((error: unknown) => error);
            await tick();
            // The older pause commits, and a reload sees it in both records.
            t.state.paused = true;
            t.state.livePaused = true;
            finishOlder(true);
            await older;
            await t.runtime.reload();
            // Another device resumes that one while the newer save is pending.
            t.state.paused = false;
            t.state.livePaused = false;
            await t.runtime.reload();
            t.send(90_000, gitSignRequest());
            await until(() => t.replies().length === 2, "answer");
            expect(t.replies()).toEqual(["signature", "refusal"]);
            finishNewer(newerSaves);
            await newer;
            if (!newerSaves) {
                // Not saved: still refused.
                t.send(90_000, gitSignRequest());
                await until(() => t.replies().length === 3, "answer");
                expect(t.replies()).toEqual([
                    "signature",
                    "refusal",
                    "refusal",
                ]);
            }
        },
    );

    it("doesn't let an older Resume finishing clear a newer unsaved Pause", async () => {
        const t = await runtimeOnRelay();
        const seed = await waitingRequest(t, 90_000, gitSignRequest());
        await t.runtime.approve(seed.id, "process");
        // Durably paused; then Resume starts, then a newer Pause.
        t.state.paused = true;
        t.state.livePaused = true;
        await t.runtime.reload();
        let finishResume: (saved: boolean) => void = () => undefined;
        let finishPause: (saved: boolean) => void = () => undefined;
        const resuming = setAgentPaused(t.agentId, false, {
            runtime: t.runtime,
            changeAgent: () =>
                new Promise<boolean>((resolve) => (finishResume = resolve)),
        });
        const pausing = setAgentPaused(t.agentId, true, {
            runtime: t.runtime,
            changeAgent: () =>
                new Promise<boolean>((resolve) => (finishPause = resolve)),
        }).catch((error: unknown) => error);
        await tick();
        // The older Resume commits while the newer Pause still saves.
        t.state.paused = false;
        t.state.livePaused = false;
        finishResume(true);
        await resuming;
        await t.runtime.reload();
        t.send(90_000, gitSignRequest());
        await until(() => t.replies().length === 2, "answer");
        expect(t.replies()).toEqual(["signature", "refusal"]);
        finishPause(false);
        await pausing;
        // That save failed: the Pause still counts.
        t.send(90_000, gitSignRequest());
        await until(() => t.replies().length === 3, "answer");
        expect(t.replies()).toEqual(["signature", "refusal", "refusal"]);
    });

    it("doesn't unpause on a Resume that hasn't been saved", async () => {
        const t = await runtimeOnRelay();
        t.state.paused = true;
        t.state.livePaused = true;
        await t.runtime.reload();
        let finish: (saved: boolean) => void = () => undefined;
        const resuming = setAgentPaused(t.agentId, false, {
            runtime: t.runtime,
            changeAgent: () =>
                new Promise<boolean>((resolve) => (finish = resolve)),
        });
        await tick();
        t.send();
        await until(() => t.replies().length === 1, "answer");
        expect(t.replies()).toEqual(["refusal"]);
        finish(true);
        await resuming;
    });

    it("fails closed for a host without the live pause check, after a saved Pause and a stale cache", async () => {
        const t = await runtimeOnRelay();
        const seed = await waitingRequest(t, 90_000, gitSignRequest());
        await t.runtime.approve(seed.id, "process");
        // isPaused is required; a host leaving it out can't fall back to
        // the (stale) cache.
        delete (
            t.runtime as unknown as { deps: { vault: { isPaused?: unknown } } }
        ).deps.vault.isPaused;
        let finish: (saved: boolean) => void = () => undefined;
        const pausing = setAgentPaused(t.agentId, true, {
            runtime: t.runtime,
            changeAgent: () =>
                new Promise<boolean>((resolve) => (finish = resolve)),
        });
        await tick();
        await t.runtime.reload();
        finish(true);
        await pausing;
        t.send(90_000, gitSignRequest());
        await until(() => t.replies().length === 2, "answer");
        expect(t.replies()).toEqual(["signature", "refusal"]);
    });

    it("keeps refusing when the pause couldn't be saved", async () => {
        const t = await runtimeOnRelay();
        await expect(
            setAgentPaused(t.agentId, true, {
                changeAgent: changeAgentFor(t, false),
                runtime: t.runtime,
            }),
        ).rejects.toThrow(/pause/);
        await t.runtime.reload();
        t.send();
        await until(() => t.replies().length === 1, "answer");
        expect(t.replies()).toEqual(["refusal"]);
    });
});
