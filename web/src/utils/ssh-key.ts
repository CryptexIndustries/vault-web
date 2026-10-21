import type { SSHKeyData } from "@cryptex-industries/vault-core/proto";
import {
    describeSSHKey,
    SSH_KEY_TASK_INTERNAL_ERROR,
    type SSHKeyInfo,
} from "@cryptex-industries/vault-core/vault-utils/ssh-key-info";
import type {
    SSHKeyTask,
    SSHKeyTaskResult,
} from "@cryptex-industries/vault-core/vault-utils/ssh-key-task";

const infoCache = new WeakMap<SSHKeyData, SSHKeyInfo | null>();

/** Describes a stored key. Cached because lists and search call it per row. */
export function getSSHKeyInfo(data?: SSHKeyData | null): SSHKeyInfo | null {
    if (!data) return null;
    if (!infoCache.has(data)) infoCache.set(data, describeSSHKey(data));
    return infoCache.get(data) ?? null;
}

/**
 * Loads key generation, import and export on demand. The elliptic-curve code
 * is large, so lists and startup don't pay for it.
 */
export const loadSSHKeyModule = () =>
    import("@cryptex-industries/vault-core/vault-utils/ssh-key");

const internalError = (): SSHKeyTaskResult => ({
    ok: false,
    code: "internal",
    message: SSH_KEY_TASK_INTERNAL_ERROR,
});

const isTaskResult = (value: unknown): value is SSHKeyTaskResult =>
    typeof value === "object" &&
    value !== null &&
    typeof (value as { ok?: unknown }).ok === "boolean";

/**
 * Fallback where there are no workers (Jest). Waits for a paint first so the
 * busy state shows before the key work blocks the page.
 */
async function runSSHKeyTaskOnMainThread(
    task: SSHKeyTask,
    signal?: AbortSignal,
): Promise<SSHKeyTaskResult> {
    try {
        const { runSSHKeyTask } =
            await import("@cryptex-industries/vault-core/vault-utils/ssh-key-task");
        await new Promise<void>((resolve) => {
            if (typeof requestAnimationFrame !== "function") {
                setTimeout(resolve, 0);
                return;
            }
            requestAnimationFrame(() => setTimeout(resolve, 0));
        });
        if (signal?.aborted) return internalError();
        return runSSHKeyTask(task);
    } catch {
        return internalError();
    }
}

/**
 * Imports or exports a key in a Web Worker so bcrypt and RSA parsing don't
 * freeze the page. Each call gets its own worker. Never rejects: a worker
 * that fails to load or crashes resolves to the "internal" error. Aborting
 * terminates the worker and resolves to the same error, which callers that
 * aborted ignore.
 */
export async function runSSHKeyTaskInWorker(
    task: SSHKeyTask,
    { signal }: { signal?: AbortSignal } = {},
): Promise<SSHKeyTaskResult> {
    if (signal?.aborted) return internalError();
    if (typeof Worker === "undefined") {
        return runSSHKeyTaskOnMainThread(task, signal);
    }

    let worker: Worker;
    try {
        const { createSSHKeyWorker } = await import("./ssh-key-worker");
        worker = createSSHKeyWorker();
    } catch {
        return internalError();
    }

    return new Promise<SSHKeyTaskResult>((resolve) => {
        const finish = (result: SSHKeyTaskResult) => {
            signal?.removeEventListener("abort", abort);
            worker.terminate();
            resolve(result);
        };
        const abort = () => finish(internalError());

        if (signal?.aborted) {
            abort();
            return;
        }
        signal?.addEventListener("abort", abort, { once: true });
        worker.onmessage = (event: MessageEvent<unknown>) =>
            finish(isTaskResult(event.data) ? event.data : internalError());
        worker.onmessageerror = () => finish(internalError());
        worker.onerror = (event) => {
            event.preventDefault();
            finish(internalError());
        };
        worker.postMessage(task);
    });
}

export function downloadTextFile(fileName: string, contents: string): void {
    const blob = new Blob([contents], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);
}
