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
