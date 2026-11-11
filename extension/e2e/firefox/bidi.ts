import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

export type BidiEvent = { method: string; params: Record<string, any> };

type RemoteValue = { type: string; value?: any };

/** A WebDriver BiDi session with a Firefox process it started. */
export class Bidi {
    private nextId = 1;
    private readonly pending = new Map<
        number,
        { resolve: (value: any) => void; reject: (error: Error) => void }
    >();
    private readonly listeners = new Set<(event: BidiEvent) => void>();

    private constructor(
        private readonly socket: WebSocket,
        private readonly process: ChildProcess,
        readonly logs: string[],
    ) {
        socket.addEventListener("message", (message) => {
            const data = JSON.parse(String(message.data));
            if (data.type === "event") {
                for (const listener of this.listeners) listener(data);
                return;
            }
            const request = this.pending.get(data.id);
            if (!request) return;
            this.pending.delete(data.id);
            if (data.type === "error") {
                request.reject(new Error(`${data.error}: ${data.message}`));
            } else {
                request.resolve(data.result);
            }
        });
        socket.addEventListener("close", (event) => {
            logs.push(`BiDi connection closed: ${event.code} ${event.reason}`);
            for (const request of this.pending.values()) {
                request.reject(new Error("Firefox closed the connection"));
            }
            this.pending.clear();
        });
    }

    static async launch({
        executablePath,
        userDataDir,
        headless,
        prefs,
    }: {
        executablePath: string;
        userDataDir: string;
        headless: boolean;
        prefs: Record<string, string | number | boolean>;
    }) {
        await fs.writeFile(
            path.join(userDataDir, "user.js"),
            Object.entries(prefs)
                .map(
                    ([name, value]) =>
                        `user_pref(${JSON.stringify(name)}, ${JSON.stringify(value)});`,
                )
                .join("\n"),
        );
        const firefox = spawn(
            executablePath,
            [
                ...(headless ? ["--headless"] : []),
                "--no-remote",
                "--profile",
                userDataDir,
                "--remote-debugging-port=0",
            ],
            {
                stdio: ["ignore", "pipe", "pipe"],
                // Extension pages are privileged, and BiDi drives them only
                // with system access.
                env: { ...process.env, MOZ_REMOTE_ALLOW_SYSTEM_ACCESS: "1" },
            },
        );
        const logs: string[] = [];
        try {
            return await Bidi.connect(firefox, logs);
        } catch (error) {
            firefox.kill("SIGKILL");
            throw error;
        }
    }

    private static async connect(firefox: ChildProcess, logs: string[]) {
        const url = await new Promise<string>((resolve, reject) => {
            const timer = setTimeout(
                () =>
                    reject(
                        new Error(
                            `Firefox did not start WebDriver BiDi:\n${logs.join("\n")}`,
                        ),
                    ),
                30_000,
            );
            const read = (chunk: Buffer) => {
                for (const line of chunk.toString().split("\n")) {
                    if (!line.trim()) continue;
                    logs.push(line);
                    if (logs.length > 500) logs.shift();
                    const match = line.match(
                        /WebDriver BiDi listening on (ws:\/\/\S+)/,
                    );
                    if (match) {
                        clearTimeout(timer);
                        resolve(match[1]!);
                    }
                }
            };
            firefox.stdout!.on("data", read);
            firefox.stderr!.on("data", read);
            firefox.once("exit", (code) => {
                clearTimeout(timer);
                reject(
                    new Error(
                        `Firefox exited with ${code}:\n${logs.join("\n")}`,
                    ),
                );
            });
            firefox.once("error", reject);
        });
        firefox.on("exit", (code, signal) =>
            logs.push(`Firefox exited with ${signal ?? code}`),
        );
        const socket = new WebSocket(`${url}/session`);
        await new Promise((resolve, reject) => {
            socket.addEventListener("open", resolve, { once: true });
            socket.addEventListener("error", reject, { once: true });
        });
        const bidi = new Bidi(socket, firefox, logs);
        await bidi.send("session.new", {
            // The e2e Garage's https certificate comes from a test CA.
            capabilities: { alwaysMatch: { acceptInsecureCerts: true } },
        });
        return bidi;
    }

    send(method: string, params: object = {}): Promise<any> {
        const id = this.nextId++;
        const message = JSON.stringify({ id, method, params });
        // Logs a command Firefox never answers, which would otherwise show
        // only as a test timeout.
        const watchdog = setTimeout(() => {
            const { functionDeclaration: _, ...rest } = params as {
                functionDeclaration?: string;
            };
            this.logs.push(
                `No answer after 10 s to ${method} ${JSON.stringify(rest).slice(0, 400)}`,
            );
        }, 10_000);
        return new Promise((resolve, reject) => {
            this.pending.set(id, {
                resolve: (value) => {
                    clearTimeout(watchdog);
                    resolve(value);
                },
                reject: (error) => {
                    clearTimeout(watchdog);
                    reject(error);
                },
            });
            this.socket.send(message);
        });
    }

    on(listener: (event: BidiEvent) => void) {
        this.listeners.add(listener);
    }

    /** Calls a function in a browsing context and returns its result. */
    async call(
        context: string,
        functionDeclaration: string,
        args: unknown[] = [],
    ): Promise<any> {
        const result = await this.callRaw(context, functionDeclaration, args);
        return deserialize(result);
    }

    async callRaw(
        context: string,
        functionDeclaration: string,
        args: unknown[] = [],
    ): Promise<RemoteValue> {
        const response = await this.send("script.callFunction", {
            functionDeclaration,
            target: { context },
            arguments: args.map(serialize),
            awaitPromise: true,
            resultOwnership: "none",
        });
        if (response.type === "exception") {
            throw new Error(response.exceptionDetails.text);
        }
        return response.result;
    }

    async close() {
        if (
            this.process.exitCode === null &&
            this.process.signalCode === null
        ) {
            const exited = new Promise((resolve) =>
                this.process.once("exit", resolve),
            );
            // Firefox may never answer browser.close, so the kill is armed
            // first.
            const timer = setTimeout(() => this.process.kill("SIGKILL"), 5000);
            this.send("browser.close").catch(() => {});
            await exited;
            clearTimeout(timer);
        }
        this.socket.close();
    }
}

/** A function the page can call to send the driver a script.message. */
export const channelArgument = (channel: string) => ({
    type: "channel",
    value: { channel },
});

function serialize(value: unknown): object {
    // Element references and channels are already BiDi values.
    if (
        value &&
        typeof value === "object" &&
        ("sharedId" in value || ("type" in value && value.type === "channel"))
    ) {
        return value;
    }
    if (value === undefined) return { type: "undefined" };
    if (value === null) return { type: "null" };
    if (Array.isArray(value))
        return { type: "array", value: value.map(serialize) };
    if (typeof value === "object") {
        return {
            type: "object",
            value: Object.entries(value).map(([key, entry]) => [
                key,
                serialize(entry),
            ]),
        };
    }
    return { type: typeof value, value };
}

/** A page's value from BiDi's serialization, for the types the specs use. */
export function deserialize(value: RemoteValue): any {
    switch (value.type) {
        case "undefined":
            return undefined;
        case "null":
            return null;
        case "array":
            return value.value.map(deserialize);
        case "object":
            return Object.fromEntries(
                value.value.map(([key, entry]: [string, RemoteValue]) => [
                    key,
                    deserialize(entry),
                ]),
            );
        case "string":
        case "number":
        case "boolean":
            return value.value;
        default:
            return value;
    }
}
