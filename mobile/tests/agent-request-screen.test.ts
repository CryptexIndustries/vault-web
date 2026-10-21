import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    jest,
} from "@jest/globals";
import { createElement, type ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { sshLoginRequest as request } from "./agent-request-fixture";

const mockParams: { id?: string; token?: string } = {};
const mockPending = new Map<string, unknown>();
const mockApprove = jest.fn(async (_id: string, _choice: string) => undefined);
const mockProtect = jest.fn();
const mockChangeAgent = jest.fn(async (_id: string, _changes: unknown) => true);
const mockSetPaused = jest.fn(async (_id: string, _paused: boolean) => {
    mockPending.clear();
});
let mockVault: { ConnectedAgents: unknown[] } = { ConnectedAgents: [] };

jest.mock("react-native", () => ({
    View: "View",
    ActivityIndicator: "ActivityIndicator",
}));
jest.mock("expo-router", () => ({
    router: {
        replace: jest.fn(),
        back: jest.fn(),
        canGoBack: () => true,
        setParams: jest.fn(),
    },
    useLocalSearchParams: () => mockParams,
}));
jest.mock("lucide-react-native", () => ({ ShieldCheck: "ShieldCheck" }));
jest.mock("@/components/inline-notice", () => ({
    InlineNotice: "InlineNotice",
}));
jest.mock("@/components/unlocked/unlocked-ui", () => {
    const { createElement: h } =
        jest.requireActual<typeof import("react")>("react");
    return {
        UnlockedButton: "Button",
        UnlockedText: "Text",
        UnlockedTaskScreen: ({
            children,
            footer,
        }: {
            children: ReactNode;
            footer?: ReactNode;
        }) => h("Screen", null, children, footer),
    };
});
jest.mock("@/components/unlocked/unlocked-snackbar", () => ({
    useUnlockedSnackbar: () => jest.fn(),
}));
jest.mock("@/components/agents/agent-rows", () => ({
    AgentSectionLabel: "SectionLabel",
    InfoCard: "InfoCard",
    RadioRow: "RadioRow",
}));
jest.mock("jotai", () => ({ useAtomValue: () => mockVault }));
jest.mock("@/utils/atoms", () => ({ unlockedVaultAtom: {} }));
jest.mock("@/agent/agent-vault", () => ({ changeAgent: mockChangeAgent }));
jest.mock("@/agent/agent-app", () => ({
    agentRuntime: {
        getRequest: (id: string) => mockPending.get(id),
        pendingRequests: () => [...mockPending.values()],
        waitingCount: () => mockPending.size,
        setPaused: mockSetPaused,
        pauseToken: () => 1,
        pauseSaved: jest.fn(),
        nextRequest: () => [...mockPending.values()][0],
        setShownRequest: jest.fn(),
        keyFor: () => ({ credentialId: "cred", name: "Work key", sshKey: {} }),
        agentName: () => "laptop",
        approve: mockApprove,
        deny: jest.fn(async () => undefined),
    },
}));
jest.mock("@/agent/agent-runtime-bridge", () => ({
    useAgentRuntimeVersion: () => 0,
}));
jest.mock("@/agent/agent-service", () => ({
    agentService: { setApprovalScreenProtected: mockProtect },
}));
jest.mock("@/utils/ssh-keys", () => ({
    sshKeyInfo: () => ({ label: "Ed25519" }),
}));

const { router } = require("expo-router") as { router: { replace: jest.Mock } };
const { default: AgentRequestScreen } =
    require("../app/(app)/agent-request") as typeof import("../app/(app)/agent-request");
const { APPROVE_DELAY_MS, issueApprovalToken, redirectExternalPath } =
    require("@/agent/approval-screen") as typeof import("@/agent/approval-screen");

let renderer: ReactTestRenderer;

const byTestId = (id: string) =>
    renderer.root.findAll((node) => node.props.testID === id);
const approveButton = () => byTestId("agent-approve")[0]!;

function render() {
    act(() => {
        renderer = create(createElement(AgentRequestScreen));
    });
}

describe("SSH approval screen", () => {
    beforeEach(() => {
        (
            globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
        ).IS_REACT_ACT_ENVIRONMENT = true;
        jest.useFakeTimers();
        mockPending.clear();
        mockPending.set("r1", request("r1", 1));
        mockParams.id = "r1";
        mockParams.token = issueApprovalToken();
    });

    afterEach(() => {
        act(() => renderer?.unmount());
        jest.useRealTimers();
        delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
            .IS_REACT_ACT_ENVIRONMENT;
    });

    it("keeps Approve off for a moment after each request appears", async () => {
        render();
        expect(approveButton().props.disabled).toBe(true);
        await act(async () => {
            approveButton().props.onPress();
        });
        expect(mockApprove).not.toHaveBeenCalled();

        act(() => jest.advanceTimersByTime(APPROVE_DELAY_MS));
        expect(approveButton().props.disabled).toBe(false);

        // The next request in the same layout starts disabled again.
        mockPending.set("r2", request("r2", 2));
        mockParams.id = "r2";
        act(() => renderer.update(createElement(AgentRequestScreen)));
        expect(approveButton().props.disabled).toBe(true);
        act(() => jest.advanceTimersByTime(APPROVE_DELAY_MS));
        await act(async () => {
            approveButton().props.onPress();
        });
        expect(mockApprove).toHaveBeenCalledWith("r2", "once");
    });

    it("says which of the waiting requests it shows", () => {
        mockPending.set("r2", request("r2", 2));
        render();
        expect(byTestId("agent-request-position")[0]!.props.children).toBe("1 of 2");
    });

    it("protects the screen from overlays while it shows", () => {
        render();
        expect(mockProtect).toHaveBeenLastCalledWith(true);
        act(() => renderer.unmount());
        expect(mockProtect).toHaveBeenLastCalledWith(false);
    });

    it("refuses to open without a token from the app", () => {
        mockParams.token = "guessed";
        render();
        expect(byTestId("agent-approve")).toHaveLength(0);
        expect(router.replace).toHaveBeenCalledWith("/(app)/(tabs)/vault");
    });
    it("warns when a known host key comes with a new name, and badges only the key", () => {
        mockVault = {
            ConnectedAgents: [
                {
                    ID: "agent",
                    Deleted: false,
                    KnownHosts: [
                        {
                            Fingerprint: "SHA256:abc",
                            Name: "prod-db",
                            FirstSeenTimestamp: 1,
                        },
                    ],
                },
            ],
        };
        mockPending.set("r1", request("r1", 1, ["github.com"]));
        try {
            render();
            const warnings = byTestId("agent-host-warning").map(
                (node) => node.props.message,
            );
            expect(warnings).toEqual([
                "This machine now calls this server github.com. Before, it was prod-db. Approve only if you expected this change.",
            ]);
            const cards = renderer.root.findAllByType("InfoCard" as never);
            const server = cards.find((card) => card.props.label === "Server")!;
            const hostKey = cards.find(
                (card) => card.props.label === "Host key",
            )!;
            expect(server.props.value).toBe("github.com");
            expect(server.props.badge).toBeUndefined();
            expect(server.props.note).toBe(
                "Name reported by the machine, not verified",
            );
            expect(hostKey.props.badge).toBeDefined();
        } finally {
            mockVault = { ConnectedAgents: [] };
        }
    });

    it("says when text from the machine has hidden characters", () => {
        mockPending.set("r1", request("r1", 1, ["git\u200bhub.com"]));
        render();
        expect(byTestId("agent-hidden-characters")).toHaveLength(1);
    });

    it("pauses the agent from the prompt", async () => {
        render();
        await act(async () => {
            byTestId("agent-pause-from-request")[0]!.props.onPress();
        });
        expect(mockSetPaused).toHaveBeenCalledWith("agent", true);
        expect(mockChangeAgent).toHaveBeenCalledWith("agent", { Paused: true });
    });
});

describe("links from other apps", () => {
    it("never open the approval screen", () => {
        for (const url of [
            "cryptex://agent-request?id=r1",
            "cryptex:///agent-request?id=r1",
            "cryptex://(app)/agent-request",
            "cryptex://%28app%29/Agent-Request",
            "/(app)/agent-request?id=r1",
        ])
            expect(redirectExternalPath(url)).toBe("/");
        expect(redirectExternalPath("cryptex://link-receive?code=1")).toBe(
            "cryptex://link-receive?code=1",
        );
        expect(redirectExternalPath("cryptex://credential-request")).toBe(
            "cryptex://credential-request",
        );
    });
});
