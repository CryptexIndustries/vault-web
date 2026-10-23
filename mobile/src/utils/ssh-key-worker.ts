import {
    createSynchronizable,
    createWorkletRuntime,
    scheduleOnRN,
    scheduleOnRuntime,
    type Synchronizable,
    type WorkletRuntime,
} from "react-native-worklets";
import { uint8ToBase64 } from "@cryptex-industries/vault-core/encoding";
import {
    SSH_EXPORT_RANDOM_BYTES,
    SSH_KEY_TASK_INTERNAL_ERROR,
} from "@cryptex-industries/vault-core/vault-utils/ssh-key-info";
import type {
    SSHKeyTask,
    SSHKeyTaskResult,
} from "@cryptex-industries/vault-core/vault-utils/ssh-key-task";
import workerSource from "../workers/ssh-key.generated.json";

export { SSH_KEY_TASK_INTERNAL_ERROR };

const secureRandom = (length: number) =>
    uint8ToBase64(crypto.getRandomValues(new Uint8Array(length)));

let runtime: WorkletRuntime | undefined;

function schedule(
    task: SSHKeyTask,
    cancelled: Synchronizable<boolean>,
    finish: (result: SSHKeyTaskResult) => void,
) {
    runtime ??= createWorkletRuntime({ name: "vault-ssh-key" });
    // Exports always get their random bytes from the app's secure source.
    const input: SSHKeyTask =
        task.kind === "export"
            ? { ...task, random: secureRandom(SSH_EXPORT_RANDOM_BYTES) }
            : task;
    scheduleOnRuntime(runtime, () => {
        "worklet";
        // Tasks run one after another. Skip one nobody waits for anymore.
        if (cancelled.getBlocking()) return;
        let result: SSHKeyTaskResult;
        try {
            const worker = globalThis as typeof globalThis & {
                runSSHKeyWorkerTask?: (task: SSHKeyTask) => SSHKeyTaskResult;
            };
            // Trusted, build-time bundled source. Loading it stays off RN.
            if (!worker.runSSHKeyWorkerTask) (0, eval)(workerSource);
            result = worker.runSSHKeyWorkerTask!(input);
        } catch {
            // Never forward exception text that could contain key data.
            result = {
                ok: false,
                code: "internal",
                message: SSH_KEY_TASK_INTERNAL_ERROR,
            };
        }
        if (!cancelled.getBlocking()) scheduleOnRN(finish, result);
    });
}

function start(
    task: SSHKeyTask,
    cancelled: Synchronizable<boolean>,
): Promise<SSHKeyTaskResult> {
    return new Promise((resolve) => {
        try {
            schedule(task, cancelled, resolve);
        } catch {
            resolve({
                ok: false,
                code: "internal",
                message: SSH_KEY_TASK_INTERNAL_ERROR,
            });
        }
    });
}

/**
 * Runs an SSH key import or export on a worker runtime, never the RN or UI
 * runtime, so key derivation and RSA parsing can't freeze the app. Never
 * rejects: a worker that can't start or load resolves to an "internal" error.
 */
export function runSSHKeyTaskOnWorker(
    task: SSHKeyTask,
): Promise<SSHKeyTaskResult> {
    return start(task, createSynchronizable(false));
}

/**
 * One SSH key job at a time for a form or dialog. Each run supersedes the
 * previous one: its result is dropped and its promise never settles, so code
 * after `await run(...)` only sees the current result. Call cancel() when the
 * input changes or the screen goes away.
 */
export function createSSHKeyTaskRunner() {
    let cancelCurrent: (() => void) | undefined;
    const cancel = () => {
        cancelCurrent?.();
        cancelCurrent = undefined;
    };
    const run = (task: SSHKeyTask): Promise<SSHKeyTaskResult> => {
        cancel();
        const flag = createSynchronizable(false);
        let live = true;
        cancelCurrent = () => {
            live = false;
            flag.setBlocking(true);
        };
        return new Promise((resolve) => {
            void start(task, flag).then((result) => {
                if (live) resolve(result);
            });
        });
    };
    return { run, cancel };
}
