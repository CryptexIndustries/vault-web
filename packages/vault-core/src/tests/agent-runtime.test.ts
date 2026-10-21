/**
 * @jest-environment node
 *
 * The shared approver runtime and remembered approvals (agent/runtime.ts and
 * agent/remember.ts), which both the Android app and the web dashboard host.
 */
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type {
    ApproverHost,
    RequestCheck,
    SignAnswer,
} from "../agent/approver-types";
import { RefusalReason } from "../proto/agent";
import { AgentRequestOutcome, type AgentRequestRecord } from "../proto/vault";
import {
    RememberedApprovals,
    callerProcess,
    processName,
    rememberChoices,
} from "../agent/remember";
import {
    AgentRuntime,
    MAX_PROMPTS_PER_AGENT,
    MAX_QUEUED_HISTORY,
    SCREEN_OPEN_GRACE_MS,
    normalizeRelayUrlInput,
    relayTargetFor,
    type CachedAgent,
    type LocalAgentApproval,
    type RuntimeDeps,
} from "../agent/runtime";
import { uint8ToBase64 } from "../encoding";
import { Approver } from "../agent/approver";
import {
    checkKnownHost,
    knownHostWarnings,
    serverNameNote,
} from "../agent/agent-format";
import {
    CONNECT_PATH,
    normalizeOrigin,
    webSocketURL,
} from "../agent/relay-client";
import {
    fakeApprover,
    fakeRuntimeDeps,
    incomingRequest as request,
    KEY,
    loginCheck,
    sshsig,
} from "./helpers/fake-relay";

const KEY_BASE64 = uint8ToBase64(KEY);

async function until(cond: () => boolean) {
    for (let i = 0; i < 100 && !cond(); i++)
        await new Promise((resolve) => setImmediate(resolve));
    expect(cond()).toBe(true);
}

describe("remembered approvals", () => {
    const signature = (namespace: string): RequestCheck => ({
        kind: "signature",
        namespace,
        forwardedVia: [],
        destinationUnknown: false,
    });

    it.each<[string, RequestCheck, string[]]>([
        ["a verified login", loginCheck(), ["once", "process", "host"]],
        [
            "a login to an unknown destination",
            loginCheck({ destinationUnknown: true, verifiedHost: undefined }),
            [],
        ],
        [
            "a forwarded login",
            loginCheck({
                forwardedVia: [{ fingerprint: "SHA256:jump", names: ["jump"] }],
            }),
            [],
        ],
        ["a git signature", signature("git"), ["once", "process"]],
        ["a file signature", signature("file"), []],
        [
            "other data",
            { kind: "other", forwardedVia: [], destinationUnknown: false },
            [],
        ],
    ])("offers these choices for %s", (_, check, choices) => {
        expect(rememberChoices(request({ check }))).toEqual(choices);
    });

    it("offers no program rule when the machine couldn't read the program's path", () => {
        const unknown = (pid: number) =>
            request({
                sign: {
                    ...request().sign,
                    processes: [{ pid, uid: 1000, exe: "", args: [], cwd: "" }],
                },
            });
        expect(rememberChoices(unknown(5))).toEqual(["once", "host"]);
        const rules = new RememberedApprovals();
        expect(rules.add(unknown(5), "cred-1", "process")).toBe(false);
        expect(rules.matches(unknown(6), "cred-1")).toBe(false);
        expect(processName(callerProcess(unknown(5).sign.processes))).toBe(
            "this program",
        );
    });

    it("names git, not ssh, as the caller of git push", () => {
        expect(callerProcess(request().sign.processes)?.exe).toBe(
            "/usr/bin/git",
        );
    });

    it("matches a process rule by agent, key and program", () => {
        const rules = new RememberedApprovals();
        expect(rules.add(request(), "cred-1", "process")).toBe(true);
        expect(rules.matches(request(), "cred-1")).toBe(true);
        expect(rules.matches(request(), "cred-2")).toBe(false);
        expect(rules.matches(request({ agentId: "agent-b" }), "cred-1")).toBe(
            false,
        );
        expect(
            rules.matches(request({ exe: "/usr/bin/rsync" }), "cred-1"),
        ).toBe(false);
    });

    it("matches a host rule by the verified host key", () => {
        const rules = new RememberedApprovals();
        rules.add(request(), "cred-1", "host");
        expect(
            rules.matches(request({ exe: "/usr/bin/rsync" }), "cred-1"),
        ).toBe(true);
        const elsewhere = request({
            check: loginCheck({
                verifiedHost: {
                    hostKey: new Uint8Array(1),
                    fingerprint: "SHA256:other",
                    names: ["github.com"],
                },
            }),
        });
        expect(rules.matches(elsewhere, "cred-1")).toBe(false);
    });

    it("never approves destination-unknown or forwarded requests from a rule", () => {
        const rules = new RememberedApprovals();
        rules.add(request(), "cred-1", "process");
        rules.add(request(), "cred-1", "host");
        expect(
            rules.matches(
                request({ check: loginCheck({ destinationUnknown: true }) }),
                "cred-1",
            ),
        ).toBe(false);
        expect(
            rules.matches(
                request({
                    check: loginCheck({
                        forwardedVia: [{ fingerprint: "SHA256:j", names: [] }],
                    }),
                }),
                "cred-1",
            ),
        ).toBe(false);
        expect(
            rules.add(
                request({ check: loginCheck({ destinationUnknown: true }) }),
                "cred-1",
                "process",
            ),
        ).toBe(false);
    });

    it("keys git signing to one git process", () => {
        const rules = new RememberedApprovals();
        const git = signature("git");
        rules.add(request({ check: git, pid: 500 }), "cred-1", "process");
        expect(rules.matches(request({ check: git, pid: 500 }), "cred-1")).toBe(
            true,
        );
        expect(rules.matches(request({ check: git, pid: 501 }), "cred-1")).toBe(
            false,
        );
        // A git signature rule says nothing about logins.
        expect(rules.matches(request({ pid: 500 }), "cred-1")).toBe(false);
    });
});

describe("relay targets", () => {
    it("keeps a relay's base path for connecting and signs only its origin", () => {
        const hosted = "https://relay.cryptex-vault.com";
        expect(normalizeRelayUrlInput("https://Example.com:443/relay/")).toBe(
            "https://example.com/relay",
        );
        expect(normalizeRelayUrlInput("http://relay.example.com")).toBeNull();
        expect(normalizeRelayUrlInput("http://[::1]:8080/r")).toBe(
            "http://[::1]:8080/r",
        );
        expect(
            relayTargetFor("https://example.com/relay", hosted, [
                { origin: "https://example.com/relay/", token: "t" },
            ]),
        ).toEqual({
            kind: "custom",
            url: "https://example.com/relay",
            token: "t",
        });
        expect(webSocketURL("https://example.com/relay", CONNECT_PATH)).toBe(
            "wss://example.com/relay/v1/connect",
        );
        expect(normalizeOrigin("https://example.com/relay")).toBe(
            "https://example.com",
        );
    });

    it("treats an empty or hosted origin as the hosted relay and finds saved tokens", () => {
        const hosted = "https://relay.cryptex-vault.com";
        expect(relayTargetFor("", hosted, [])).toEqual({
            kind: "hosted",
            url: hosted,
        });
        expect(relayTargetFor(hosted, hosted, [])).toEqual({
            kind: "hosted",
            url: hosted,
        });
        expect(
            relayTargetFor("https://relay.example.com", hosted, [
                { origin: "https://relay.example.com", token: "t" },
            ]),
        ).toEqual({
            kind: "custom",
            url: "https://relay.example.com",
            token: "t",
        });
    });
});

describe("request routing", () => {
    let host: ApproverHost;
    let answers: Array<{ id: string; answer: SignAnswer }>;
    let history: Array<{ agentId: string; entry: AgentRequestRecord }>;
    let unlocked: boolean;
    let foreground: boolean;
    let granted: boolean;
    let ui: {
        openRequest: jest.Mock;
        showNotification: jest.Mock;
        cancelNotification: jest.Mock;
    };
    let timers: Array<() => void>;
    let clock: number;
    let runtime: AgentRuntime;
    let cache: CachedAgent[];
    let local: LocalAgentApproval[];
    let unregistered: Array<{ id: string; url?: string }>;
    let batches: Array<{ agentId: string; size: number }>;
    let signer: RuntimeDeps["sign"];

    beforeEach(async () => {
        cache = [
            {
                id: "agent-a",
                name: "workstation",
                signPublicKey: "",
                kemPublicKey: "",
                relayOrigin: "",
                grantedKeys: [KEY_BASE64],
            },
            {
                id: "agent-b",
                name: "build-box",
                signPublicKey: "",
                kemPublicKey: "",
                relayOrigin: "",
                grantedKeys: [KEY_BASE64],
            },
        ];
        local = [
            { agentId: "agent-a", keys: [KEY_BASE64] },
            { agentId: "agent-b", keys: [KEY_BASE64] },
        ];
        unregistered = [];
        batches = [];
        signer = async () => new Uint8Array([42]);
        answers = [];
        history = [];
        unlocked = true;
        foreground = true;
        granted = true;
        timers = [];
        clock = Date.now();
        ui = {
            openRequest: jest.fn(),
            showNotification: jest.fn(),
            cancelNotification: jest.fn(),
        };
        const approver = fakeApprover({
            answer: async (id, answer) => {
                answers.push({ id, answer });
            },
            unregister: async (id, relay) => {
                unregistered.push({ id, url: relay?.url });
            },
        });
        const deps = fakeRuntimeDeps({
            createApprover: (value) => {
                host = value;
                return approver;
            },
            loadAgentCache: async () => cache,
            localApprovals: {
                load: async () => local,
                save: async (next) => {
                    local = next;
                },
            },
            vault: {
                hasAgentRecord: () => false,
                isPaused: () => false,
                canSign: () => unlocked,
                grantedKey: (_agentId, publicKey) => {
                    if (!unlocked) return "locked";
                    if (!granted || publicKey !== KEY) return null;
                    return {
                        credentialId: "cred-1",
                        name: "GitHub",
                        sshKey: {} as never,
                    };
                },
                appendHistory: async (agentId, entry) => {
                    if (!unlocked) return false;
                    history.push({ agentId, entry });
                    return true;
                },
                appendHistoryEntries: async (agentId, entries) => {
                    if (!unlocked) return false;
                    batches.push({ agentId, size: entries.length });
                    for (const entry of entries)
                        history.push({ agentId, entry });
                    return true;
                },
            },
            sign: (...args) => signer(...args),
            ui: {
                isForeground: () => foreground,
                // Android: foreground while locked means the unlock screen.
                showsUnlock: () => foreground,
                ...ui,
            } as never,
            service: { start: () => undefined, stop: () => undefined },
            now: () => clock,
            setTimer: (callback) => {
                timers.push(callback);
                return timers.length;
            },
            clearTimer: () => undefined,
        });
        runtime = new AgentRuntime(deps);
        await runtime.reload();
    });

    const outcomes = () => history.map((item) => item.entry.Outcome);

    it("opens the approval screen while unlocked in the foreground", async () => {
        const item = request();
        await runtime.onRequest(item);
        expect(ui.openRequest).toHaveBeenCalledWith(item.id);
        expect(ui.showNotification).not.toHaveBeenCalled();
    });

    it("posts one locked notification per agent while the vault is locked", async () => {
        unlocked = false;
        const first = request();
        await runtime.onRequest(first);
        await runtime.onRequest(request());
        await runtime.onRequest(request({ agentId: "agent-b" }));
        expect(ui.openRequest).not.toHaveBeenCalled();
        const shown = ui.showNotification.mock.calls.map((call) => call[0]);
        expect(shown).toContain(first.id);
        expect(
            new Set(ui.showNotification.mock.calls.map((call) => call[1])),
        ).toEqual(new Set(["workstation", "build-box"]));
        expect(
            ui.showNotification.mock.calls.every((call) => call[2] === true),
        ).toBe(true);
    });

    it("notifies instead of opening the screen when the app is in the background", async () => {
        foreground = false;
        await runtime.onRequest(request());
        expect(ui.showNotification).toHaveBeenCalledWith(
            expect.any(String),
            "workstation",
            false,
        );
    });

    it("denies from the notification while locked and writes the history after unlock", async () => {
        unlocked = false;
        const item = request();
        await runtime.onRequest(item);
        await runtime.deny(item.id);
        expect(answers).toEqual([
            {
                id: item.id,
                answer: { refusal: RefusalReason.REFUSAL_REASON_DENIED },
            },
        ]);
        expect(history).toHaveLength(0);
        unlocked = true;
        await runtime.onVaultUnlocked();
        expect(outcomes()).toEqual([AgentRequestOutcome.AgentOutcomeDenied]);
        expect(runtime.getRequest(item.id)).toBeUndefined();
    });

    it("signs on approve and remembers the chosen rule until the vault locks", async () => {
        const item = request();
        await runtime.onRequest(item);
        await runtime.approve(item.id, "process");
        expect(answers[0]).toEqual({
            id: item.id,
            answer: { signature: new Uint8Array([42]) },
        });

        ui.openRequest.mockClear();
        const again = request();
        await runtime.onRequest(again);
        expect(ui.openRequest).not.toHaveBeenCalled();
        expect(answers[1]?.id).toBe(again.id);
        expect(outcomes()).toEqual([
            AgentRequestOutcome.AgentOutcomeApproved,
            AgentRequestOutcome.AgentOutcomeApprovedByRule,
        ]);

        runtime.remembered.clear(); // What locking the vault does.
        await runtime.onRequest(request());
        expect(ui.openRequest).toHaveBeenCalled();
    });

    it("always asks for destination-unknown logins, even with a rule", async () => {
        const item = request();
        await runtime.onRequest(item);
        await runtime.approve(item.id, "process");
        const unknown = request({
            check: loginCheck({
                destinationUnknown: true,
                verifiedHost: undefined,
            }),
        });
        await runtime.onRequest(unknown);
        expect(runtime.getRequest(unknown.id)).toBeDefined();
        expect(answers.map((entry) => entry.id)).not.toContain(unknown.id);
    });

    it("refuses keys that aren't granted and requests that are neither login nor SSHSIG", async () => {
        granted = false;
        const item = request();
        await runtime.onRequest(item);
        expect(answers[0]).toEqual({
            id: item.id,
            answer: { refusal: RefusalReason.REFUSAL_REASON_KEY_NOT_GRANTED },
        });
        granted = true;
        const other = request({
            check: {
                kind: "other",
                forwardedVia: [],
                destinationUnknown: false,
            },
        });
        await runtime.onRequest(other);
        expect(answers[1]).toEqual({
            id: other.id,
            answer: { refusal: RefusalReason.REFUSAL_REASON_UNSUPPORTED },
        });
        expect(outcomes()).toEqual([
            AgentRequestOutcome.AgentOutcomeRefused,
            AgentRequestOutcome.AgentOutcomeRefused,
        ]);
    });

    it("never asks twice for a repeated request and caps prompts per agent", async () => {
        const item = request();
        await runtime.onRequest(item);
        await runtime.onRequest(item);
        expect(runtime.pendingRequests()).toHaveLength(1);
        for (let index = 1; index < MAX_PROMPTS_PER_AGENT; index++)
            await runtime.onRequest(request());
        const flood = request();
        await runtime.onRequest(flood);
        expect(runtime.getRequest(flood.id)).toBeUndefined();
        expect(answers.at(-1)).toEqual({
            id: flood.id,
            answer: { refusal: RefusalReason.REFUSAL_REASON_DENIED },
        });
    });

    it("records expired requests and drops requests answered elsewhere", async () => {
        const item = request();
        await runtime.onRequest(item);
        timers[0]!();
        await new Promise((resolve) => setImmediate(resolve));
        expect(runtime.getRequest(item.id)).toBeUndefined();
        expect(outcomes()).toEqual([AgentRequestOutcome.AgentOutcomeExpired]);

        const gone = request();
        await runtime.onRequest(gone);
        host.onRequestGone(gone.id);
        expect(runtime.getRequest(gone.id)).toBeUndefined();
        expect(ui.cancelNotification).toHaveBeenCalledWith(gone.id);
    });
    it("doesn't sign a request whose expiry timer ran late", async () => {
        const item = request({ expiresAt: clock + 90_000 });
        await runtime.onRequest(item);
        // The timer hasn't fired (throttled tab), but the time has passed.
        clock += 91_000;
        await expect(runtime.approve(item.id)).rejects.toThrow(
            /no longer waiting/,
        );
        expect(answers).toEqual([]);
        expect(outcomes()).toEqual([AgentRequestOutcome.AgentOutcomeExpired]);
    });

    it("opens the reviewed request after the next unlock, even after backing out of one", async () => {
        unlocked = false;
        const reviewed = request();
        const later = request();
        await runtime.onRequest(reviewed);
        expect(runtime.review(reviewed.id)).toBe(false);
        // The user backs out of unlock; another request comes in meanwhile.
        await runtime.onRequest(later);
        expect(ui.openRequest).not.toHaveBeenCalled();
        unlocked = true;
        await runtime.onVaultUnlocked();
        expect(ui.openRequest).toHaveBeenCalledWith(reviewed.id);
        expect(runtime.nextRequest()?.id).toBe(reviewed.id);
    });

    it("treats a request after an abandoned Review like any other", async () => {
        unlocked = false;
        const reviewed = request();
        await runtime.onRequest(reviewed);
        runtime.review(reviewed.id);
        await runtime.deny(reviewed.id);
        unlocked = true;
        await runtime.onVaultUnlocked();
        expect(ui.openRequest).not.toHaveBeenCalled();
        const fresh = request();
        await runtime.onRequest(fresh);
        expect(ui.openRequest).toHaveBeenCalledWith(fresh.id);
    });

    it("asks for the screen again when it never appeared", async () => {
        const item = request();
        await runtime.onRequest(item);
        expect(ui.openRequest).toHaveBeenCalledTimes(1);
        runtime.route();
        expect(ui.openRequest).toHaveBeenCalledTimes(1);
        clock += SCREEN_OPEN_GRACE_MS;
        runtime.route();
        expect(ui.openRequest).toHaveBeenCalledTimes(2);
        // Once mounted, the screen moves on by itself.
        runtime.setShownRequest(item.id, true);
        clock += SCREEN_OPEN_GRACE_MS;
        await runtime.onRequest(request());
        expect(ui.openRequest).toHaveBeenCalledTimes(2);
    });

    it("keeps a reviewed request's notification away while the app shows unlock", async () => {
        unlocked = false;
        const reviewed = request();
        await runtime.onRequest(reviewed);
        expect(ui.showNotification).toHaveBeenCalledTimes(1);
        runtime.review(reviewed.id);
        runtime.route();
        expect(ui.showNotification).toHaveBeenCalledTimes(1);
        // The user leaves the app without unlocking: it comes back.
        foreground = false;
        runtime.route();
        expect(ui.showNotification).toHaveBeenCalledTimes(2);
        expect(ui.showNotification).toHaveBeenLastCalledWith(
            reviewed.id,
            "workstation",
            true,
        );
    });

    it("refuses a paused agent's requests without asking and records them", async () => {
        cache[0] = { ...cache[0]!, paused: true };
        await runtime.reload();
        const item = request();
        await runtime.onRequest(item);
        expect(ui.openRequest).not.toHaveBeenCalled();
        expect(answers).toEqual([
            {
                id: item.id,
                answer: { refusal: RefusalReason.REFUSAL_REASON_DENIED },
            },
        ]);
        expect(outcomes()).toEqual([AgentRequestOutcome.AgentOutcomeRefused]);
        // Pausing from the prompt refuses what is already waiting.
        const other = request({ agentId: "agent-b" });
        await runtime.onRequest(other);
        await runtime.setPaused("agent-b", true);
        expect(runtime.getRequest(other.id)).toBeUndefined();
        expect(answers.at(-1)?.id).toBe(other.id);
    });

    it("keeps an agent the relay dropped as a local state and stops answering it", async () => {
        const writes = history.length;
        host.onRelayDroppedAgent("agent-a");
        expect(runtime.relayForgot("agent-a")).toBe(true);
        // Nothing reaches the vault: no tombstone, nothing removed.
        expect(history).toHaveLength(writes);
        expect(host.agents().map((agent) => agent.id)).toContain("agent-a");
        await runtime.onRequest(request());
        expect(ui.openRequest).not.toHaveBeenCalled();
        expect(answers).toEqual([]);
        host.onRelayListedAgent?.("agent-a");
        expect(runtime.relayForgot("agent-a")).toBe(false);
    });

    it("unregisters an agent revoked on another device, then forgets it here", async () => {
        cache[0] = {
            ...cache[0]!,
            deleted: true,
            relayOrigin: "https://example.com/relay",
        };
        await runtime.reload();
        expect(host.agents().map((agent) => agent.id)).toEqual(["agent-b"]);
        await until(() => !runtime.approvesLocally("agent-a"));
        expect(unregistered).toEqual([
            { id: "agent-a", url: "https://example.com/relay" },
        ]);
        expect(local.map((item) => item.agentId)).toEqual(["agent-b"]);
    });

    it("serves only agents and keys this device paired", async () => {
        // A record naming this approver that this device never paired.
        local = [{ agentId: "agent-a", keys: [] }];
        await runtime.reload();
        expect(host.agents().map((agent) => agent.id)).toEqual(["agent-a"]);
        expect(host.agents()[0]!.grantedKeys).toEqual([]);
        // The synced record grants the key, but this device never sent it.
        const item = request();
        await runtime.onRequest(item);
        expect(answers).toEqual([
            {
                id: item.id,
                answer: {
                    refusal: RefusalReason.REFUSAL_REASON_KEY_NOT_GRANTED,
                },
            },
        ]);
        await runtime.sendKeys("agent-a", {
            agentName: "workstation",
            revision: 2,
            keys: [{ publicKey: KEY, comment: "GitHub" }],
        });
        expect(local).toEqual([{ agentId: "agent-a", keys: [KEY_BASE64] }]);
        const next = request();
        await runtime.onRequest(next);
        expect(runtime.getRequest(next.id)).toBeDefined();
    });

    it("stops signing and forgets rules as soon as the vault starts locking", async () => {
        const first = request();
        await runtime.onRequest(first);
        await runtime.approve(first.id, "process");
        const waiting = request({ agentId: "agent-b" });
        await runtime.onRequest(waiting);
        runtime.setLocking(true);
        expect(runtime.remembered.size).toBe(0);
        await expect(runtime.approve(waiting.id)).rejects.toThrow(/Unlock/);
        const again = request();
        await runtime.onRequest(again);
        expect(answers.map((entry) => entry.id)).toEqual([first.id]);
        await runtime.onVaultUnlocked();
        await runtime.approve(waiting.id);
        expect(answers.at(-1)?.id).toBe(waiting.id);
    });

    /** A signer that waits until finish() is called. */
    function slowSigner() {
        let finish: (signature: Uint8Array) => void = () => undefined;
        let signal: AbortSignal | undefined;
        let started = false;
        signer = (_key, _blob, _data, _flags, options) => {
            started = true;
            signal = options?.signal;
            return new Promise((resolve) => (finish = resolve));
        };
        return {
            finish: (signature = new Uint8Array([42])) => finish(signature),
            started: () => started,
            signal: () => signal,
        };
    }

    it("sends nothing and keeps no rule when the vault locks while signing", async () => {
        const slow = slowSigner();
        const item = request();
        await runtime.onRequest(item);
        const approving = runtime.approve(item.id, "process");
        await until(slow.started);
        runtime.setLocking(true);
        slow.finish();
        await expect(approving).rejects.toThrow(/Unlock/);
        expect(answers).toEqual([]);
        expect(runtime.remembered.size).toBe(0);
        // It waits for the next unlock (or expires); nothing was answered.
        expect(runtime.getRequest(item.id)).toBeDefined();
    });

    it("tells the signer to stop when the vault starts locking", async () => {
        const slow = slowSigner();
        const item = request();
        await runtime.onRequest(item);
        const approving = runtime.approve(item.id);
        await until(slow.started);
        expect(slow.signal()?.aborted).toBe(false);
        runtime.setLocking(true);
        expect(slow.signal()?.aborted).toBe(true);
        slow.finish();
        await approving.catch(() => undefined);
    });

    it("doesn't release an old approval after a lock and the next unlock", async () => {
        const slow = slowSigner();
        const item = request();
        await runtime.onRequest(item);
        const approving = runtime.approve(item.id, "process");
        await until(slow.started);
        runtime.setLocking(true);
        await runtime.onVaultUnlocked();
        slow.finish();
        await expect(approving).rejects.toThrow(/Unlock/);
        expect(answers).toEqual([]);
        expect(runtime.remembered.size).toBe(0);
        expect(runtime.remembered.matches(request(), "cred-1")).toBe(false);
    });

    it("sends nothing from a remembered rule when the vault locks while signing", async () => {
        runtime.remembered.add(request(), "cred-1", "host");
        const slow = slowSigner();
        const item = request();
        const handling = runtime.onRequest(item);
        await until(slow.started);
        runtime.setLocking(true);
        unlocked = false;
        slow.finish();
        await handling;
        expect(answers).toEqual([]);
        // It waits like any request that comes while locked.
        expect(runtime.getRequest(item.id)).toBeDefined();
        expect(ui.showNotification).toHaveBeenCalledWith(
            item.id,
            "workstation",
            true,
        );
    });

    it("keeps the history of requests while locked within the vault's limits", async () => {
        const agents = ["a1", "a2", "a3", "a4", "a5", "a6"];
        cache = agents.map((id) => ({
            id,
            name: id,
            signPublicKey: "",
            kemPublicKey: "",
            relayOrigin: "",
            grantedKeys: [KEY_BASE64],
            paused: true,
        }));
        local = agents.map((agentId) => ({ agentId, keys: [KEY_BASE64] }));
        await runtime.reload();
        unlocked = false;
        for (let i = 0; i < 250; i++)
            for (const agentId of agents)
                await runtime.onRequest(request({ agentId }));
        expect(history).toEqual([]);
        expect(answers).toHaveLength(1500);
        unlocked = true;
        await runtime.onVaultUnlocked();
        // One write per agent, at most 200 each and 1,000 in all.
        expect(batches).toHaveLength(6);
        expect(batches.every((batch) => batch.size <= 200)).toBe(true);
        expect(history).toHaveLength(MAX_QUEUED_HISTORY);
        await runtime.flushHistory();
        expect(batches).toHaveLength(6);
    });

    it("drops locked history older than the vault keeps", async () => {
        cache[0] = { ...cache[0]!, paused: true };
        await runtime.reload();
        unlocked = false;
        await runtime.onRequest(request());
        clock += 91 * 24 * 60 * 60 * 1000;
        await runtime.onRequest(request());
        unlocked = true;
        await runtime.onVaultUnlocked();
        expect(history).toHaveLength(1);
        expect(history[0]!.entry.Timestamp).toBe(clock);
    });

    it("stops serving an agent at once when it is revoked here", async () => {
        const item = request();
        await runtime.onRequest(item);
        runtime.remembered.add(request(), "cred-1", "host");
        await runtime.unregister("agent-a");
        expect(host.agents().map((agent) => agent.id)).toEqual(["agent-b"]);
        expect(runtime.getRequest(item.id)).toBeUndefined();
        expect(runtime.remembered.matches(request(), "cred-1")).toBe(false);
        expect(unregistered).toEqual([
            { id: "agent-a", url: "https://relay.cryptex-vault.com" },
        ]);
    });

    it("shows the next request when one is withdrawn", async () => {
        unlocked = false;
        const first = request();
        const second = request();
        await runtime.onRequest(first);
        await runtime.onRequest(second);
        expect(ui.showNotification).toHaveBeenCalledTimes(1);
        host.onRequestGone(first.id);
        expect(ui.showNotification).toHaveBeenLastCalledWith(
            second.id,
            "workstation",
            true,
        );
    });

    it("stops signing even when forgetting the rules throws", async () => {
        const item = request();
        await runtime.onRequest(item);
        jest.spyOn(runtime.remembered, "clear").mockImplementation(() => {
            throw new Error("broken");
        });
        expect(() => runtime.setLocking(true)).not.toThrow();
        expect(runtime.canSign()).toBe(false);
        await expect(runtime.approve(item.id)).rejects.toThrow(/Unlock/);
    });

    it("sanitizes agent names for display", async () => {
        cache[0] = { ...cache[0]!, name: "work\u202estation\u200b" };
        await runtime.reload();
        expect(runtime.agentName("agent-a")).toBe("work\uFFFDstation\uFFFD");
    });
});

describe("stopping the runtime", () => {
    function setup() {
        const counts = { started: 0, stopped: 0 };
        let releaseIdentity: () => void = () => undefined;
        const identityLoaded = new Promise<void>((resolve) => {
            releaseIdentity = resolve;
        });
        const approver = fakeApprover({
            start: () => void counts.started++,
            stop: () => void counts.stopped++,
        });
        const cancelled: string[] = [];
        const runtime = new AgentRuntime(
            fakeRuntimeDeps({
                createApprover: () => approver,
                loadIdentity: async () => {
                    await identityLoaded;
                    return {
                        signSeed: new Uint8Array(32),
                        kemSeed: new Uint8Array(32),
                    };
                },
                vault: {
                    hasAgentRecord: () => false,
                    isPaused: () => false,
                    canSign: () => true,
                    grantedKey: () => ({
                        credentialId: "cred-1",
                        name: "GitHub",
                        sshKey: {} as never,
                    }),
                    appendHistory: async () => true,
                    appendHistoryEntries: async () => true,
                },
                ui: {
                    isForeground: () => false,
                    openRequest: () => undefined,
                    showNotification: () => undefined,
                    cancelNotification: (id) => cancelled.push(id),
                },
                setTimer: () => 0,
                clearTimer: () => undefined,
            }),
        );
        return { runtime, counts, cancelled, releaseIdentity };
    }

    it("starts no approver when the vault locks while it starts", async () => {
        const { runtime, counts, releaseIdentity } = setup();
        const reloading = runtime.reload().catch((error: unknown) => error);
        await Promise.resolve();
        runtime.stop();
        releaseIdentity();
        await reloading;
        await runtime.reload();
        expect(counts.started).toBe(0);
        expect(runtime.running).toBe(false);
    });

    it("forgets waiting requests and remembered approvals", async () => {
        const { runtime, counts, cancelled, releaseIdentity } = setup();
        releaseIdentity();
        await runtime.reload();
        expect(counts.started).toBe(1);
        const item = request();
        await runtime.onRequest(item);
        expect(runtime.remembered.add(item, "cred-1", "host")).toBe(true);
        runtime.stop();
        expect(counts.stopped).toBe(1);
        expect(runtime.pendingRequests()).toEqual([]);
        expect(cancelled).toContain(item.id);
        expect(runtime.remembered.size).toBe(0);
    });
});

describe("expiry with the real approver", () => {
    it("records Expired once and notifies the next request", async () => {
        jest.useFakeTimers();
        try {
            const history: AgentRequestRecord[] = [];
            const notified: string[] = [];
            let approver: Approver | undefined;
            const runtime = new AgentRuntime(
                fakeRuntimeDeps({
                    createApprover: (host) => {
                        approver = new Approver(host);
                        // No relay: requests are fed in below.
                        approver.start = () => undefined;
                        return approver;
                    },
                    vault: {
                        hasAgentRecord: () => false,
                        isPaused: () => false,
                        canSign: () => false,
                        grantedKey: () => "locked",
                        appendHistory: async (_agentId, entry) => {
                            history.push(entry);
                            return true;
                        },
                        appendHistoryEntries: async (_agentId, entries) => {
                            history.push(...entries);
                            return true;
                        },
                    },
                    ui: {
                        isForeground: () => false,
                        openRequest: () => undefined,
                        showNotification: (id) => notified.push(id),
                        cancelNotification: () => undefined,
                    },
                }),
            );
            await runtime.reload();
            const agent = {
                id: "agent-a",
                peer: {
                    signPublicKey: new Uint8Array(32),
                    kemPublicKey: new Uint8Array(1216),
                },
                relay: {
                    kind: "hosted",
                    url: "https://relay.cryptex-vault.com",
                },
                grantedKeys: [KEY],
            };
            const sign = request().sign;
            const now = Date.now();
            const feed = (fill: number, lifetime: number) =>
                (
                    approver as unknown as {
                        handleSignRequest(...args: unknown[]): void;
                    }
                ).handleSignRequest(
                    agent,
                    {
                        messageId: new Uint8Array(16).fill(fill),
                        expiresAt: now + lifetime,
                        retain: false,
                    },
                    { ...sign, data: sshsig("git") },
                    now,
                );
            feed(1, 1_000);
            feed(2, 2_000);
            expect(runtime.waitingCount()).toBe(2);
            expect(notified).toHaveLength(1);
            await jest.advanceTimersByTimeAsync(1_001);
            expect(runtime.waitingCount()).toBe(1);
            expect(history.map((entry) => entry.Outcome)).toEqual([
                AgentRequestOutcome.AgentOutcomeExpired,
            ]);
            expect(notified).toHaveLength(2);
            await jest.advanceTimersByTimeAsync(1_000);
            expect(history).toHaveLength(2);
            runtime.stop();
        } finally {
            jest.useRealTimers();
        }
    });
});

/** What a fake approver's accept resolves with. */
const PAIRED = {
    confirmationCode: "1234-5678",
    revocationSeed: new Uint8Array(32),
    keysRevision: 1,
};

describe("device-local approvals", () => {
    it("never lets tombstone cleanup and pairing overwrite each other", async () => {
        let stored: LocalAgentApproval[] = [
            { agentId: "agent-a", keys: [KEY_BASE64] },
        ];
        // Storage that answers reads late, in the order they finish.
        const reads: Array<() => void> = [];
        let holdReads = false;
        let finishUnregister: () => void = () => undefined;
        const runtime = new AgentRuntime(
            fakeRuntimeDeps({
                loadAgentCache: async () => [
                    {
                        id: "agent-a",
                        name: "old",
                        signPublicKey: "",
                        kemPublicKey: "",
                        relayOrigin: "",
                        deleted: true,
                    },
                ],
                localApprovals: {
                    load: () => {
                        const snapshot = structuredClone(stored);
                        if (!holdReads) return Promise.resolve(snapshot);
                        return new Promise((resolve) =>
                            reads.push(() => resolve(snapshot)),
                        );
                    },
                    save: async (next) => {
                        stored = structuredClone(next);
                    },
                },
                createApprover: () =>
                    fakeApprover({
                        accept: async () => PAIRED,
                        unregister: () =>
                            new Promise<void>((resolve) => {
                                finishUnregister = resolve;
                            }),
                    }),
            }),
        );
        await runtime.reload(); // starts removing agent-a on its relay
        holdReads = true;
        const pairing = runtime.accept({ agentId: "agent-b" } as never, {
            agentName: "new",
            keys: [{ publicKey: KEY, comment: "key" }],
        });
        finishUnregister();
        for (let i = 0; i < 20; i++) {
            await new Promise((resolve) => setImmediate(resolve));
            // Answer the reads newest first.
            reads
                .splice(0)
                .reverse()
                .forEach((release) => release());
        }
        holdReads = false;
        await pairing;
        await until(() => !runtime.approvesLocally("agent-a"));
        expect(stored).toEqual([{ agentId: "agent-b", keys: [KEY_BASE64] }]);
        expect(runtime.approvesLocally("agent-b")).toBe(true);
        runtime.stop();
    });
});

describe("server names the user approved before", () => {
    const known = (
        Fingerprint: string,
        Name: string,
        FirstSeenTimestamp = 1,
    ) => ({
        Fingerprint,
        Name,
        FirstSeenTimestamp,
    });
    const login = (fingerprint: string, name: string) =>
        request({
            check: loginCheck({
                verifiedHost: {
                    hostKey: new Uint8Array(1),
                    fingerprint,
                    names: [name],
                },
            }),
        });

    it("warns when a known host key comes under a new name, or a known name with a new key", () => {
        const agent = {
            KnownHosts: [
                known("SHA256:prod", "prod-db"),
                known("SHA256:gh", "github.com"),
            ],
        };
        const renamed = checkKnownHost(
            agent,
            login("SHA256:prod", "github.com"),
        );
        expect(knownHostWarnings(renamed)).toEqual([
            "github.com has a different host key than before.",
            "This machine now calls this server github.com. Before, it was prod-db.",
        ]);
        expect(serverNameNote(renamed)).toBe(
            "Name reported by the machine, not verified",
        );
        const same = checkKnownHost(agent, login("SHA256:gh", "github.com"));
        expect(same?.known).toBe(true);
        expect(knownHostWarnings(same)).toEqual([]);
        // First time: no warning, but the name is marked as the machine's.
        const fresh = checkKnownHost(agent, login("SHA256:new", "gitlab.com"));
        expect(knownHostWarnings(fresh)).toEqual([]);
        expect(serverNameNote(fresh)).toBe(
            "Name reported by the machine, not verified",
        );
    });
});

describe("reloading", () => {
    it("applies reloads in the order they were asked for", async () => {
        // The phone's pairing screen closes (a reload that reads the agent
        // cache before the new agent is in it) while the vault sync writes
        // the cache and reloads: the older read must not win and stop the
        // approver the new agent's first request goes to.
        const agentA: CachedAgent = {
            id: "agent-a",
            name: "workstation",
            signPublicKey: "",
            kemPublicKey: "",
            relayOrigin: "",
            grantedKeys: [KEY_BASE64],
        };
        let cache: CachedAgent[] = [];
        // Storage that answers reads late, newest first.
        const reads: Array<() => void> = [];
        let holdReads = false;
        const runtime = new AgentRuntime(
            fakeRuntimeDeps({
                loadAgentCache: () => {
                    const snapshot = structuredClone(cache);
                    if (!holdReads) return Promise.resolve(snapshot);
                    return new Promise((resolve) =>
                        reads.push(() => resolve(snapshot)),
                    );
                },
            }),
        );
        await runtime.reload();
        expect(runtime.running).toBe(false);

        holdReads = true;
        const stale = runtime.reload();
        cache = [agentA];
        const fresh = runtime.reload();
        let done = false;
        void Promise.all([stale, fresh]).then(() => (done = true));
        for (let i = 0; i < 50 && !done; i++) {
            await new Promise((resolve) => setImmediate(resolve));
            reads
                .splice(0)
                .reverse()
                .forEach((release) => release());
        }
        await Promise.all([stale, fresh]);
        expect(runtime.running).toBe(true);
        runtime.stop();
    });
});

describe("a request between PairingConfirm and the vault save", () => {
    function setup() {
        const agentA: CachedAgent = {
            id: "agent-a",
            name: "workstation",
            signPublicKey: "",
            kemPublicKey: "",
            relayOrigin: "",
            grantedKeys: [KEY_BASE64],
        };
        const state = {
            saved: false,
            cache: [] as CachedAgent[],
            local: [] as LocalAgentApproval[],
        };
        const answers: Array<{ id: string; answer: SignAnswer }> = [];
        const opened: string[] = [];
        const notified: string[] = [];
        const timers: Array<() => void> = [];
        const runtime = new AgentRuntime(
            fakeRuntimeDeps({
                loadAgentCache: async () => state.cache,
                localApprovals: {
                    load: async () => state.local,
                    save: async (next) => {
                        state.local = next;
                    },
                },
                vault: {
                    hasAgentRecord: () => false,
                    isPaused: () => false,
                    canSign: () => true,
                    // The vault knows the agent only once the save lands.
                    grantedKey: (agentId) =>
                        state.saved && agentId === "agent-a"
                            ? {
                                  credentialId: "cred-1",
                                  name: "GitHub",
                                  sshKey: {} as never,
                              }
                            : null,
                    appendHistory: async () => true,
                    appendHistoryEntries: async () => true,
                },
                ui: {
                    isForeground: () => true,
                    openRequest: (id) => void opened.push(id),
                    showNotification: (id) => void notified.push(id),
                    cancelNotification: () => undefined,
                },
                setTimer: (callback) => timers.push(callback),
                clearTimer: () => undefined,
                createApprover: () =>
                    fakeApprover({
                        accept: async () => PAIRED,
                        answer: async (id, answer) => {
                            answers.push({ id, answer });
                        },
                    }),
            }),
        );
        const pair = async () => {
            const end = await runtime.beginPairing();
            await runtime.accept({ agentId: "agent-a" } as never, {
                agentName: "workstation",
                keys: [{ publicKey: KEY, comment: "key" }],
            });
            return end;
        };
        const save = async () => {
            state.saved = true;
            state.cache = [agentA];
            await runtime.reload();
        };
        return { runtime, answers, opened, notified, timers, pair, save };
    }

    it("waits for the save, then asks as usual", async () => {
        const t = setup();
        const end = await t.pair();
        const item = request();
        await t.runtime.onRequest(item);
        // Not refused as an unknown key, and no prompt yet.
        expect(t.answers).toEqual([]);
        expect(t.opened).toEqual([]);
        expect(t.notified).toEqual([]);
        expect(t.runtime.pendingRequests()).toEqual([]);

        await t.save();
        await until(() => t.opened.includes(item.id));
        expect(t.runtime.pendingRequests().map((r) => r.id)).toEqual([item.id]);
        expect(t.answers).toEqual([]);
        end();
        await t.runtime.reload();
        expect(t.runtime.pendingRequests().map((r) => r.id)).toEqual([item.id]);
        t.runtime.stop();
    });

    it("is refused once the save fails", async () => {
        const t = setup();
        await t.pair();
        const item = request();
        await t.runtime.onRequest(item);
        expect(t.answers).toEqual([]);
        t.runtime.pairingFailed("agent-a");
        await until(() => t.answers.length === 1);
        expect(t.answers[0]).toEqual({
            id: item.id,
            answer: { refusal: RefusalReason.REFUSAL_REASON_KEY_NOT_GRANTED },
        });
        expect(t.opened).toEqual([]);
        t.runtime.stop();
    });

    it("is refused when the pairing ends without the agent saved", async () => {
        const t = setup();
        const end = await t.pair();
        const item = request();
        await t.runtime.onRequest(item);
        end();
        await until(() => t.answers.length === 1);
        expect(t.answers[0]?.answer).toEqual({
            refusal: RefusalReason.REFUSAL_REASON_KEY_NOT_GRANTED,
        });
        expect(t.opened).toEqual([]);
        t.runtime.stop();
    });
});
