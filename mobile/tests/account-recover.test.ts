import { afterEach, beforeEach, expect, it, jest } from "@jest/globals";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { router } from "expo-router";

import AccountRecoverScreen from "../app/(app)/account/auth/recover";
import type { RecoveryOutcome } from "@/components/account/types";

jest.mock("react-native", () => ({ Alert: { alert: jest.fn() } }));
jest.mock("expo-router", () => ({
    router: { dismissTo: jest.fn(), replace: jest.fn() },
}));
jest.mock("expo-router/react-navigation", () => ({
    usePreventRemove: (enabled: boolean) => {
        mockLeaveGuard = enabled;
    },
}));
jest.mock("@/components/unlocked/unlocked-ui", () => ({
    UnlockedScreen: "Screen",
}));
jest.mock("@/components/account/account-auth", () => ({
    AccountAuth: "AccountAuth",
}));
jest.mock("@/components/account/recovery-status", () => ({
    RecoveryStatus: "RecoveryStatus",
}));
jest.mock("@/components/account/step-header", () => ({
    StepHeader: "StepHeader",
}));
jest.mock("@/components/account/account-controller", () => ({
    useAccountController: () => mockAccount,
}));

type Stage = "check" | "recovering" | "connecting";
let mockLeaveGuard = false;
const mockAccount = {
    recoverUserId: "user",
    setRecoverUserId: jest.fn(),
    recoverPhrase: "phrase",
    setRecoverPhrase: jest.fn(),
    setMessage: jest.fn(),
    checkRecoverForm: jest.fn(() => true),
    handleRecover:
        jest.fn<
            (onStage: (stage: Stage) => void) => Promise<RecoveryOutcome | null>
        >(),
    retryRecoverySave: jest.fn<() => Promise<RecoveryOutcome | null>>(),
    cancelHumanCheck: jest.fn(),
    humanCheck: createElement("HumanCheck"),
    registerPending: false,
    recoverPending: false,
    mutationBusy: false,
    message: null,
};
let renderer: ReactTestRenderer | undefined;

function status() {
    return renderer!.root.findByType("RecoveryStatus" as never).props;
}
async function confirmAndRecover() {
    await act(async () =>
        renderer!.root.findByType("AccountAuth" as never).props.onRecover(),
    );
    expect(status().state).toBe("confirm");
    await act(async () => status().onPrimary());
}

beforeEach(async () => {
    (
        globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    mockLeaveGuard = false;
    await act(async () => {
        renderer = create(createElement(AccountRecoverScreen));
    });
});
afterEach(async () => {
    await act(async () => renderer?.unmount());
    renderer = undefined;
    delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
        .IS_REACT_ACT_ENVIRONMENT;
});

it("shows the human check in the screen and offers a retry when it does not finish", async () => {
    let finish!: (outcome: RecoveryOutcome) => void;
    mockAccount.handleRecover.mockImplementationOnce(async (onStage) => {
        onStage("check");
        return new Promise((resolve) => {
            finish = resolve;
        });
    });
    await confirmAndRecover();
    expect(renderer!.root.findAllByType("HumanCheck" as never)).toHaveLength(1);
    expect(mockLeaveGuard).toBe(false);
    await act(async () => finish({ state: "checkIncomplete" }));
    expect(status().state).toBe("checkIncomplete");
    mockAccount.handleRecover.mockResolvedValueOnce({ state: "recovered" });
    await act(async () => status().onPrimary());
    expect(mockAccount.handleRecover).toHaveBeenCalledTimes(2);
    expect(status().state).toBe("recovered");
});

it("keeps the running attempt's human check when a double tap starts a second one", async () => {
    mockAccount.handleRecover
        .mockImplementationOnce(async (onStage) => {
            onStage("check");
            return new Promise(() => {});
        })
        .mockResolvedValueOnce(null);
    await act(async () =>
        renderer!.root.findByType("AccountAuth" as never).props.onRecover(),
    );
    const confirm = status().onPrimary;
    await act(async () => {
        confirm();
        confirm();
    });
    expect(mockAccount.handleRecover).toHaveBeenCalledTimes(2);
    expect(renderer!.root.findAllByType("HumanCheck" as never)).toHaveLength(1);
});

it("saves an accepted recovery again without going back to the Kit", async () => {
    mockAccount.handleRecover.mockResolvedValueOnce({ state: "saveFailed" });
    await confirmAndRecover();
    expect(status().state).toBe("saveFailed");
    expect(mockLeaveGuard).toBe(true);
    mockAccount.retryRecoverySave.mockResolvedValueOnce({ state: "recovered" });
    await act(async () => status().onPrimary());
    expect(mockAccount.retryRecoverySave).toHaveBeenCalledTimes(1);
    expect(mockAccount.handleRecover).toHaveBeenCalledTimes(1);
    expect(status().state).toBe("recovered");
});

it("blocks leaving only while the server is recovering", async () => {
    let finish!: (outcome: RecoveryOutcome) => void;
    mockAccount.handleRecover.mockImplementationOnce(async (onStage) => {
        onStage("recovering");
        return new Promise((resolve) => {
            finish = resolve;
        });
    });
    await confirmAndRecover();
    expect(status().state).toBe("recovering");
    expect(mockLeaveGuard).toBe(true);
    await act(async () => finish({ state: "rejected" }));
    expect(mockLeaveGuard).toBe(false);
    await act(async () => status().onPrimary());
    expect(renderer!.root.findAllByType("AccountAuth" as never)).toHaveLength(
        1,
    );
});

it("offers a new Kit when recovery used up the old one", async () => {
    mockAccount.handleRecover.mockResolvedValueOnce({ state: "kitMissing" });
    await confirmAndRecover();
    await act(async () => status().onPrimary());
    expect(router.replace).toHaveBeenCalledWith({
        pathname: "/(app)/account/recovery-kit",
        params: { auto: "1" },
    });
    await act(async () => status().onSecondary());
    expect(router.dismissTo).toHaveBeenCalledWith("/(app)/(tabs)/account");
});

it("ends an open human check and forgets the phrase when the screen closes", async () => {
    await act(async () => renderer!.unmount());
    renderer = undefined;
    expect(mockAccount.cancelHumanCheck).toHaveBeenCalledTimes(1);
    expect(mockAccount.setRecoverPhrase).toHaveBeenCalledWith("");
});
