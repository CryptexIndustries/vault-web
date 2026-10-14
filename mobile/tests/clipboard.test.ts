import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    jest,
} from "@jest/globals";

import {
    SECRET_CLEAR_MS,
    clearPendingSecretFromClipboard,
    copySecretToClipboard,
    copyTextToClipboard,
    getPendingClipboardSecretForTests,
    resetClipboardStateForTests,
} from "@/utils/clipboard";
import {
    __getClipboardForTests,
    __resetClipboardForTests,
    __setClipboardForTests,
} from "./mocks/expo-clipboard";
import { androidCredentials } from "@/utils/android-credentials";
import {
    noteVaultBackgrounded,
    setVaultTimeoutMinutes,
    startVaultTimeoutSession,
    stopVaultTimeoutSession,
} from "@/utils/session-timeout";

jest.mock("@/utils/android-credentials", () => ({
    androidCredentials: {
        available: false,
        setSensitiveClipboardString: jest.fn(),
        clearSensitiveClipboardIfOwned: jest.fn(),
    },
}));

describe("clipboard secret clear", () => {
    beforeEach(() => {
        stopVaultTimeoutSession();
        androidCredentials.available = false;
        jest.useFakeTimers();
        resetClipboardStateForTests();
        __resetClipboardForTests();
    });

    afterEach(() => {
        stopVaultTimeoutSession();
        resetClipboardStateForTests();
        __resetClipboardForTests();
        jest.useRealTimers();
    });

    it("copies a secret and clears after 30s when unchanged", async () => {
        await expect(copySecretToClipboard("s3cret")).resolves.toBe(true);
        expect(__getClipboardForTests()).toBe("s3cret");
        expect(getPendingClipboardSecretForTests()).toBe("s3cret");

        await jest.advanceTimersByTimeAsync(SECRET_CLEAR_MS - 1);
        expect(__getClipboardForTests()).toBe("s3cret");

        await jest.advanceTimersByTimeAsync(1);
        expect(__getClipboardForTests()).toBe("");
        expect(getPendingClipboardSecretForTests()).toBeNull();
    });

    it("does not clear when clipboard changed before timeout", async () => {
        await copySecretToClipboard("s3cret");
        __setClipboardForTests("user-replaced");

        await jest.advanceTimersByTimeAsync(SECRET_CLEAR_MS);
        expect(__getClipboardForTests()).toBe("user-replaced");
    });

    it("clears immediately on lock-style clearPending", async () => {
        await copySecretToClipboard("s3cret");
        await clearPendingSecretFromClipboard();
        expect(__getClipboardForTests()).toBe("");
        expect(getPendingClipboardSecretForTests()).toBeNull();
    });

    it("does not schedule clear for non-secret copy", async () => {
        await expect(copyTextToClipboard("public-id")).resolves.toBe(true);
        expect(getPendingClipboardSecretForTests()).toBeNull();
        await jest.advanceTimersByTimeAsync(SECRET_CLEAR_MS);
        expect(__getClipboardForTests()).toBe("public-id");
    });

    it("marks Android secrets as sensitive and retains the expiry", async () => {
        androidCredentials.available = true;
        const setSensitive =
            androidCredentials.setSensitiveClipboardString as jest.Mock;
        setSensitive.mockImplementation(async (value) => {
            __setClipboardForTests(value as string);
        });
        await expect(copySecretToClipboard("s3cret")).resolves.toBe(true);
        expect(setSensitive).toHaveBeenCalledWith("s3cret");
        await jest.advanceTimersByTimeAsync(SECRET_CLEAR_MS);
        expect(__getClipboardForTests()).toBe("");
    });

    it("does not fall back to an unprotected copy on native failure", async () => {
        androidCredentials.available = true;
        const setSensitive =
            androidCredentials.setSensitiveClipboardString as jest.Mock<
                () => Promise<void>
            >;
        setSensitive.mockRejectedValueOnce(new Error("clipboard unavailable"));
        await expect(copySecretToClipboard("s3cret")).resolves.toBe(false);
        expect(__getClipboardForTests()).toBe("");
        expect(getPendingClipboardSecretForTests()).toBeNull();
    });

    it("refuses a secret copy after the vault timeout, but permits locked-screen generation", async () => {
        jest.setSystemTime(1_000_000);
        startVaultTimeoutSession();
        setVaultTimeoutMinutes(1);
        noteVaultBackgrounded();
        jest.setSystemTime(1_060_000);
        await expect(copySecretToClipboard("expired")).resolves.toBe(false);
        expect(__getClipboardForTests()).toBe("");

        stopVaultTimeoutSession();
        await expect(copySecretToClipboard("new generator result")).resolves.toBe(true);
    });

    it("clears a native write that finishes after the deadline", async () => {
        jest.setSystemTime(1_000_000);
        startVaultTimeoutSession();
        setVaultTimeoutMinutes(1);
        noteVaultBackgrounded();
        androidCredentials.available = true;
        let finishWrite!: () => void;
        jest.mocked(androidCredentials.setSensitiveClipboardString).mockImplementationOnce(
            async (value) => {
                await new Promise<void>((resolve) => { finishWrite = resolve; });
                __setClipboardForTests(value);
            },
        );
        const copy = copySecretToClipboard("late secret");
        jest.setSystemTime(1_060_000);
        finishWrite();
        await expect(copy).resolves.toBe(false);
        expect(androidCredentials.clearSensitiveClipboardIfOwned).toHaveBeenCalled();
        expect(__getClipboardForTests()).toBe("");
        expect(getPendingClipboardSecretForTests()).toBeNull();
    });
});
