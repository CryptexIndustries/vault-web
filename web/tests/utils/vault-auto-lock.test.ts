/**
 * @jest-environment jsdom
 */
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    jest,
} from "@jest/globals";
import { createStore } from "jotai";

import {
    VAULT_IDLE_AUTO_LOCK_MS,
    startVaultAutoLock,
    type VaultAutoLockController,
    vaultAutoLockTimeoutAtom,
} from "../../src/utils/vault-auto-lock";

function setVisibilityState(state: DocumentVisibilityState) {
    Object.defineProperty(document, "visibilityState", {
        value: state,
        configurable: true,
    });
}

describe("startVaultAutoLock", () => {
    let controller: VaultAutoLockController | null = null;

    beforeEach(() => {
        jest.useFakeTimers({ now: new Date("2026-06-13T12:00:00.000Z") });
        setVisibilityState("visible");
    });

    afterEach(() => {
        controller?.stop();
        controller = null;
        jest.useRealTimers();
        setVisibilityState("visible");
    });

    it("locks after the idle timeout", async () => {
        const lock = jest.fn(async () => undefined);
        controller = startVaultAutoLock({ lock });

        await jest.advanceTimersByTimeAsync(VAULT_IDLE_AUTO_LOCK_MS - 1);
        expect(lock).not.toHaveBeenCalled();

        await jest.advanceTimersByTimeAsync(1);
        expect(lock).toHaveBeenCalledTimes(1);
        expect(lock).toHaveBeenCalledWith("idle");
    });

    it("resets the idle timeout after user activity", async () => {
        const lock = jest.fn(async () => undefined);
        controller = startVaultAutoLock({ lock });

        await jest.advanceTimersByTimeAsync(VAULT_IDLE_AUTO_LOCK_MS - 1000);
        window.dispatchEvent(new KeyboardEvent("keydown"));
        await jest.advanceTimersByTimeAsync(999);
        expect(lock).not.toHaveBeenCalled();

        await jest.advanceTimersByTimeAsync(VAULT_IDLE_AUTO_LOCK_MS - 999);
        expect(lock).toHaveBeenCalledTimes(1);
        expect(lock).toHaveBeenCalledWith("idle");
    });

    it("continues the idle timeout while the tab is hidden", async () => {
        const lock = jest.fn(async () => undefined);
        controller = startVaultAutoLock({ lock });

        await jest.advanceTimersByTimeAsync(VAULT_IDLE_AUTO_LOCK_MS - 1000);
        setVisibilityState("hidden");
        await jest.advanceTimersByTimeAsync(999);
        expect(lock).not.toHaveBeenCalled();

        await jest.advanceTimersByTimeAsync(1);
        expect(lock).toHaveBeenCalledTimes(1);
        expect(lock).toHaveBeenCalledWith("idle");
    });

    it("does not reset the idle timeout when the tab becomes visible again", async () => {
        const lock = jest.fn(async () => undefined);
        controller = startVaultAutoLock({ lock });

        await jest.advanceTimersByTimeAsync(VAULT_IDLE_AUTO_LOCK_MS - 5000);
        setVisibilityState("hidden");
        await jest.advanceTimersByTimeAsync(2000);
        setVisibilityState("visible");
        await jest.advanceTimersByTimeAsync(2999);
        expect(lock).not.toHaveBeenCalled();

        await jest.advanceTimersByTimeAsync(1);
        expect(lock).toHaveBeenCalledTimes(1);
        expect(lock).toHaveBeenCalledWith("idle");
    });
});

describe("vaultAutoLockTimeoutAtom", () => {
    beforeEach(() => localStorage.clear());

    it("falls back to 15 minutes for a tampered stored value", () => {
        localStorage.setItem("cryptex-vault-auto-lock-timeout-ms", "999999999");
        const store = createStore();
        const unsubscribe = store.sub(vaultAutoLockTimeoutAtom, () => {});

        expect(store.get(vaultAutoLockTimeoutAtom)).toBe(
            VAULT_IDLE_AUTO_LOCK_MS,
        );
        unsubscribe();
    });

    it("persists supported values", () => {
        const store = createStore();

        store.set(vaultAutoLockTimeoutAtom, 30 * 60 * 1000);

        expect(localStorage.getItem("cryptex-vault-auto-lock-timeout-ms")).toBe(
            String(30 * 60 * 1000),
        );
    });
});
