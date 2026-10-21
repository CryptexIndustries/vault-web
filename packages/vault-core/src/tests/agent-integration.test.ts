/**
 * The TypeScript approver against the real Go relay and cryptex-agent:
 * pair, approve an `ssh-keygen -Y sign`, deny one, revoke over HTTP.
 * Builds both binaries from services/ with `go build`. Skipped when Go or
 * ssh-keygen is missing, except in CI, where it fails instead.
 *
 * @jest-environment node
 */
import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { spawn, spawnSync, type ChildProcess } from "child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { createServer } from "net";
import { tmpdir } from "os";
import { join } from "path";

import { base64ToUint8, base64UrlToUint8 } from "../encoding";
import { RefusalReason } from "../proto/agent";
import { Approver } from "../agent/approver";
import type {
    ApprovedAgent,
    ApproverHost,
    IncomingRequest,
    RelayTarget,
    SignAnswer,
    WebSocketLike,
} from "../agent/approver-types";
import { generateAgentIdentity } from "../agent/envelope";
import { Backoff, revokeOverHttp } from "../agent/relay-client";
import { generateSSHKey } from "../vault-utils/ssh-key";
import { signSSH } from "../vault-utils/ssh-sign";

const SERVICES = join(__dirname, "../../../../services");
const hasTool = (cmd: string, args: string[]) =>
    spawnSync(cmd, args).error === undefined;
const hasGo = hasTool("go", ["version"]);
const hasSSHKeygen = hasTool("ssh-keygen", ["-?"]);
const ready = hasGo && hasSSHKeygen;

if (!ready) {
    const missing = hasGo ? "ssh-keygen" : "go";
    if (process.env.CI) {
        throw new Error(
            `agent-integration: ${missing} isn't on PATH; CI must run this test`,
        );
    }
    console.warn(`agent-integration: skipped, ${missing} isn't on PATH`);
}

const describeIfReady = ready ? describe : describe.skip;
jest.setTimeout(180_000);

const TOKEN = "integration-test-token-0123456789abcdef";

const freePort = () =>
    new Promise<number>((resolve, reject) => {
        const server = createServer();
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
            const address = server.address();
            server.close(() =>
                resolve(
                    typeof address === "object" && address ? address.port : 0,
                ),
            );
        });
    });

/** Collects a child's output and lets tests wait for a line. */
class Child {
    output = "";
    exit: Promise<number | null>;
    private listeners: (() => void)[] = [];

    constructor(readonly proc: ChildProcess) {
        const add = (chunk: Buffer) => {
            this.output += chunk.toString("utf8");
            for (const l of this.listeners) l();
        };
        proc.stdout?.on("data", add);
        proc.stderr?.on("data", add);
        this.exit = new Promise((resolve) =>
            proc.on("exit", (code) => resolve(code)),
        );
    }

    waitFor(pattern: RegExp, timeoutMs = 30_000): Promise<RegExpMatchArray> {
        return new Promise((resolve, reject) => {
            const check = () => {
                const m = this.output.match(pattern);
                if (m) {
                    clearTimeout(timer);
                    this.listeners = this.listeners.filter((l) => l !== check);
                    resolve(m);
                }
            };
            const timer = setTimeout(() => {
                this.listeners = this.listeners.filter((l) => l !== check);
                reject(
                    new Error(
                        `timed out waiting for ${pattern}; output so far:\n${this.output}`,
                    ),
                );
            }, timeoutMs);
            this.listeners.push(check);
            check();
        });
    }

    kill() {
        if (this.proc.exitCode === null) this.proc.kill("SIGTERM");
    }
}

const waitUntil = async (
    cond: () => boolean,
    what: string,
    timeoutMs = 30_000,
) => {
    const end = Date.now() + timeoutMs;
    while (!cond()) {
        if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
        await new Promise((r) => setTimeout(r, 50));
    }
};

const run = (
    cmd: string,
    args: string[],
    env: NodeJS.ProcessEnv,
    input?: string,
) =>
    new Promise<{ code: number | null; output: string }>((resolve) => {
        const proc = spawn(cmd, args, { env, stdio: ["pipe", "pipe", "pipe"] });
        let output = "";
        proc.stdout.on("data", (c: Buffer) => (output += c.toString()));
        proc.stderr.on("data", (c: Buffer) => (output += c.toString()));
        proc.on("exit", (code) => resolve({ code, output }));
        proc.stdin.end(input ?? "");
    });

describeIfReady(
    "TypeScript approver with the Go relay and cryptex-agent",
    () => {
        let dir: string;
        let relayURL: string;
        let relay: Child;
        let agentService: Child | undefined;
        let agentEnv: NodeJS.ProcessEnv;
        let approver: Approver;
        const agents: ApprovedAgent[] = [];
        const requests: IncomingRequest[] = [];
        const confirmed: string[] = [];
        const revoked: string[] = [];
        let decide: (
            request: IncomingRequest,
        ) => Promise<SignAnswer> = async () => ({
            refusal: RefusalReason.REFUSAL_REASON_DENIED,
        });
        const key = generateSSHKey("integration@cryptex");
        const keyBlob = base64ToUint8(key.PublicKey.trim().split(/\s+/)[1]!);
        let relayTarget: RelayTarget;
        let agentId = "";
        let revocationSeed: Uint8Array;

        beforeAll(async () => {
            dir = mkdtempSync(join(tmpdir(), "cx-agent-it-"));
            const bin = join(dir, "bin");
            mkdirSync(bin);
            const build = spawnSync(
                "go",
                [
                    "build",
                    "-o",
                    bin + "/",
                    "./cmd/relay-server",
                    "./cmd/cryptex-agent",
                ],
                { cwd: SERVICES, encoding: "utf8" },
            );
            if (build.status !== 0)
                throw new Error(`go build failed:\n${build.stderr}`);

            const port = await freePort();
            const metricsPort = await freePort();
            relayURL = `http://127.0.0.1:${port}`;
            relay = new Child(
                spawn(join(bin, "relay-server"), [], {
                    env: {
                        PATH: process.env.PATH,
                        RELAY_LISTEN_ADDR: `127.0.0.1:${port}`,
                        RELAY_METRICS_ADDR: `127.0.0.1:${metricsPort}`,
                        RELAY_DB_PATH: join(dir, "relay.db"),
                        RELAY_PUBLIC_URL: relayURL,
                        RELAY_AUTH_MODE: "token",
                        RELAY_ACCESS_TOKEN: TOKEN,
                        RELAY_KEEPALIVE_SECONDS: "10",
                    },
                }),
            );
            const healthy = async () => {
                try {
                    return (await fetch(`${relayURL}/healthz`)).status === 204;
                } catch {
                    return false;
                }
            };
            for (let i = 0; !(await healthy()); i++) {
                if (i > 200)
                    throw new Error(`relay didn't start:\n${relay.output}`);
                await new Promise((r) => setTimeout(r, 50));
            }

            const runtime = join(dir, "run");
            mkdirSync(runtime, { mode: 0o700 });
            agentEnv = {
                PATH: process.env.PATH,
                HOME: dir,
                XDG_DATA_HOME: join(dir, "data"),
                XDG_CONFIG_HOME: join(dir, "config"),
                XDG_RUNTIME_DIR: runtime,
            };
            relayTarget = { kind: "custom", url: relayURL, token: TOKEN };

            const host: ApproverHost = {
                identity: generateAgentIdentity(),
                deviceName: "Jest phone",
                openWebSocket: (url, protocols) =>
                    new WebSocket(url, protocols) as unknown as WebSocketLike,
                fetch,
                getPass: async () => null,
                relays: () => [relayTarget],
                agents: () => agents,
                onRequest: (request) => {
                    requests.push(request);
                    void decide(request).then((answer) =>
                        approver.answer(request.id, answer),
                    );
                },
                onRequestGone: () => {},
                onAgentConfirmed: (id) => confirmed.push(id),
                onRelayDroppedAgent: (id) => revoked.push(id),
            };
            approver = new Approver(host, {
                backoff: () => new Backoff(100, 1000),
            });
            approver.start();
        });

        afterAll(async () => {
            approver?.stop();
            agentService?.kill();
            relay?.kill();
            await Promise.all([agentService?.exit, relay?.exit]);
            if (dir) rmSync(dir, { recursive: true, force: true });
        });

        it("pairs with cryptex-agent pair", async () => {
            const pair = new Child(
                spawn(
                    join(dir, "bin", "cryptex-agent"),
                    ["pair", "--relay", relayURL],
                    {
                        env: agentEnv,
                        stdio: ["pipe", "pipe", "pipe"],
                    },
                ),
            );
            try {
                const [code] = await pair.waitFor(
                    /cryptex-pair:[A-Za-z0-9_-]+/,
                );
                const claim = await approver.claim(code);
                expect(claim.relay).toEqual(relayTarget);
                await pair.waitFor(/Code received/);
                const result = await approver.accept(claim, {
                    agentName: "integration box",
                    keys: [
                        {
                            publicKey: keyBlob,
                            comment: "Integration (Cryptex Vault)",
                        },
                    ],
                });
                expect(result.keysRevision).toBe(1);
                // The terminal shows the same code; Enter confirms it there.
                await pair.waitFor(
                    new RegExp(`\\n\\s+${result.confirmationCode}\\n`),
                );
                const confirmation = approver.waitConfirmed(
                    claim.agentId,
                    30_000,
                );
                pair.proc.stdin!.write("\n");
                await confirmation;
                expect(await pair.exit).toBe(0);
                expect(pair.output).toContain(
                    'Paired with Jest phone as "integration box".',
                );
                expect(confirmed).toEqual([claim.agentId]);

                agentId = claim.agentId;
                revocationSeed = result.revocationSeed;
                agents.push({
                    id: agentId,
                    signPublicKey: claim.offer.signPublicKey,
                    kemPublicKey: claim.offer.kemPublicKey,
                    relay: relayTarget,
                    grantedKeys: [keyBlob],
                });
                approver.refresh();
            } finally {
                pair.kill();
            }
        });

        const sign = async (name: string) => {
            const socket = join(
                agentEnv.XDG_RUNTIME_DIR!,
                "cryptex-agent.sock",
            );
            const pubPath = join(dir, "key.pub");
            writeFileSync(pubPath, `${key.PublicKey.trim()} ${key.Comment}\n`);
            const dataPath = join(dir, `${name}.txt`);
            writeFileSync(
                dataPath,
                `signed by the integration test: ${name}\n`,
            );
            const result = await run(
                "ssh-keygen",
                ["-Y", "sign", "-f", pubPath, "-n", "file", dataPath],
                { ...agentEnv, SSH_AUTH_SOCK: socket },
            );
            return { ...result, dataPath, pubPath };
        };

        it("approves ssh-keygen -Y sign with a real signature", async () => {
            expect(agentId).not.toBe("");
            agentService = new Child(
                spawn(join(dir, "bin", "cryptex-agent"), ["run"], {
                    env: agentEnv,
                }),
            );
            const socket = join(
                agentEnv.XDG_RUNTIME_DIR!,
                "cryptex-agent.sock",
            );
            await waitUntil(() => existsSync(socket), "the agent socket");
            // The service connects to the relay on its own schedule.
            await agentService.waitFor(/Connected to the relay/);

            decide = async (request) => ({
                signature: await signSSH(
                    key,
                    request.sign.publicKey,
                    request.sign.data,
                    request.sign.flags,
                ),
            });
            const { code, output, dataPath, pubPath } = await sign("approved");
            expect(output).not.toMatch(/error/i);
            expect(code).toBe(0);
            const request = requests.at(-1)!;
            expect(request.agentId).toBe(agentId);
            expect(request.check).toMatchObject({
                kind: "signature",
                namespace: "file",
                destinationUnknown: false,
            });

            const allowed = join(dir, "allowed_signers");
            const pub = key.PublicKey.trim().split(/\s+/).slice(0, 2).join(" ");
            writeFileSync(allowed, `integration@cryptex ${pub}\n`);
            const verify = spawnSync(
                "ssh-keygen",
                [
                    "-Y",
                    "verify",
                    "-f",
                    allowed,
                    "-I",
                    "integration@cryptex",
                    "-n",
                    "file",
                    "-s",
                    `${dataPath}.sig`,
                ],
                {
                    input: `signed by the integration test: approved\n`,
                    encoding: "utf8",
                },
            );
            expect(verify.stdout + verify.stderr).toContain("Good");
            expect(verify.status).toBe(0);
            expect(pubPath).toBeTruthy();
        });

        it("refuses when the user denies", async () => {
            const before = requests.length;
            decide = async () => ({
                refusal: RefusalReason.REFUSAL_REASON_DENIED,
            });
            const { code, dataPath } = await sign("denied");
            expect(code).not.toBe(0);
            expect(requests.length).toBe(before + 1);
            expect(existsSync(`${dataPath}.sig`)).toBe(false);
        });

        it("revokes over HTTP, and the agent reports it", async () => {
            const status = await revokeOverHttp(
                relayURL,
                revocationSeed,
                base64UrlToUint8(agentId),
                fetch,
            );
            expect(status).toBe(204);
            await waitUntil(
                () => revoked.includes(agentId),
                "Revoked on the approver",
            );
            await agentService!.waitFor(/revoked/i, 20_000);
            const status2 = await run(
                join(dir, "bin", "cryptex-agent"),
                ["status"],
                agentEnv,
            );
            expect(status2.output).toMatch(/was revoked/);
        });
    },
);
