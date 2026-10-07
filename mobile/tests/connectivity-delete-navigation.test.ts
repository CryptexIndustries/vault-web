import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { createElement, useLayoutEffect } from "react";
import { act, create, type ReactTestRenderer, type TestRendererOptions } from "react-test-renderer";
import { err, ok, type Result } from "neverthrow";
import { Provider, createStore } from "jotai";
import {
    SignalingServerConfiguration,
    TURNServerConfiguration,
    Vault,
} from "@cryptex-industries/vault-core/vault-utils/vault";
import { ConnectivityPanel } from "@/components/devices/connectivity-panel";
import { UnlockedConfirmationProvider } from "@/components/unlocked/confirmation-sheet";
import { unlockedVaultAtom } from "@/utils/atoms";
import { persistVaultMutation, type VaultMutation, type VaultMutationError } from "@/utils/vault-mutations";
import TurnServerEditorScreen from "../app/(app)/devices/connectivity/turn/[id]";
import SignalingServerEditorScreen from "../app/(app)/devices/connectivity/signaling/[id]";

jest.mock("react-native", () => ({ View: "View" }));
jest.mock("lucide-react-native", () => ({
    Globe: "Globe",
    RadioTower: "RadioTower",
    Server: "Server",
}));
jest.mock("@/components/ui/dialog", () => ({
    Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
        open ? createElement("Dialog", {}, children) : null,
    DialogHeader: "DialogHeader",
    DialogDescription: "DialogDescription",
}));
jest.mock("@/components/unlocked/unlocked-ui", () => ({
    UnlockedButton: "Button",
    UnlockedInput: "Input",
    UnlockedLabel: "Label",
    UnlockedMenuRow: "MenuRow",
    UnlockedText: "Text",
    UnlockedTaskScreen: "TaskScreen",
    UnlockedDialogTitle: "DialogTitle",
}));
jest.mock("@/components/inline-notice", () => ({ InlineNotice: "Notice" }));
jest.mock("@/utils/atoms", () => {
    const { atom } = jest.requireActual<typeof import("jotai")>("jotai");
    return { unlockedVaultAtom: atom(null) };
});
jest.mock("@/utils/vault-mutations", () => ({
    persistVaultMutation: jest.fn(),
}));
jest.mock("@/utils/test-signaling", () => ({
    testSignalingServerConnection: jest.fn(),
}));
jest.mock("@/utils/test-ice-server", () => ({ testIceServer: jest.fn() }));
jest.mock("expo-router", () => ({
    useLocalSearchParams: () => ({ id: mockServerId }),
    router: { back: () => mockBack() },
}));
jest.mock("expo-router/react-navigation", () => ({
    useNavigation: () => mockNavigation,
    usePreventRemove: (enabled: boolean, callback: typeof mockGuard.callback) => {
        useLayoutEffect(() => {
            mockGuard = { enabled, callback };
            return () => { mockGuard = { enabled: false, callback: undefined }; };
        }, [enabled, callback]);
    },
}));

const mockStore = createStore();
let mockServerId = "";
let mockGuard: {
    enabled: boolean;
    callback?: (event: { data: { action: { type: string } } }) => void;
} = { enabled: false };
let renderer: ReactTestRenderer | undefined;
const mockBack = jest.fn(() => {
    if (mockGuard.enabled) {
        mockGuard.callback?.({ data: { action: { type: "GO_BACK" } } });
    } else {
        renderer?.update(createElement("ServerList"));
    }
});
const mockNavigation = { dispatch: jest.fn() };
const mockPersist = jest.mocked(persistVaultMutation) as jest.MockedFunction<(
    kind: Parameters<typeof persistVaultMutation>[0],
    mutate: VaultMutation<undefined>,
) => Promise<Result<undefined, VaultMutationError>>>;
const nativeRendererOptions: TestRendererOptions & { unstable_isConcurrent: boolean } = {
    createNodeMock: () => null,
    unstable_isConcurrent: true,
};
const editorCases: Array<[
    "TURN" | "signaling",
    typeof TurnServerEditorScreen,
    "TURNServers" | "SignalingServers",
]> = [
    ["TURN", TurnServerEditorScreen, "TURNServers"],
    ["signaling", SignalingServerEditorScreen, "SignalingServers"],
];

beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    (globalThis as { IS_REACT_NATIVE_TEST_ENVIRONMENT?: boolean }).IS_REACT_NATIVE_TEST_ENVIRONMENT = true;
    mockPersist.mockReset();
    mockGuard = { enabled: false };
});

afterEach(async () => {
    await act(async () => renderer?.unmount());
    renderer = undefined;
    delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
    delete (globalThis as { IS_REACT_NATIVE_TEST_ENVIRONMENT?: boolean }).IS_REACT_NATIVE_TEST_ENVIRONMENT;
});

function press(label: string) {
    const scope = renderer!.root.findAllByType("Dialog" as never)[0] ?? renderer!.root;
    const button = scope.findAllByType("Button" as never)
        .find((node) => node.props.children === label);
    expect(button).toBeDefined();
    expect(button!.props.disabled).not.toBe(true);
    button!.props.onPress();
}

function noticeMessages(): string[] {
    return renderer!.root.findAllByType("Notice" as never).map(node => node.props.message);
}

function editName(value: string) {
    renderer!.root.findAllByType("Input" as never)
        .find(node => node.props.accessibilityLabel === "Name")!.props.onChangeText(value);
}

describe.each(editorCases)("%s server deletion", (label, Screen, serverCollection) => {
    const screenTree = () => createElement(Provider, { store: mockStore },
        createElement(UnlockedConfirmationProvider, null, createElement(Screen)));
    const mount = async (id?: string) => {
        const vault = new Vault();
        const target = label === "TURN"
            ? new TURNServerConfiguration("Audit relay", "turn.example.test:3478", "audit", "test-only")
            : new SignalingServerConfiguration("Audit signaling", "app", "key", "test-only", "signal.example.test", "6001", "443");
        const other = label === "TURN"
            ? new TURNServerConfiguration("Other relay", "other.example.test:3478", "other", "test-only")
            : new SignalingServerConfiguration("Other signaling", "other-app", "other-key", "test-only", "other.example.test", "6001", "443");
        if (label === "TURN") vault.LinkedDevices.TURNServers = [target as TURNServerConfiguration, other as TURNServerConfiguration];
        else vault.LinkedDevices.SignalingServers = [target as SignalingServerConfiguration, other as SignalingServerConfiguration];
        mockServerId = id ?? target.ID;
        mockStore.set(unlockedVaultAtom, vault);
        await act(async () => {
            renderer = create(screenTree(), nativeRendererOptions);
        });
        return { target, other };
    };

    it.each([false, true])("returns once after persisted deletion, dirty draft=%s", async dirty => {
        const { target, other } = await mount();
        if (dirty) await act(async () => editName("Unsaved draft"));
        expect(mockGuard.enabled).toBe(dirty);
        let complete!: () => void;
        let deletedVault!: Vault;
        mockPersist.mockImplementation(async (_kind, mutate) => {
            const mutation = await mutate(mockStore.get(unlockedVaultAtom));
            deletedVault = mutation.vault;
            return new Promise(resolve => { complete = () => resolve(ok(undefined)); });
        });

        await act(async () => press("Delete server"));
        expect(renderer!.root.findByType("DialogTitle" as never).props.children).toBe("Delete server?");
        await act(async () => press("Delete server"));
        expect(persistVaultMutation).toHaveBeenCalledTimes(1);
        expect(mockBack).not.toHaveBeenCalled();

        // The persistence helper publishes the new atom before resolving. Force
        // that parent render to commit before the panel can finish deletion.
        await act(async () => mockStore.set(unlockedVaultAtom, deletedVault));
        expect(mockStore.get(unlockedVaultAtom).LinkedDevices[serverCollection].map(server => server.ID))
            .toEqual([other.ID]);
        expect(deletedVault.LinkedDevices[serverCollection].some(server => server.ID === target.ID)).toBe(false);
        await act(async () => complete());

        expect(mockBack).toHaveBeenCalledTimes(1);
        expect(mockNavigation.dispatch).not.toHaveBeenCalled();
        expect(renderer!.root.findAllByType(ConnectivityPanel)).toHaveLength(0);
        expect(renderer!.root.findAllByType("ServerList" as never)).toHaveLength(1);
        expect(mockGuard.enabled).toBe(false);
        expect(renderer!.root.findAllByType("Dialog" as never)).toHaveLength(0);
    });

    it("keeps a canceled deletion and its unsaved edits in the editor", async () => {
        const { target } = await mount();
        await act(async () => editName("Unsaved draft"));
        await act(async () => press("Delete server"));
        await act(async () => press("Keep server"));
        expect(persistVaultMutation).not.toHaveBeenCalled();
        expect(mockBack).not.toHaveBeenCalled();
        expect(mockStore.get(unlockedVaultAtom).LinkedDevices[serverCollection].some(server => server.ID === target.ID)).toBe(true);
        expect(renderer!.root.findAllByType("Input" as never).find(node => node.props.accessibilityLabel === "Name")!.props.value).toBe("Unsaved draft");
        expect(mockGuard.enabled).toBe(true);
        expect(renderer!.root.findAllByType("Dialog" as never)).toHaveLength(0);
    });

    it.each(["returned error", "thrown error"])("keeps a failed deletion in the editor with its error and unsaved edits, %s", async failure => {
        const { target } = await mount();
        await act(async () => editName("Unsaved draft"));
        if (failure === "returned error") mockPersist.mockResolvedValue(err("VAULT_MUTATION_FAILED"));
        else mockPersist.mockRejectedValue(new Error("Storage unavailable."));
        await act(async () => press("Delete server"));
        await act(async () => press("Delete server"));
        expect(persistVaultMutation).toHaveBeenCalledTimes(1);
        expect(mockBack).not.toHaveBeenCalled();
        expect(mockStore.get(unlockedVaultAtom).LinkedDevices[serverCollection].some(server => server.ID === target.ID)).toBe(true);
        expect(noticeMessages()).toContain(failure === "returned error"
            ? "Could not delete server. Please try again."
            : "Storage unavailable.");
        expect(renderer!.root.findAllByType("Input" as never).find(node => node.props.accessibilityLabel === "Name")!.props.value).toBe("Unsaved draft");
        expect(mockGuard.enabled).toBe(true);

        // A failure must release the temporary local-delete exemption.
        const removedBySync = Object.assign(new Vault(), mockStore.get(unlockedVaultAtom));
        removedBySync.LinkedDevices = Object.assign(new Vault().LinkedDevices, removedBySync.LinkedDevices);
        if (serverCollection === "TURNServers") removedBySync.LinkedDevices.TURNServers = [];
        else removedBySync.LinkedDevices.SignalingServers = [];
        await act(async () => mockStore.set(unlockedVaultAtom, removedBySync));
        expect(renderer!.root.findAllByType(ConnectivityPanel)).toHaveLength(0);
        expect(noticeMessages()).toContain(`This ${label} server no longer exists.`);
        expect(mockBack).not.toHaveBeenCalled();
    });

    it("allows a failed deletion to be retried successfully without an extra confirmation", async () => {
        const { target, other } = await mount();
        await act(async () => editName("Unsaved draft"));
        mockPersist.mockResolvedValueOnce(err("VAULT_MUTATION_FAILED"));
        await act(async () => press("Delete server"));
        await act(async () => press("Delete server"));
        expect(mockBack).not.toHaveBeenCalled();
        mockPersist.mockImplementation(async (_kind, mutate) => {
            const mutation = await mutate(mockStore.get(unlockedVaultAtom));
            mockStore.set(unlockedVaultAtom, mutation.vault);
            return ok(undefined);
        });
        await act(async () => press("Delete server"));
        await act(async () => press("Delete server"));
        expect(persistVaultMutation).toHaveBeenCalledTimes(2);
        expect(mockStore.get(unlockedVaultAtom).LinkedDevices[serverCollection].map(server => server.ID)).toEqual([other.ID]);
        expect(mockStore.get(unlockedVaultAtom).LinkedDevices[serverCollection].some(server => server.ID === target.ID)).toBe(false);
        expect(mockBack).toHaveBeenCalledTimes(1);
        expect(renderer!.root.findAllByType("ServerList" as never)).toHaveLength(1);
        expect(renderer!.root.findAllByType("Dialog" as never)).toHaveLength(0);
    });

    it("preserves the missing-ID notice for an unopened editor", async () => {
        await mount("missing-server");
        expect(renderer!.root.findAllByType(ConnectivityPanel)).toHaveLength(0);
        expect(noticeMessages()).toContain(`This ${label} server no longer exists.`);
        expect(mockBack).not.toHaveBeenCalled();
    });

    it("does not carry an opened editor into a different missing ID", async () => {
        await mount();
        mockServerId = "missing-server";
        await act(async () => renderer!.update(screenTree()));
        expect(renderer!.root.findAllByType(ConnectivityPanel)).toHaveLength(0);
        expect(noticeMessages()).toContain(`This ${label} server no longer exists.`);
        expect(mockBack).not.toHaveBeenCalled();
    });

    it("does not apply an in-flight deletion's exemption or navigation to a different ID", async () => {
        const { target } = await mount();
        let complete!: () => void;
        let deletedVault!: Vault;
        mockPersist.mockImplementation(async (_kind, mutate) => {
            const mutation = await mutate(mockStore.get(unlockedVaultAtom));
            deletedVault = mutation.vault;
            return new Promise(resolve => { complete = () => resolve(ok(undefined)); });
        });
        await act(async () => press("Delete server"));
        await act(async () => press("Delete server"));
        await act(async () => mockStore.set(unlockedVaultAtom, deletedVault));
        mockServerId = "missing-server";
        await act(async () => renderer!.update(screenTree()));
        expect(renderer!.root.findAllByType(ConnectivityPanel)).toHaveLength(0);
        expect(noticeMessages()).toContain(`This ${label} server no longer exists.`);
        await act(async () => complete());
        expect(mockBack).not.toHaveBeenCalled();

        mockServerId = target.ID;
        await act(async () => renderer!.update(screenTree()));
        expect(renderer!.root.findAllByType(ConnectivityPanel)).toHaveLength(0);
        expect(noticeMessages()).toContain(`This ${label} server no longer exists.`);
        expect(mockBack).not.toHaveBeenCalled();
    });

    it("still shows the missing-ID notice if sync removes the server without a local deletion", async () => {
        const { target, other } = await mount();
        await act(async () => editName("Unsaved draft"));
        const updated = Object.assign(new Vault(), mockStore.get(unlockedVaultAtom));
        updated.LinkedDevices = Object.assign(new Vault().LinkedDevices, updated.LinkedDevices);
        if (serverCollection === "TURNServers") {
            updated.LinkedDevices.TURNServers = updated.LinkedDevices.TURNServers.filter(server => server.ID !== target.ID);
        } else {
            updated.LinkedDevices.SignalingServers = updated.LinkedDevices.SignalingServers.filter(server => server.ID !== target.ID);
        }
        await act(async () => mockStore.set(unlockedVaultAtom, updated));
        expect(updated.LinkedDevices[serverCollection].map(server => server.ID)).toEqual([other.ID]);
        expect(renderer!.root.findAllByType(ConnectivityPanel)).toHaveLength(0);
        expect(noticeMessages()).toContain(`This ${label} server no longer exists.`);
        expect(persistVaultMutation).not.toHaveBeenCalled();
        expect(mockBack).not.toHaveBeenCalled();
    });
});
