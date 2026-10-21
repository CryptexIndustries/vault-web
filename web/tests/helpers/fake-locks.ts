import {
    UNLOCKED_TAB_LOCK,
    type TabLockManager,
} from "../../src/app_lib/unlocked-tab";

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
