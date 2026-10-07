import { beforeEach, expect, it, jest } from "@jest/globals";

jest.mock("react-native-worklets", () => ({
    createWorkletRuntime: () => ({}),
    createSynchronizable: (initial: boolean) => {
        let value = initial;
        return {
            getBlocking: () => value,
            setBlocking: (next: boolean) => {
                value = next;
            },
        };
    },
    scheduleOnRuntime: jest.fn(),
    scheduleOnRN: jest.fn(),
}));

import { scheduleOnRN, scheduleOnRuntime } from "react-native-worklets";
import { startSecurityAnalysis } from "../src/utils/security-analysis-worker";

beforeEach(() => {
    jest.clearAllMocks();
});

it("does not start a scan cancelled while waiting for its worker", () => {
    const progress = jest.fn();
    const complete = jest.fn();
    const fail = jest.fn();
    const cancel = startSecurityAnalysis([], progress, complete, fail);
    cancel();
    jest.mocked(scheduleOnRuntime).mock.calls[0]![1]();
    expect(scheduleOnRN).not.toHaveBeenCalled();
});

it("ignores completed results and progress queued before leaving the screen", () => {
    const progress = jest.fn();
    const complete = jest.fn();
    const fail = jest.fn();
    const cancel = startSecurityAnalysis([], progress, complete, fail);
    jest.mocked(scheduleOnRuntime).mock.calls[0]![1]();
    expect(scheduleOnRN).toHaveBeenCalled();
    cancel();
    for (const [callback, ...args] of jest.mocked(scheduleOnRN).mock.calls)
        callback(...args);
    expect(progress).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
    expect(fail).not.toHaveBeenCalled();
});
