/**
 * Processes for the SSH agent E2E: the Go relay-server (token mode) and
 * cryptex-agent built from services/, a throwaway sshd run as the current
 * user, and a raw ssh-agent client for requests real clients don't make on
 * demand (forwarded through a jump host, or with no session-bind at all).
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import {
    generateKeyPairSync,
    randomBytes,
    sign as cryptoSign,
    type KeyObject,
} from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { connect, createServer } from "node:net";
import { tmpdir, userInfo } from "node:os";
import path from "node:path";

/** Environment for a child process, built from scratch. */
const childEnv = (vars: Record<string, string | undefined>) =>
    vars as unknown as NodeJS.ProcessEnv;

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

// Terminal escape sequences (ESC [ ... letter) that `script` passes through.
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[a-zA-Z]`, "g");

/** A child process whose output can be waited on. */
class Child {
    output = "";
    readonly exit: Promise<number | null>;
    private listeners: (() => void)[] = [];

    constructor(readonly proc: ChildProcess) {
        const add = (chunk: Buffer) => {
            this.output += chunk.toString("utf8").replace(ANSI, "");
            for (const listener of this.listeners) listener();
        };
        proc.stdout?.on("data", add);
        proc.stderr?.on("data", add);
        this.exit = new Promise((resolve) =>
            proc.on("exit", (code) => resolve(code)),
        );
    }

    waitFor(pattern: RegExp): Promise<RegExpMatchArray> {
        return new Promise((resolve, reject) => {
            const check = () => {
                const match = this.output.match(pattern);
                if (!match) return;
                clearTimeout(timer);
                this.listeners = this.listeners.filter((l) => l !== check);
                resolve(match);
            };
            const timer = setTimeout(() => {
                this.listeners = this.listeners.filter((l) => l !== check);
                reject(
                    new Error(
                        `Timed out waiting for ${pattern}; output:\n${this.output}`,
                    ),
                );
            }, 30_000);
            this.listeners.push(check);
            check();
        });
    }

    kill() {
        if (this.proc.exitCode === null && this.proc.signalCode === null)
            this.proc.kill("SIGTERM");
    }
}

export type Harness = {
    work: string;
    bin: string;
    relayUrl: string;
    token: string;
    agentEnv: NodeJS.ProcessEnv;
    knownHosts: string;
    socket: string;
    children: Set<Child>;
    start(program: string, args: string[], env?: NodeJS.ProcessEnv): Child;
    stop(): Promise<void>;
};

/** Builds the binaries and starts the relay. */
export async function startHarness(servicesDir: string): Promise<Harness> {
    const work = mkdtempSync(path.join(tmpdir(), "cryptex-web-agent-e2e-"));
    const bin = path.join(work, "bin");
    mkdirSync(bin);
    const build = spawnSync(
        "go",
        ["build", "-o", `${bin}/`, "./cmd/relay-server", "./cmd/cryptex-agent"],
        { cwd: servicesDir, encoding: "utf8" },
    );
    if (build.status !== 0)
        throw new Error(`go build failed:\n${build.stderr}`);

    const children = new Set<Child>();
    const start = (
        program: string,
        args: string[],
        env?: NodeJS.ProcessEnv,
    ) => {
        const child = new Child(
            spawn(program, args, {
                env: env ?? process.env,
                stdio: ["pipe", "pipe", "pipe"],
            }),
        );
        children.add(child);
        void child.exit.then(() => children.delete(child));
        return child;
    };

    const port = await freePort();
    const relayUrl = `http://127.0.0.1:${port}`;
    const token = randomBytes(24).toString("hex");
    start(
        path.join(bin, "relay-server"),
        [],
        childEnv({
            PATH: process.env.PATH,
            RELAY_LISTEN_ADDR: `127.0.0.1:${port}`,
            RELAY_METRICS_ADDR: "off",
            RELAY_DB_PATH: path.join(work, "relay.db"),
            RELAY_PUBLIC_URL: relayUrl,
            RELAY_AUTH_MODE: "token",
            RELAY_ACCESS_TOKEN: token,
        }),
    );
    for (let i = 0; ; i++) {
        try {
            if ((await fetch(`${relayUrl}/healthz`)).status === 204) break;
        } catch {
            // Not up yet.
        }
        if (i > 200) throw new Error("The relay didn't start");
        await new Promise((resolve) => setTimeout(resolve, 50));
    }

    // The agent keeps its keys and settings under its own HOME and XDG dirs.
    const home = path.join(work, "home");
    mkdirSync(path.join(home, ".ssh"), { recursive: true, mode: 0o700 });
    const agentEnv = childEnv({
        PATH: process.env.PATH,
        HOME: home,
        TERM: "dumb",
        XDG_DATA_HOME: path.join(work, "data"),
        XDG_CONFIG_HOME: path.join(work, "config"),
        XDG_RUNTIME_DIR: path.join(work, "run"),
    });
    mkdirSync(agentEnv.XDG_RUNTIME_DIR!, { mode: 0o700 });
    const socket = path.join(agentEnv.XDG_RUNTIME_DIR!, "cryptex-agent.sock");

    return {
        work,
        bin,
        relayUrl,
        token,
        agentEnv,
        knownHosts: path.join(home, ".ssh", "known_hosts"),
        socket,
        children,
        start,
        async stop() {
            const running = [...children];
            for (const child of running) child.kill();
            await Promise.all(running.map((child) => child.exit));
        },
    };
}

/** An OpenSSH server on a free port, as the current user, trusting `authorized`. */
export async function startSSHD(harness: Harness, authorized: string[]) {
    const binary = ["/usr/sbin/sshd", "/usr/bin/sshd"].find(
        (candidate) => spawnSync("test", ["-x", candidate]).status === 0,
    );
    if (!binary) return null;
    const dir = path.join(harness.work, "sshd");
    mkdirSync(dir);
    const hostKey = path.join(dir, "host_ed25519");
    spawnSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", hostKey]);
    writeFileSync(
        path.join(dir, "authorized_keys"),
        `${authorized.join("\n")}\n`,
        { mode: 0o600 },
    );
    const port = await freePort();
    const user = userInfo().username;
    writeFileSync(
        path.join(dir, "sshd_config"),
        [
            `Port ${port}`,
            "ListenAddress 127.0.0.1",
            `HostKey ${hostKey}`,
            `AuthorizedKeysFile ${path.join(dir, "authorized_keys")}`,
            `PidFile ${path.join(dir, "sshd.pid")}`,
            "StrictModes no",
            "UsePAM no",
            "PasswordAuthentication no",
            "KbdInteractiveAuthentication no",
            "AllowAgentForwarding yes",
            `AllowUsers ${user}`,
        ].join("\n") + "\n",
    );
    const server = harness.start(binary, [
        "-D",
        "-e",
        "-f",
        path.join(dir, "sshd_config"),
    ]);
    const [type, blob] = readFileSync(`${hostKey}.pub`, "utf8").split(/\s+/);
    writeFileSync(harness.knownHosts, `[127.0.0.1]:${port} ${type} ${blob}\n`, {
        flag: "a",
    });
    for (let i = 0; ; i++) {
        const scan = spawnSync(
            "ssh-keyscan",
            ["-p", String(port), "-t", "ed25519", "127.0.0.1"],
            { encoding: "utf8" },
        );
        if (scan.status === 0 && scan.stdout.trim()) break;
        if (i > 100) throw new Error(`sshd didn't start:\n${server.output}`);
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return {
        port,
        user,
        /** ssh with only the agent's keys; resolves with the exit code and output. */
        login(command: string) {
            const child = harness.start(
                "ssh",
                [
                    "-F",
                    "none",
                    "-p",
                    String(port),
                    ...[
                        `IdentityAgent=${harness.socket}`,
                        "IdentityFile=/dev/null",
                        `UserKnownHostsFile=${harness.knownHosts}`,
                        "StrictHostKeyChecking=yes",
                        "HostKeyAlgorithms=ssh-ed25519",
                        "BatchMode=yes",
                        "PubkeyAcceptedAlgorithms=ssh-ed25519",
                    ].flatMap((option) => ["-o", option]),
                    `${user}@127.0.0.1`,
                    command,
                ],
                harness.agentEnv,
            );
            return child.exit.then((code) => ({
                code,
                output: child.output.trim(),
            }));
        },
    };
}

// ---------------------------------------------------------------------------
// A raw ssh-agent client

const u32 = (n: number) => {
    const b = Buffer.alloc(4);
    b.writeUInt32BE(n);
    return b;
};
const str = (value: Buffer | string) => {
    const b = typeof value === "string" ? Buffer.from(value) : value;
    return Buffer.concat([u32(b.length), b]);
};

/** A made-up Ed25519 server key that signs session IDs like sshd does. */
export function fakeHostKey() {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const raw = Buffer.from(
        publicKey.export({ format: "jwk" }).x!,
        "base64url",
    );
    const blob = Buffer.concat([str("ssh-ed25519"), str(raw)]);
    return {
        blob,
        line: `ssh-ed25519 ${blob.toString("base64")}`,
        signSession: (sessionId: Buffer) =>
            Buffer.concat([
                str("ssh-ed25519"),
                str(cryptoSign(null, sessionId, privateKey as KeyObject)),
            ]),
    };
}

/**
 * Talks to the agent socket directly: optional session-binds, then one
 * userauth sign request. Resolves true when the agent signed.
 */
export function rawLoginRequest(
    socketPath: string,
    keyBlob: Buffer,
    binds: { host: ReturnType<typeof fakeHostKey>; forwarding: boolean }[],
): Promise<boolean> {
    return new Promise((resolve, reject) => {
        const conn = connect(socketPath);
        let buffer = Buffer.alloc(0);
        const replies: ((type: number) => void)[] = [];
        conn.on("data", (chunk) => {
            buffer = Buffer.concat([buffer, chunk]);
            while (
                buffer.length >= 4 &&
                buffer.length >= 4 + buffer.readUInt32BE(0)
            ) {
                const length = buffer.readUInt32BE(0);
                const type = buffer[4]!;
                buffer = buffer.subarray(4 + length);
                replies.shift()?.(type);
            }
        });
        conn.on("error", reject);
        const send = (body: Buffer) =>
            new Promise<number>((done) => {
                replies.push(done);
                conn.write(Buffer.concat([u32(body.length), body]));
            });
        void (async () => {
            let sessionId = randomBytes(32);
            for (const bind of binds) {
                sessionId = randomBytes(32);
                const contents = Buffer.concat([
                    str(bind.host.blob),
                    str(sessionId),
                    str(bind.host.signSession(sessionId)),
                    Buffer.from([bind.forwarding ? 1 : 0]),
                ]);
                const reply = await send(
                    Buffer.concat([
                        Buffer.from([27]),
                        str("session-bind@openssh.com"),
                        contents,
                    ]),
                );
                if (reply !== 6)
                    throw new Error(`session-bind refused (${reply})`);
            }
            const data = Buffer.concat([
                str(sessionId),
                Buffer.from([50]),
                str("deploy"),
                str("ssh-connection"),
                str("publickey"),
                Buffer.from([1]),
                str("ssh-ed25519"),
                str(keyBlob),
            ]);
            const reply = await send(
                Buffer.concat([
                    Buffer.from([13]),
                    str(keyBlob),
                    str(data),
                    u32(0),
                ]),
            );
            conn.end();
            resolve(reply === 14);
        })().catch((error: unknown) => {
            conn.destroy();
            reject(error as Error);
        });
    });
}
