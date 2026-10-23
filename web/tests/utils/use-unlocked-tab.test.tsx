/**
 * @jest-environment jsdom
 *
 * The one-tab claim lasts as long as the decrypted vault: leaving /app
 * inside the app (Next client-side navigation keeps the vault in memory)
 * locks what the live store holds before another tab may open it, whatever
 * the page rendered last.
 */
import "../helpers/jsdom-encoding";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { UnlockedTabCoordinator } from "@/app_lib/unlocked-tab";
import { FakeTabLocks } from "../helpers/fake-locks";
import {
    useUnlockedTab,
    type UnlockedTabState,
} from "@/utils/use-unlocked-tab";
import { vaultTabOwner } from "@/utils/vault-tab-owner";
import { unlockedVaultMetadataAtom, vaultStore } from "@/utils/atoms";
import {
    clearVaultDEKFromSession,
    setVaultDEKInSession,
} from "@/utils/vault-session";

const mockTabs: { current: UnlockedTabCoordinator | null } = { current: null };
jest.mock("@/app_lib/unlocked-tab", () => {
    const actual = jest.requireActual<typeof import("@/app_lib/unlocked-tab")>(
        "@/app_lib/unlocked-tab",
    );
    return { ...actual, unlockedTab: () => mockTabs.current };
});

(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const settle = () =>
    act(async () => {
        for (let i = 0; i < 5; i++)
            await new Promise((resolve) => setTimeout(resolve, 0));
    });

let root: Root | null = null;
let container: HTMLDivElement | null = null;
afterEach(async () => {
    act(() => root?.unmount());
    await settle();
    container?.remove();
    root = null;
    container = null;
    vaultStore.set(unlockedVaultMetadataAtom, null);
    clearVaultDEKFromSession();
    await mockTabs.current?.releaseClaim();
});

/** What the unlock publishes: the session the leave acts on. */
function openSession() {
    vaultStore.set(unlockedVaultMetadataAtom, {} as never);
    setVaultDEKInSession({ type: "secret" } as CryptoKey);
}

function closeSession() {
    clearVaultDEKFromSession();
    vaultStore.set(unlockedVaultMetadataAtom, null);
}

function setup() {
    const locks = new FakeTabLocks();
    const tabs = new UnlockedTabCoordinator(locks, null);
    mockTabs.current = tabs;
    let state: UnlockedTabState | null = null;
    let finishLock: (locked: boolean) => void = () => undefined;
    const lock = jest.fn(
        () =>
            new Promise<boolean>((resolve) => {
                finishLock = (locked) => {
                    if (locked) closeSession();
                    resolve(locked);
                };
            }),
    );
    const discard = jest.fn(async () => closeSession());
    function Page({ unlocked }: { unlocked: boolean }) {
        state = useUnlockedTab(unlocked, discard, lock);
        return null;
    }
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    return {
        locks,
        tabs,
        lock,
        discard,
        finishLock: (locked: boolean) => finishLock(locked),
        state: () => state!,
        Page,
        render: (node: React.ReactNode) => act(async () => root!.render(node)),
        /** An unlock on the page: claim, then publish. */
        unlock: async () => {
            const opening = await vaultTabOwner().begin();
            expect(opening).not.toBeNull();
            openSession();
            opening!.end();
        },
    };
}

describe("useUnlockedTab", () => {
    it("locks a vault left unlocked when the page goes away, then lets go of the tab", async () => {
        const t = setup();
        await t.render(<t.Page unlocked={false} />);
        await t.unlock();
        // Navigation away before the page rendered the unlocked state.
        await t.render(null);
        await settle();
        expect(t.lock).toHaveBeenCalledTimes(1);
        // The save is still running: no other tab may open the vault yet.
        expect(t.tabs.holds).toBe(true);
        expect(t.locks.held).toBe(true);
        t.finishLock(true);
        await settle();
        expect(t.tabs.holds).toBe(false);
        expect(t.locks.held).toBe(false);
        expect(t.discard).not.toHaveBeenCalled();
    });

    it("lets go of the tab after a lock on the page", async () => {
        const t = setup();
        await t.render(<t.Page unlocked />);
        await t.unlock();
        closeSession();
        await t.render(<t.Page unlocked={false} />);
        await settle();
        expect(t.lock).not.toHaveBeenCalled();
        expect(t.tabs.holds).toBe(false);
    });

    it("lets go once the session closes, even while the leave's lock is still out", async () => {
        const t = setup();
        await t.render(<t.Page unlocked />);
        await t.unlock();
        await t.render(null);
        // Let the leave run: its lock call is the one the Lock button
        // already started (shared in vault-lock.ts), still saving.
        await settle();
        expect(t.lock).toHaveBeenCalledTimes(1);
        expect(t.tabs.holds).toBe(true);
        // That lock finishes and closes the session: the claim goes now,
        // not only when the leave hears back.
        closeSession();
        await settle();
        expect(t.tabs.holds).toBe(false);
        t.finishLock(true);
        await settle();
        expect(t.tabs.holds).toBe(false);
    });

    it("discards, unsaved, a vault this tab never claimed when the page goes away", async () => {
        const t = setup();
        t.locks.held = true; // another tab has the vault open
        await t.render(<t.Page unlocked />);
        openSession();
        await t.render(null);
        await settle();
        expect(t.discard).toHaveBeenCalledTimes(1);
        expect(t.lock).not.toHaveBeenCalled();
    });

    it("keeps the claim for an opening's storage step after the page went away", async () => {
        const t = setup();
        await t.render(<t.Page unlocked={false} />);
        const opening = (await vaultTabOwner().begin())!;
        let finishStep: () => void = () => undefined;
        const step = opening.run(
            () =>
                new Promise<void>((resolve) => {
                    finishStep = resolve;
                }),
        );
        await t.render(null);
        await settle();
        expect(opening.active).toBe(false);
        expect(t.tabs.holds).toBe(true);
        finishStep();
        await step;
        await settle();
        expect(t.tabs.holds).toBe(false);
        opening.end();
        expect(t.lock).not.toHaveBeenCalled();
        expect(t.discard).not.toHaveBeenCalled();
    });

    it("shows the other tab when an unlock couldn't claim", async () => {
        const t = setup();
        await t.render(<t.Page unlocked={false} />);
        await settle();
        expect(t.state().elsewhere).toBe(false);
        t.locks.held = true;
        await expect(vaultTabOwner().begin()).resolves.toBeNull();
        await act(async () => t.state().showElsewhere());
        await settle();
        expect(t.state().elsewhere).toBe(true);
        t.locks.held = false;
    });
});
