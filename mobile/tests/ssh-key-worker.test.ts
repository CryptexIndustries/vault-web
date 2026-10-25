import { expect, it } from "@jest/globals";
import { Worker } from "node:worker_threads";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
    runSSHKeyTask,
    SSH_KEY_TASK_INTERNAL_ERROR,
    type SSHKeyTask,
    type SSHKeyTaskResult,
} from "@cryptex-industries/vault-core/vault-utils/ssh-key-task";
import { SSH_EXPORT_RANDOM_BYTES } from "@cryptex-industries/vault-core/vault-utils/ssh-key";

const source = JSON.parse(
    readFileSync(
        resolve(__dirname, "../src/workers/ssh-key.generated.json"),
        "utf8",
    ),
);
const fixtures = resolve(
    __dirname,
    "../../packages/vault-core/src/tests/fixtures/ssh",
);
const fixture = (name: string) => readFileSync(resolve(fixtures, name), "utf8");
const random = (length: number) => randomBytes(length).toString("base64");

/**
 * Runs tasks through the bundled program in a separate thread, in a context
 * without crypto, TextEncoder, atob or Buffer, like a fresh worklet runtime.
 */
async function runInIsolatedWorker(tasks: SSHKeyTask[]) {
    const worker = new Worker(
        `
        const { parentPort, workerData, threadId } = require('node:worker_threads');
        const vm = require('node:vm');
        const context = vm.createContext({});
        vm.runInContext(workerData.source, context);
        const results = workerData.tasks.map((task) =>
            JSON.parse(JSON.stringify(context.runSSHKeyWorkerTask(task))));
        parentPort.postMessage({ results, threadId });
    `,
        { eval: true, workerData: { source, tasks } },
    );
    try {
        return await new Promise<{
            results: SSHKeyTaskResult[];
            threadId: number;
        }>((resolve, reject) => {
            worker.once("message", resolve);
            worker.once("error", reject);
            worker.once("exit", (code) => {
                if (code) reject(new Error(`Worker exit ${code}`));
            });
        });
    } finally {
        await worker.terminate();
    }
}

it("imports, exports and reports errors like the shared task in an isolated background thread", async () => {
    const encrypted = fixture("ed25519-aes256-ctr.key");
    const exportRandom = random(SSH_EXPORT_RANDOM_BYTES);
    const unlocked = runSSHKeyTask({
        kind: "import",
        text: encrypted,
        passphrase: "correct horse",
    });
    if (!unlocked.ok || unlocked.kind !== "import") throw new Error("fixture");
    const tasks: SSHKeyTask[] = [
        { kind: "import", text: encrypted, passphrase: "correct horse" },
        {
            kind: "import",
            text: fixture("rsa-pkcs8.key"),
            publicKey: fixture("rsa-pkcs8.key.pub"),
        },
        { kind: "import", text: encrypted },
        { kind: "import", text: encrypted, passphrase: "wrong horse" },
        { kind: "import", text: fixture("ed25519.key.pub") },
        {
            kind: "export",
            data: unlocked.data,
            passphrase: "new passphrase",
            random: exportRandom,
        },
        { kind: "export", data: unlocked.data, random: exportRandom },
    ];
    const { results, threadId } = await runInIsolatedWorker(tasks);
    expect(threadId).toBeGreaterThan(0);
    expect(results).toEqual(tasks.map(runSSHKeyTask));
    expect(
        results.map((result) => (result.ok ? result.kind : result.code)),
    ).toEqual([
        "import",
        "import",
        "passphrase-required",
        "wrong-passphrase",
        "public-key-only",
        "export",
        "export",
    ]);

    // The encrypted export opens again with its new passphrase.
    const exported = results[5]!;
    if (!exported.ok || exported.kind !== "export") throw new Error("export");
    const [reopened] = (
        await runInIsolatedWorker([
            {
                kind: "import",
                text: exported.text,
                passphrase: "new passphrase",
            },
        ])
    ).results;
    expect(reopened).toEqual({ ok: true, kind: "import", data: unlocked.data });
}, 30000);

it("refuses an encrypted export that brings no random bytes", async () => {
    const unlocked = runSSHKeyTask({
        kind: "import",
        text: fixture("ed25519.key"),
    });
    if (!unlocked.ok || unlocked.kind !== "import") throw new Error("fixture");
    const { results } = await runInIsolatedWorker([
        { kind: "export", data: unlocked.data, passphrase: "new passphrase" },
    ]);
    expect(results).toEqual([
        {
            ok: false,
            code: "internal",
            message: SSH_KEY_TASK_INTERNAL_ERROR,
        },
    ]);
}, 30000);
