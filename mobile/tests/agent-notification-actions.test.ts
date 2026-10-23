import { beforeEach, describe, expect, it, jest } from "@jest/globals";

type Action = { action: "review" | "deny"; requestId: string };

const mockTasks = new Map<string, () => () => Promise<void>>();
const mockListeners: Array<(event: Action) => void> = [];
const mockStored: Action[] = [];
const mockRuntimeListeners: Array<() => void> = [];
const mockPending = new Map<string, { id: string }>();
const mockDeny = jest.fn(async (id: string) => {
    mockPending.delete(id);
});
const mockRuntime = {
    running: true,
    reload: jest.fn(async () => undefined),
    whenStopped: jest.fn(async () => undefined),
    deny: mockDeny,
    pendingRequests: () => [...mockPending.values()],
    subscribe: (listener: () => void) => {
        mockRuntimeListeners.push(listener);
        return () => undefined;
    },
};

jest.mock("react-native", () => ({
    AppRegistry: {
        registerHeadlessTask: (name: string, task: () => () => Promise<void>) =>
            mockTasks.set(name, task),
    },
}));
jest.mock("@/agent/agent-app", () => ({ agentRuntime: mockRuntime }));
jest.mock("@/agent/agent-service", () => ({
    HEADLESS_TASK_NAME: "CryptexAgentRuntime",
    agentService: {
        takePendingActions: () => mockStored.splice(0),
        addActionListener: (listener: (event: Action) => void) => {
            mockListeners.push(listener);
            return { remove: () => undefined };
        },
    },
}));
jest.mock("@/utils/logging", () => ({ vaultLog: { warn: jest.fn() } }));

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("notification actions without a UI", () => {
    beforeEach(() => {
        mockPending.clear();
        mockDeny.mockClear();
    });

    it("the headless task takes stored Deny taps and listens for new ones", async () => {
        mockStored.push({ action: "deny", requestId: "stored" });
        mockPending.set("stored", { id: "stored" });
        mockPending.set("live", { id: "live" });
        require("../src/agent/headless");
        const task = mockTasks.get("CryptexAgentRuntime");
        expect(task).toBeDefined();
        await task!()();
        expect(mockDeny).toHaveBeenCalledWith("stored");

        expect(mockListeners).toHaveLength(1);
        mockListeners[0]!({ action: "deny", requestId: "live" });
        expect(mockDeny).toHaveBeenCalledWith("live");
    });

    it("refuses a request that arrives after its Deny was tapped", async () => {
        // Deny tapped before the request came back (it is resent after a reconnect).
        mockListeners[0]!({ action: "deny", requestId: "resent" });
        mockDeny.mockClear();
        mockPending.set("resent", { id: "resent" });
        for (const listener of mockRuntimeListeners) listener();
        await flush();
        expect(mockDeny).toHaveBeenCalledWith("resent");
    });

    it("keeps Review taps for the UI", async () => {
        const { notificationActions } =
            require("../src/agent/notification-actions") as typeof import("../src/agent/notification-actions");
        mockListeners[0]!({ action: "review", requestId: "r1" });
        const review = jest.fn();
        const stop = notificationActions.setReviewHandler(review);
        expect(review).toHaveBeenCalledWith("r1");
        mockListeners[0]!({ action: "review", requestId: "r2" });
        expect(review).toHaveBeenCalledWith("r2");
        stop();
        expect(mockDeny).not.toHaveBeenCalled();
    });
});

describe("denied request memory", () => {
    it("forgets denied IDs after 3 minutes", () => {
        const { DeniedRequests, DENIED_MEMORY_MS } =
            require("../src/agent/denied-requests") as typeof import("../src/agent/denied-requests");
        let now = 1_000_000;
        const denied = new DeniedRequests(() => now);
        denied.add("r1");
        now += DENIED_MEMORY_MS - 1;
        expect(denied.has("r1")).toBe(true);
        now += 2;
        expect(denied.has("r1")).toBe(false);
    });
});
