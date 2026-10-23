import type { LockManagerLike } from "../../src/app_lib/agent/tab-leadership";
import {
    UNLOCKED_TAB_LOCK,
    type TabLockManager,
} from "../../src/app_lib/unlocked-tab";

/** Exclusive locks with a queue, abort signals and steal, like navigator.locks. */
export class FakeLocks implements LockManagerLike {
    private holder: { done: (error?: Error) => void } | null = null;
    private queue: (() => void)[] = [];

    request(
        _name: string,
        options: { signal?: AbortSignal; steal?: boolean },
        callback: (lock: unknown) => Promise<void>,
    ): Promise<unknown> {
        return new Promise((resolve, reject) => {
            const run = () => {
                let settled = false;
                const entry = {
                    done: (error?: Error) => {
                        if (settled) return;
                        settled = true;
                        if (this.holder === entry) {
                            this.holder = null;
                            this.queue.shift()?.();
                        }
                        if (error) reject(error);
                        else resolve(undefined);
                    },
                };
                this.holder = entry;
                // Browsers grant asynchronously.
                void Promise.resolve()
                    .then(() => callback({}))
                    .then(
                        () => entry.done(),
                        (error: Error) => entry.done(error),
                    );
            };
            if (options.steal) {
                const previous = this.holder;
                this.holder = null;
                previous?.done(new Error("AbortError: stolen"));
                run();
                return;
            }
            if (!this.holder) return run();
            const queued = () => run();
            this.queue.push(queued);
            options.signal?.addEventListener("abort", () => {
                const index = this.queue.indexOf(queued);
                if (index >= 0) this.queue.splice(index, 1);
                reject(new Error("AbortError: aborted"));
            });
        });
    }
}

/**
 * The one-tab lock with ifAvailable and query; grants arrive later. Set
 * `held` to play another tab that has the vault open.
 */
export class FakeTabLocks implements TabLockManager {
    held = false;

    request(
        _name: string,
        _options: { ifAvailable?: boolean },
        callback: (lock: unknown) => Promise<void>,
    ): Promise<unknown> {
        if (this.held) return Promise.resolve().then(() => callback(null));
        this.held = true;
        return Promise.resolve()
            .then(() => callback({}))
            .finally(() => {
                this.held = false;
            });
    }

    async query() {
        return { held: this.held ? [{ name: UNLOCKED_TAB_LOCK }] : [] };
    }
}
