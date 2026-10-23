import { beforeEach, expect, it, jest } from "@jest/globals";

jest.mock("react-native-worklets", () => ({
    createWorkletRuntime: jest.fn(() => ({})),
    createSynchronizable: (initial: boolean) => {
        let value = initial;
        return {
            getBlocking: () => value,
            setBlocking: (next: boolean) => {
                value = next;
            },
        };
    },
    scheduleOnRuntime: jest.fn(),
    scheduleOnRN: (run: (...args: unknown[]) => void, ...args: unknown[]) =>
        run(...args),
}));

import { createWorkletRuntime, scheduleOnRuntime } from "react-native-worklets";
import type { SSHKeyData } from "@cryptex-industries/vault-core/proto";
import type { SSHKeyTask } from "@cryptex-industries/vault-core/vault-utils/ssh-key-task";
import {
    createSSHKeyTaskRunner,
    runSSHKeyTaskOnWorker,
    SSH_KEY_TASK_INTERNAL_ERROR,
} from "../src/utils/ssh-key-worker";

type WorkerGlobal = typeof globalThis & {
    runSSHKeyWorkerTask?: (task: SSHKeyTask) => unknown;
};
const worker = globalThis as WorkerGlobal;
const internal = {
    ok: false,
    code: "internal",
    message: SSH_KEY_TASK_INTERNAL_ERROR,
};
const data: SSHKeyData = { PrivateKey: "", PublicKey: "", Comment: "" };
const scheduled = () =>
    jest.mocked(scheduleOnRuntime).mock.calls.map(([, work]) => work);
const flush = () => new Promise((done) => setTimeout(done, 0));

beforeEach(() => {
    jest.clearAllMocks();
    worker.runSSHKeyWorkerTask = jest.fn((task: SSHKeyTask) => ({
        ok: true,
        kind: task.kind,
        text: task.kind === "import" ? task.text : "exported",
    }));
});

it("sends every export fresh secure random bytes", async () => {
    const pending = runSSHKeyTaskOnWorker({ kind: "export", data });
    scheduled()[0]!();
    await expect(pending).resolves.toEqual(
        expect.objectContaining({ ok: true, text: "exported" }),
    );
    void runSSHKeyTaskOnWorker({ kind: "export", data });
    scheduled()[1]!();
    const calls = jest.mocked(worker.runSSHKeyWorkerTask!).mock.calls;
    const [first, second] = calls.map(([task]) => ({
        exportRandom: Buffer.from(
            (task as { random: string }).random,
            "base64",
        ),
    }));
    expect(first!.exportRandom).toHaveLength(20);
    expect(first!.exportRandom.equals(second!.exportRandom)).toBe(false);
    expect(createWorkletRuntime).toHaveBeenCalledWith({ name: "vault-ssh-key" });
});

it("resolves to an internal error when the worker program fails", async () => {
    worker.runSSHKeyWorkerTask = () => {
        throw new Error("secret key text");
    };
    const pending = runSSHKeyTaskOnWorker({ kind: "import", text: "key" });
    scheduled()[0]!();
    await expect(pending).resolves.toEqual(internal);
});

it("resolves to an internal error when the work can't be scheduled", async () => {
    jest.mocked(scheduleOnRuntime).mockImplementationOnce(() => {
        throw new Error("no runtime");
    });
    await expect(
        runSSHKeyTaskOnWorker({ kind: "import", text: "key" }),
    ).resolves.toEqual(internal);
});

it("drops superseded and cancelled results and skips work nobody waits for", async () => {
    const runner = createSSHKeyTaskRunner();
    const seen: string[] = [];
    void runner.run({ kind: "import", text: "first" }).then(() => seen.push("first"));
    void runner.run({ kind: "import", text: "second" }).then(() => seen.push("second"));
    const [first, second] = scheduled();
    first!();
    second!();
    await flush();
    expect(seen).toEqual(["second"]);
    // The superseded task was still queued, so it never ran.
    expect(
        jest.mocked(worker.runSSHKeyWorkerTask!).mock.calls.map(([task]) =>
            task.kind === "import" ? task.text : "",
        ),
    ).toEqual(["second"]);

    void runner.run({ kind: "import", text: "third" }).then(() => seen.push("third"));
    runner.cancel();
    scheduled()[2]!();
    await flush();
    expect(seen).toEqual(["second"]);
});

it("drops a result that finished after the run was cancelled", async () => {
    const runner = createSSHKeyTaskRunner();
    const seen = jest.fn();
    worker.runSSHKeyWorkerTask = jest.fn(() => {
        // The user leaves while the key is being derived.
        runner.cancel();
        return { ok: true, kind: "import", data };
    });
    void runner.run({ kind: "import", text: "key" }).then(seen);
    scheduled()[0]!();
    await flush();
    expect(seen).not.toHaveBeenCalled();
});
