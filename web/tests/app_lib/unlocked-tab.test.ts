/**
 * @jest-environment node
 *
 * One unlocked tab per browser: a second tab can't open the vault while
 * one has it open, and "Use here" asks that tab to lock first.
 */
import { describe, expect, it, jest } from "@jest/globals";
import {
    UNLOCKED_TAB_LOCK,
    UnlockedTabCoordinator,
    type TabChannel,
} from "../../src/app_lib/unlocked-tab";
import { FakeTabLocks } from "../helpers/fake-locks";

/** BroadcastChannel: a message reaches every other tab. */
function channels() {
    const all: TabChannel[] = [];
    const make = (): TabChannel => {
        const channel: TabChannel = {
            onmessage: null,
            postMessage: (data) => {
                for (const other of all)
                    if (other !== channel)
                        void Promise.resolve().then(() =>
                            other.onmessage?.({ data }),
                        );
            },
            close: () => undefined,
        };
        all.push(channel);
        return channel;
    };
    return make;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("one unlocked tab", () => {
    it("keeps a second tab out until the first locks through its own path", async () => {
        const locks = new FakeTabLocks();
        const channel = channels();
        const a = new UnlockedTabCoordinator(locks, channel());
        const b = new UnlockedTabCoordinator(locks, channel());

        await expect(a.claim()).resolves.toBe(true);
        await expect(b.otherTabOpen()).resolves.toBe(true);
        // B unlocked anyway (a race): it doesn't get the tab.
        await expect(b.claim()).resolves.toBe(false);
        await expect(locks.query()).resolves.toEqual({
            held: [{ name: UNLOCKED_TAB_LOCK }],
        });

        // "Use here" in B: A's lock path runs, then A lets go.
        const lockA = jest.fn(() => void a.releaseClaim());
        a.setReleaseHandler(lockA);
        const changed = jest.fn();
        b.subscribe(changed);
        b.requestRelease();
        await settle();
        await settle();
        expect(lockA).toHaveBeenCalledTimes(1);
        expect(changed).toHaveBeenCalled();
        await expect(b.otherTabOpen()).resolves.toBe(false);
        await expect(b.claim()).resolves.toBe(true);
        await expect(a.otherTabOpen()).resolves.toBe(true);
    });

    it("lets go of a grant that arrives after the claim was released", async () => {
        const locks = new FakeTabLocks();
        const a = new UnlockedTabCoordinator(locks, null);
        // The page unmounts before the browser grants the lock.
        const claiming = a.claim();
        await a.releaseClaim();
        await expect(claiming).resolves.toBe(false);
        await settle();
        expect(a.holds).toBe(false);
        await expect(locks.query()).resolves.toEqual({ held: [] });
        // A claim after that works as usual.
        await expect(a.claim()).resolves.toBe(true);
        expect(a.holds).toBe(true);
    });

    it("doesn't see itself as the other tab while it claims or holds the lock", async () => {
        const locks = new FakeTabLocks();
        const a = new UnlockedTabCoordinator(locks, null);
        // An unlock claims before it reads the vault; its own lock shows
        // as held meanwhile.
        const claiming = a.claim();
        await expect(a.otherTabOpen()).resolves.toBe(false);
        await expect(claiming).resolves.toBe(true);
        await expect(a.otherTabOpen()).resolves.toBe(false);
        await a.releaseClaim();
        const b = new UnlockedTabCoordinator(locks, null);
        await expect(b.claim()).resolves.toBe(true);
        await expect(a.otherTabOpen()).resolves.toBe(true);
        await b.releaseClaim();
    });

    it("ignores release requests in a tab that doesn't have the vault open", async () => {
        const locks = new FakeTabLocks();
        const channel = channels();
        const a = new UnlockedTabCoordinator(locks, channel());
        const b = new UnlockedTabCoordinator(locks, channel());
        const lockA = jest.fn();
        a.setReleaseHandler(lockA);
        b.requestRelease();
        await settle();
        expect(lockA).not.toHaveBeenCalled();
    });
});
