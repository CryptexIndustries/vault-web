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

import {
    VAULT_BACKGROUND_AUTO_LOCK_GRACE_MS,
    VAULT_IDLE_AUTO_LOCK_MS,
    startVaultAutoLock,
    type VaultAutoLockController,
} from "../../src/utils/vault-auto-lock";

function setVisibilityState(state: DocumentVisibilityState) {
    Object.defineProperty(document, "visibilityState", {
        value: state,
        configurable: true,
    });
}

describe("startVaultAutoLock", () => {
    let controller: VaultAutoLockController | null = null;
    let now: Date;

    beforeEach(() => {
        now = new Date("2026-06-13T12:00:00.000Z");
        jest.useFakeTimers({ now });
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

    it("locks after the background grace period", async () => {
        const lock = jest.fn(async () => undefined);
        controller = startVaultAutoLock({ lock });

        setVisibilityState("hidden");
        document.dispatchEvent(new Event("visibilitychange"));
        await jest.advanceTimersByTimeAsync(
            VAULT_BACKGROUND_AUTO_LOCK_GRACE_MS - 1,
        );
        expect(lock).not.toHaveBeenCalled();

        await jest.advanceTimersByTimeAsync(1);
        expect(lock).toHaveBeenCalledTimes(1);
        expect(lock).toHaveBeenCalledWith("background");
    });

    it("cancels background lock when the page becomes visible before grace expires", async () => {
        const lock = jest.fn(async () => undefined);
        controller = startVaultAutoLock({ lock });

        setVisibilityState("hidden");
        document.dispatchEvent(new Event("visibilitychange"));
        await jest.advanceTimersByTimeAsync(
            VAULT_BACKGROUND_AUTO_LOCK_GRACE_MS - 1000,
        );

        setVisibilityState("visible");
        document.dispatchEvent(new Event("visibilitychange"));
        await jest.advanceTimersByTimeAsync(1000);
        expect(lock).not.toHaveBeenCalled();

        await jest.advanceTimersByTimeAsync(VAULT_IDLE_AUTO_LOCK_MS);
        expect(lock).toHaveBeenCalledTimes(1);
        expect(lock).toHaveBeenCalledWith("idle");
    });

    it("locks immediately on return if hidden longer than the grace period", async () => {
        const lock = jest.fn(async () => undefined);
        controller = startVaultAutoLock({ lock });

        setVisibilityState("hidden");
        document.dispatchEvent(new Event("visibilitychange"));
        jest.setSystemTime(
            new Date(now.getTime() + VAULT_BACKGROUND_AUTO_LOCK_GRACE_MS + 1),
        );

        setVisibilityState("visible");
        document.dispatchEvent(new Event("visibilitychange"));

        expect(lock).toHaveBeenCalledTimes(1);
        expect(lock).toHaveBeenCalledWith("background");
    });

    it("uses pagehide as a background lock trigger", async () => {
        const lock = jest.fn(async () => undefined);
        controller = startVaultAutoLock({ lock });

        window.dispatchEvent(new PageTransitionEvent("pagehide"));
        await jest.advanceTimersByTimeAsync(
            VAULT_BACKGROUND_AUTO_LOCK_GRACE_MS,
        );

        expect(lock).toHaveBeenCalledTimes(1);
        expect(lock).toHaveBeenCalledWith("pagehide");
    });
});
