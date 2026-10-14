import { afterEach, beforeEach, expect, it, jest } from "@jest/globals";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { LinkedDevice } from "@cryptex-industries/vault-core/vault-utils/vault";
import {
    SignalingStatus,
    WebRTCStatus,
} from "@cryptex-industries/vault-core/synchronization-utils";
import { buildDeviceRelationshipMap } from "@/components/account/device-topology";
import {
    DeviceDetails,
    type DeviceDetailsProps,
} from "@/components/devices/device-details-sheet";
import { DeviceActionError } from "@/components/devices/device-action-error";
import * as deviceDates from "@/components/devices/device-dates";

const mockListScroll = jest.fn();

jest.mock("react-native", () => ({
    View: "View",
    Pressable: "Pressable",
    ScrollView: "ScrollView",
    useWindowDimensions: () => ({ width: 376, height: 724 }),
}));
jest.mock("react-native-actions-sheet", () => {
    const React = jest.requireActual<typeof import("react")>("react");
    return {
        ScrollView: "ScrollView",
        FlatList: React.forwardRef((props: any, ref) => {
            React.useImperativeHandle(ref, () => ({
                scrollToOffset: mockListScroll,
            }));
            return React.createElement(
                "SheetFlatList",
                props,
                props.ListHeaderComponent,
                props.data
                    .slice(0, props.initialNumToRender)
                    .map((item: { id: string }, index: number) =>
                        React.createElement(
                            React.Fragment,
                            { key: item.id },
                            props.renderItem({ item, index }),
                        ),
                    ),
                props.ListFooterComponent,
            );
        }),
    };
});
jest.mock("react-native-svg", () => ({
    __esModule: true,
    default: "Svg",
    Path: "Path",
}));
jest.mock("lucide-react-native", () => ({
    ArrowLeft: "ArrowLeft",
    ChevronDown: "ChevronDown",
    ChevronRight: "ChevronRight",
    Copy: "Copy",
    GitBranch: "GitBranch",
    HardDrive: "HardDrive",
    LocateFixed: "LocateFixed",
    Server: "Server",
    Settings2: "Settings2",
    Shield: "Shield",
    Unlink: "Unlink",
    X: "X",
    Laptop: "Laptop",
    Monitor: "Monitor",
    Smartphone: "Smartphone",
    HelpCircle: "HelpCircle",
    Plus: "Plus",
    RotateCw: "RotateCw",
}));
jest.mock("@/components/unlocked/unlocked-ui", () => ({
    UnlockedButton: "Button",
    UnlockedDialogTitle: "Title",
    UnlockedInput: "Input",
    UnlockedLabel: "Label",
    UnlockedText: "Text",
}));
jest.mock("@/components/ui/switch", () => ({ Switch: "Switch" }));

let renderer: ReactTestRenderer | undefined;
let props: DeviceDetailsProps;
let local: LinkedDevice;
const element = (id: string) =>
    renderer!.root.findAll(
        (node) => node.props.testID === id && typeof node.type === "string",
    )[0];
const content = () => JSON.stringify(renderer!.toJSON());
function manyConnections() {
    props.map = buildDeviceRelationshipMap(
        {
            devices: [
                "phone",
                ...Array.from({ length: 50 }, (_, i) => `peer-${i}`),
            ].map((id) => ({
                id,
                current: id === "phone",
                root: id === "phone",
                lastSeen: null,
                createdAt: new Date(0),
            })),
            relationships: Array.from({ length: 50 }, (_, i) => ({
                syncId: `link-${i}`,
                fromDeviceId: "phone",
                toDeviceId: `peer-${i}`,
                createdAt: new Date(0),
            })),
        },
        [],
        "phone",
        { topologyVerified: true },
    );
    props.selection = { kind: "node", id: props.map.currentDeviceId };
}
const press = async (id: string) => {
    const node = element(id)!;
    expect(node.props.disabled).not.toBe(true);
    await act(async () => node.props.onPress());
};
async function render() {
    await act(async () => {
        if (renderer) renderer.update(createElement(DeviceDetails, props));
        else renderer = create(createElement(DeviceDetails, props));
    });
}
beforeEach(async () => {
    (
        globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    (
        globalThis as { IS_REACT_NATIVE_TEST_ENVIRONMENT?: boolean }
    ).IS_REACT_NATIVE_TEST_ENVIRONMENT = true;
    local = new LinkedDevice("Work laptop", "direct", "key", "kem");
    local.ID = "saved-peer";
    props = {
        open: true,
        map: buildDeviceRelationshipMap(
            {
                devices: ["phone", "peer", "remote"].map((id) => ({
                    id,
                    current: id === "phone",
                    root: id === "phone",
                    lastSeen: null,
                    createdAt: new Date(0),
                })),
                relationships: [
                    {
                        syncId: "direct",
                        fromDeviceId: "phone",
                        toDeviceId: "peer",
                        createdAt: new Date(0),
                    },
                    {
                        syncId: "remote",
                        fromDeviceId: "peer",
                        toDeviceId: "remote",
                        createdAt: new Date(0),
                    },
                ],
            },
            [local],
            "phone",
            { topologyVerified: true },
        ),
        selection: { kind: "edge", id: "server:direct" },
        connectionStatuses: {},
        signalingConfig: {
            SignalingServers: [],
            STUNServers: [],
            TURNServers: [],
        },
        isRoot: true,
        hasSession: true,
        sessionGeneration: 1,
        canPromote: true,
        pending: false,
        onChoose: jest.fn(),
        onExplore: jest.fn(),
        onCopy: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
        onSave: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
        onConnect: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
        onUnlinkLocal: jest
            .fn<() => Promise<void>>()
            .mockResolvedValue(undefined),
        onUnlinkRelationship: jest
            .fn<() => Promise<void>>()
            .mockResolvedValue(undefined),
        onRemoveAccountDevice: jest
            .fn<() => Promise<void>>()
            .mockResolvedValue(undefined),
        onToggleRoot: jest.fn(),
        onSuccess: jest.fn(),
        onClose: jest.fn(),
        onDismissibleChange: jest.fn(),
    };
    await render();
});
afterEach(async () => {
    await act(async () => renderer?.unmount());
    renderer = undefined;
    jest.restoreAllMocks();
    delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
        .IS_REACT_ACT_ENVIRONMENT;
    delete (globalThis as { IS_REACT_NATIVE_TEST_ENVIRONMENT?: boolean })
        .IS_REACT_NATIVE_TEST_ENVIRONMENT;
});

it("reuses a warm relationship overview when the same connection closes and reopens", async () => {
    jest.spyOn(Date, "now").mockReturnValue(120_000);
    props.connectionStatuses = {
        [local.ID]: {
            signalingServerStatus: SignalingStatus.Connected,
            webRTCStatus: WebRTCStatus.Disconnected,
            lastSync: new Date(60_000),
        },
    };
    const formatDate = jest.spyOn(deviceDates, "formatDeviceDateTime");
    await render();
    expect(formatDate).toHaveBeenCalledWith(new Date(60_000));
    const calls = formatDate.mock.calls.length;
    const syncContents = element("device-detail-sync")!.props.children;
    props.open = false;
    await render();
    props.open = true;
    await render();
    expect(formatDate).toHaveBeenCalledTimes(calls);
    expect(element("device-detail-sync")!.props.children).toBe(syncContents);
});

it("reuses a warm device overview and refreshes its relative activity after a minute", async () => {
    const now = jest.spyOn(Date, "now").mockReturnValue(120_000);
    props.selection = { kind: "node", id: "account:peer" };
    props.connectionStatuses = {
        [local.ID]: {
            signalingServerStatus: SignalingStatus.Connected,
            webRTCStatus: WebRTCStatus.Disconnected,
            lastSync: new Date(110_000),
        },
    };
    const formatActivity = jest.spyOn(deviceDates, "formatDeviceActivity");
    await render();
    expect(element("device-last-sync")!.props.children).toBe("Just now");
    const calls = formatActivity.mock.calls.length;
    props.open = false;
    await render();
    props.open = true;
    await render();
    expect(formatActivity).toHaveBeenCalledTimes(calls);
    props.open = false;
    await render();
    now.mockReturnValue(181_000);
    props.open = true;
    await render();
    expect(element("device-last-sync")!.props.children).toBe("1m ago");
    expect(formatActivity).toHaveBeenCalledTimes(calls + 1);
});

it("updates a retained connection's live status, busy guard and action callbacks", async () => {
    const previousConnect = props.onConnect;
    const nextConnect = jest
        .fn<() => Promise<void>>()
        .mockResolvedValue(undefined);
    const nextChoose = jest.fn<DeviceDetailsProps["onChoose"]>();
    props.onConnect = nextConnect;
    props.onChoose = nextChoose;
    props.connectionStatuses = {
        [local.ID]: {
            signalingServerStatus: SignalingStatus.Connected,
            webRTCStatus: WebRTCStatus.Connected,
            lastSync: new Date(90_000),
        },
    };
    props.pending = true;
    await render();
    expect(content()).toContain("Sync now");
    expect(element("device-detail-sync")!.props.disabled).toBe(true);
    const peer = props.map.nodes.find((node) => node.id === "account:peer")!;
    const endpoint = () =>
        renderer!.root
            .findAllByType("Pressable" as never)
            .find(
                (node) =>
                    node.props.accessibilityLabel ===
                    `Open ${peer.displayName} details`,
            )!;
    expect(endpoint().props.disabled).toBe(true);
    props.pending = false;
    await render();
    await press("device-detail-sync");
    expect(nextConnect).toHaveBeenCalledWith(local.ID);
    expect(previousConnect).not.toHaveBeenCalled();
    await act(async () => endpoint().props.onPress());
    expect(nextChoose).toHaveBeenCalledWith({ kind: "node", id: peer.id });
});

it("updates a retained device's data, permissions and root/explore callbacks", async () => {
    props.selection = { kind: "node", id: "account:peer" };
    await render();
    const previousRoot = props.onToggleRoot;
    const previousExplore = props.onExplore;
    const nextRoot = jest.fn<DeviceDetailsProps["onToggleRoot"]>();
    const nextExplore = jest.fn<DeviceDetailsProps["onExplore"]>();
    const latestNode = {
        ...props.map.nodes.find((node) => node.id === "account:peer")!,
        displayName: "Renamed laptop",
    };
    props.map = {
        ...props.map,
        nodes: props.map.nodes.map((node) =>
            node.id === latestNode.id ? latestNode : node,
        ),
    };
    props.onToggleRoot = nextRoot;
    props.onExplore = nextExplore;
    props.canPromote = false;
    await render();
    expect(content()).toContain("Renamed laptop");
    expect(element("device-toggle-root")!.props.disabled).toBe(true);
    expect(content()).toContain("Root changes are restricted on this account.");
    props.canPromote = true;
    props.pending = true;
    await render();
    expect(element("device-toggle-root")!.props.disabled).toBe(true);
    props.pending = false;
    await render();
    await press("device-toggle-root");
    await press("device-explore-connections");
    expect(nextRoot).toHaveBeenCalledWith(latestNode);
    expect(previousRoot).not.toHaveBeenCalled();
    expect(nextExplore).toHaveBeenCalledWith(latestNode.id);
    expect(previousExplore).not.toHaveBeenCalled();
});

it("requires explicit connection confirmation and leaves account removal separate", async () => {
    await press("device-unlink");
    expect(props.onUnlinkLocal).not.toHaveBeenCalled();
    expect(content()).toContain("Keep the device’s account registration.");
    await press("device-confirm-unlink");
    expect(props.onUnlinkLocal).toHaveBeenCalledWith(local, false);
    expect(props.onUnlinkRelationship).not.toHaveBeenCalled();
    expect(props.onRemoveAccountDevice).not.toHaveBeenCalled();
});

it("virtualizes a long device's connection rows while retaining all records and account access", async () => {
    manyConnections();
    await render();
    const body = element("device-details-body")!;
    expect(body.type).toBe("SheetFlatList");
    expect(body.props.data).toHaveLength(50);
    expect(body.props.initialNumToRender).toBeLessThanOrEqual(4);
    expect(body.props.style.height).toBe(724);
    expect(body.props.onContentSizeChange).toBeUndefined();
    expect(
        renderer!.root.findAll(
            (node) =>
                typeof node.type === "string" &&
                node.props.testID?.startsWith("device-connection-"),
        ),
    ).toHaveLength(4);
    expect(element("device-toggle-root")).toBeDefined();
    expect(element("device-connection-server:link-49")).toBeUndefined();
    await press("device-connection-server:link-0");
    expect(props.onChoose).toHaveBeenCalledWith({
        kind: "edge",
        id: "server:link-0",
    });
});

it("keeps mounted connection rows stable when unrelated controller props change", async () => {
    manyConnections();
    await render();
    const id = "device-connection-server:link-0";
    const children = element(id)!.props.children;
    props.onCopy = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
    await render();
    expect(element(id)!.props.children).toBe(children);
    props.pending = true;
    await render();
    expect(element(id)!.props.disabled).toBe(true);
    expect(element(id)!.props.children).not.toBe(children);
});

it("resets long-list scroll for a new selection and ignores the previous body's late measurement", async () => {
    const measurePreviousBody = element("device-details-body")!.props
        .onContentSizeChange;
    manyConnections();
    await render();
    const oldBody = element("device-details-body")!;
    await act(async () =>
        oldBody.props.onScroll({ nativeEvent: { contentOffset: { y: 600 } } }),
    );
    props.selection = { kind: "node", id: "account:peer-0" };
    await render();
    const body = element("device-details-body")!;
    expect(body.type).toBe("ScrollView");
    expect(body.props.style.height).toBeUndefined();
    await act(async () => measurePreviousBody(376, 4300));
    expect(element("device-details-body")!.props.style.height).toBeUndefined();
    await act(async () => body.props.onContentSizeChange(376, 440));
    expect(element("device-details-body")!.props.style.height).toBe(440);
    props.selection = { kind: "node", id: props.map.currentDeviceId };
    await render();
    expect(mockListScroll).toHaveBeenLastCalledWith({
        offset: 0,
        animated: false,
    });
});

it("allows a signed-in non-root participant to unlink its own saved link without account topology", async () => {
    props.isRoot = false;
    props.map = buildDeviceRelationshipMap(undefined, [local], "phone");
    props.selection = { kind: "edge", id: "local-link:saved-peer" };
    await render();
    await press("device-unlink");
    await press("device-confirm-unlink");
    expect(props.onUnlinkLocal).toHaveBeenCalledWith(local, false);
    expect(props.onUnlinkRelationship).not.toHaveBeenCalled();
    expect(props.onRemoveAccountDevice).not.toHaveBeenCalled();
});

it("blocks a known missing Online Services link and offers explicit local recovery", async () => {
    props.map = buildDeviceRelationshipMap(
        {
            devices: [
                {
                    id: "phone",
                    current: true,
                    root: true,
                    lastSeen: null,
                    createdAt: new Date(0),
                },
            ],
            relationships: [],
        },
        [local],
        "phone",
        { topologyVerified: true },
    );
    props.selection = { kind: "edge", id: "local-link:saved-peer" };
    await render();
    await press("device-unlink");
    expect(element("device-confirm-unlink")!.props.disabled).toBe(true);
    expect(props.onUnlinkLocal).not.toHaveBeenCalled();
    await press("device-unlink-recovery");
    await press("device-forget-locally");
    await press("device-confirm-forget");
    expect(props.onUnlinkLocal).toHaveBeenCalledWith(local, true);
});

it.each(["missing session", "empty relationship ID"])(
    "blocks own Online Services unlink with %s",
    async (state) => {
        if (state === "missing session") props.hasSession = false;
        else props.map.relationships[0]!.syncId = "";
        await render();
        await press("device-unlink");
        expect(element("device-confirm-unlink")!.props.disabled).toBe(true);
        expect(props.onUnlinkLocal).not.toHaveBeenCalled();
    },
);

it("removes only a selected server-only relationship and explains retained identities", async () => {
    props.selection = { kind: "edge", id: "server:remote" };
    await render();
    expect(element("device-detail-sync")).toBeUndefined();
    expect(element("device-sync-settings")).toBeUndefined();
    expect(content()).toContain("Status unknown");
    await press("device-unlink");
    expect(content()).toContain(
        "Keep both devices registered and preserve their other connections.",
    );
    await press("device-confirm-unlink");
    expect(props.onUnlinkRelationship).toHaveBeenCalledWith("server:remote");
    expect(props.onUnlinkLocal).not.toHaveBeenCalled();
    expect(props.onRemoveAccountDevice).not.toHaveBeenCalled();
});

it.each(["non-root", "unverified"])(
    "blocks server-only unlink with %s account evidence",
    async (state) => {
        props.selection = { kind: "edge", id: "server:remote" };
        if (state === "non-root") props.isRoot = false;
        else props.map.topologyVerified = false;
        await render();
        await press("device-unlink");
        expect(element("device-confirm-unlink")!.props.disabled).toBe(true);
        expect(props.onUnlinkRelationship).not.toHaveBeenCalled();
    },
);

it("requires choosing a connection when a device has several and switches to whole-device removal", async () => {
    props.selection = { kind: "node", id: "account:peer" };
    await render();
    await press("device-remove-account");
    expect(element("device-confirm-unlink")!.props.disabled).toBe(true);
    expect(
        element("device-unlink-scope-connection")!.props.accessibilityState
            .selected,
    ).toBe(true);
    expect(
        element("device-unlink-scope-device")!.props.accessibilityState
            .selected,
    ).toBe(false);
    await press("device-unlink-scope-device");
    expect(
        element("device-unlink-scope-connection")!.props.accessibilityState
            .selected,
    ).toBe(false);
    expect(
        element("device-unlink-scope-device")!.props.accessibilityState
            .selected,
    ).toBe(true);
    await press("device-unlink-scope-connection");
    expect(
        element("device-unlink-scope-connection")!.props.accessibilityState
            .selected,
    ).toBe(true);
    expect(
        element("device-unlink-scope-device")!.props.accessibilityState
            .selected,
    ).toBe(false);
    await press("device-unlink-scope-device");
    expect(content()).toContain("all its server relationships");
    await press("device-confirm-unlink");
    expect(props.onRemoveAccountDevice).toHaveBeenCalledWith("peer");
    expect(props.onUnlinkLocal).not.toHaveBeenCalled();
    expect(props.onUnlinkRelationship).not.toHaveBeenCalled();
});

it("keeps a chosen connection through picker cancellation and confirms only that relationship", async () => {
    props.selection = { kind: "node", id: "account:peer" };
    await render();
    await press("device-remove-account");
    expect(element("device-connection-server:remote")).toBeUndefined();
    await press("device-choose-removal-connection");
    await press("device-connection-server:remote");
    expect(element("device-confirm-unlink")!.props.disabled).toBe(false);
    await press("device-choose-removal-connection");
    await press("device-cancel-connection-choice");
    expect(
        element("device-unlink-scope-connection")!.props.accessibilityState
            .selected,
    ).toBe(true);
    await press("device-confirm-unlink");
    expect(props.onUnlinkRelationship).toHaveBeenCalledWith("server:remote");
    expect(props.onUnlinkLocal).not.toHaveBeenCalled();
    expect(props.onRemoveAccountDevice).not.toHaveBeenCalled();
});

it("does not offer other relationships when unlink was opened from a selected connection", async () => {
    await press("device-unlink");
    expect(element("device-choose-removal-connection")).toBeUndefined();
    expect(element("device-connection-server:remote")).toBeUndefined();
    await press("device-confirm-unlink");
    expect(props.onUnlinkLocal).toHaveBeenCalledWith(local, false);
    expect(props.onUnlinkRelationship).not.toHaveBeenCalled();
});

it("keeps failed unlink in recovery until local forgetting is separately confirmed", async () => {
    jest.mocked(props.onUnlinkLocal).mockRejectedValueOnce(
        new Error("Server denied"),
    );
    await press("device-unlink");
    await press("device-confirm-unlink");
    expect(content()).toContain("Could not unlink");
    expect(props.onClose).not.toHaveBeenCalled();
    await press("device-forget-locally");
    expect(props.onUnlinkLocal).toHaveBeenCalledTimes(1);
    expect(content()).toContain("Any Online Services relationship may remain.");
    await press("device-confirm-forget");
    expect(props.onUnlinkLocal).toHaveBeenLastCalledWith(local, true);
    expect(props.onRemoveAccountDevice).not.toHaveBeenCalled();
});

it("does not offer local forgetting after a server-only unlink fails", async () => {
    props.selection = { kind: "edge", id: "server:remote" };
    jest.mocked(props.onUnlinkRelationship).mockRejectedValueOnce(
        new Error("Permission denied"),
    );
    await render();
    await press("device-unlink");
    await press("device-confirm-unlink");
    expect(element("device-retry-unlink")).toBeDefined();
    expect(element("device-forget-locally")).toBeUndefined();
    expect(props.onUnlinkLocal).not.toHaveBeenCalled();
    expect(content()).not.toContain("forget its saved link");
});

it("returns from Cancel to the connection that opened scoped unlink", async () => {
    await press("device-unlink");
    await press("device-unlink-scope-device");
    await press("device-cancel-unlink");
    expect(element("device-sync-settings")).toBeDefined();
    expect(props.onChoose).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
    expect(props.onUnlinkLocal).not.toHaveBeenCalled();
    expect(props.onRemoveAccountDevice).not.toHaveBeenCalled();
});

it("keeps whole-device failure and cancellation on the selected removal scope", async () => {
    props.selection = { kind: "node", id: "account:peer" };
    jest.mocked(props.onRemoveAccountDevice).mockRejectedValueOnce(
        new Error("Permission denied"),
    );
    await render();
    await press("device-remove-account");
    await press("device-unlink-scope-device");
    await press("device-confirm-unlink");
    expect(content()).toContain("Could not remove device");
    expect(content()).not.toContain("forget its saved link");
    await press("device-cancel-recovery");
    expect(
        element("device-unlink-scope-device")!.props.accessibilityState
            .selected,
    ).toBe(true);
    await press("device-cancel-unlink");
    expect(element("device-copy-id")).toBeDefined();
    expect(props.onChoose).not.toHaveBeenCalled();
});

it("offers local cleanup after completed server unlink without retrying the server", async () => {
    jest.mocked(props.onUnlinkLocal).mockRejectedValueOnce(
        new DeviceActionError(
            "Online Services removed the relationship. The saved link remains.",
            "connection-unlinked",
            true,
        ),
    );
    await press("device-unlink");
    await press("device-confirm-unlink");
    expect(content()).toContain("Connection unlinked");
    expect(content()).toContain("The saved link remains.");
    expect(element("device-retry-unlink")).toBeUndefined();
    await press("device-forget-locally");
    await press("device-confirm-forget");
    expect(props.onUnlinkLocal).toHaveBeenLastCalledWith(local, true);
    expect(props.onClose).toHaveBeenCalledTimes(1);
});

it("does not offer retry or unnecessary local cleanup after a completed removal's refresh fails", async () => {
    jest.mocked(props.onUnlinkLocal).mockRejectedValueOnce(
        new DeviceActionError(
            "Online Services removed the relationship. Account refresh failed.",
            "connection-unlinked",
            false,
        ),
    );
    await press("device-unlink");
    await press("device-confirm-unlink");
    expect(content()).toContain("Account refresh failed.");
    expect(element("device-retry-unlink")).toBeUndefined();
    expect(element("device-forget-locally")).toBeUndefined();
});

it("acknowledges copied IDs and offers a selectable ID when clipboard access fails", async () => {
    await press("device-link-information");
    await press("device-copy-relationship-id");
    expect(props.onCopy).toHaveBeenCalledWith("direct");
    expect(content()).toContain("Copied");
    jest.mocked(props.onCopy).mockRejectedValueOnce(
        new Error("Clipboard unavailable"),
    );
    await press("device-copy-relationship-id");
    expect(content()).toContain("Could not copy ID");
    expect(content()).toContain("Select the ID below to copy it manually.");
    expect(
        renderer!.root
            .findAllByType("Text" as never)
            .some(
                (node) =>
                    node.props.selectable && node.props.children === "direct",
            ),
    ).toBe(true);
});

it("keeps mixed server providers independent and does not expose credentials", async () => {
    local.SignalingServerID = "custom-signal";
    local.STUNServerIDs = [];
    local.TURNServerIDs = ["custom-turn"];
    props.signalingConfig = {
        SignalingServers: [
            {
                ID: "custom-signal",
                Host: "signal.example.test",
                Key: "secret-key",
                Secret: "secret-token",
            } as never,
        ],
        STUNServers: [],
        TURNServers: [
            {
                ID: "custom-turn",
                Host: "turn.example.test",
                Username: "secret-user",
                Password: "secret-password",
            } as never,
        ],
    };
    await render();
    await press("device-servers");
    expect(content()).toContain("signal.example.test");
    expect(content()).toContain("turn.example.test");
    expect(content()).toContain("Online Services");
    for (const secret of [
        "secret-key",
        "secret-token",
        "secret-user",
        "secret-password",
    ])
        expect(content()).not.toContain(secret);
});

it("checks unsaved settings before returning and discards without saving", async () => {
    await press("device-sync-settings");
    const input = renderer!.root
        .findAllByType("Input" as never)
        .find(
            (node) => node.props.accessibilityLabel === "Device display name",
        )!;
    await act(async () => input.props.onChangeText("Changed laptop"));
    await press("device-cancel-settings");
    expect(content()).toContain("You have unsaved changes.");
    await press("device-discard-settings");
    expect(element("device-sync-settings")).toBeDefined();
    expect(props.onSave).not.toHaveBeenCalled();
});

function deferred() {
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<void>((done, fail) => {
        resolve = done;
        reject = fail;
    });
    return { promise, resolve, reject };
}

async function renameDraft(name: string) {
    const input = renderer!.root
        .findAllByType("Input" as never)
        .find(
            (node) => node.props.accessibilityLabel === "Device display name",
        )!;
    await act(async () => input.props.onChangeText(name));
}

it("clears completed recovery when the user selects another connection", async () => {
    jest.mocked(props.onUnlinkLocal).mockRejectedValueOnce(
        new DeviceActionError(
            "The saved link remains.",
            "connection-unlinked",
            true,
        ),
    );
    await press("device-unlink");
    await press("device-confirm-unlink");
    expect(element("device-forget-locally")).toBeDefined();
    props.selection = { kind: "edge", id: "server:remote" };
    await render();
    expect(element("device-forget-locally")).toBeUndefined();
    expect(element("device-unlink")).toBeDefined();
    expect(content()).not.toContain("The saved link remains.");
});

it("ignores a late unlink failure after selecting another connection", async () => {
    const request = deferred();
    jest.mocked(props.onUnlinkLocal).mockReturnValueOnce(request.promise);
    await press("device-unlink");
    await press("device-confirm-unlink");
    props.selection = { kind: "edge", id: "server:remote" };
    await render();
    await act(async () =>
        request.reject(
            new DeviceActionError(
                "The old saved link remains.",
                "connection-unlinked",
                true,
            ),
        ),
    );
    expect(element("device-forget-locally")).toBeUndefined();
    expect(element("device-unlink")).toBeDefined();
    expect(content()).not.toContain("The old saved link remains.");
    expect(props.onClose).not.toHaveBeenCalled();
});

it("ignores old unlink results after close and reopen, then permits a fresh operation", async () => {
    const request = deferred();
    jest.mocked(props.onUnlinkLocal).mockReturnValueOnce(request.promise);
    await press("device-unlink");
    await press("device-confirm-unlink");
    props.open = false;
    await render();
    props.open = true;
    await render();
    await act(async () => request.resolve());
    expect(props.onSuccess).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
    expect(element("device-unlink")).toBeDefined();
    await press("device-unlink");
    await press("device-confirm-unlink");
    expect(props.onUnlinkLocal).toHaveBeenCalledTimes(2);
    expect(props.onClose).toHaveBeenCalledTimes(1);
});

it("drops recovery from an old vault session even when the selected ID is unchanged", async () => {
    const request = deferred();
    jest.mocked(props.onUnlinkLocal).mockReturnValueOnce(request.promise);
    await press("device-unlink");
    await press("device-confirm-unlink");
    props.sessionGeneration += 1;
    await render();
    await act(async () =>
        request.reject(
            new DeviceActionError(
                "The original vault needs cleanup.",
                "connection-unlinked",
                true,
            ),
        ),
    );
    expect(content()).not.toContain("The original vault needs cleanup.");
    expect(element("device-forget-locally")).toBeUndefined();
    expect(element("device-unlink")).toBeDefined();
});

it("preserves same-selection cleanup when topology refresh removes its map record", async () => {
    const request = deferred();
    jest.mocked(props.onUnlinkLocal).mockReturnValueOnce(request.promise);
    await press("device-unlink");
    await press("device-confirm-unlink");
    props.map = {
        ...props.map,
        relationships: props.map.relationships.filter(
            (edge) => edge.id !== props.selection.id,
        ),
    };
    await render();
    await act(async () =>
        request.reject(
            new DeviceActionError(
                "The saved link remains.",
                "connection-unlinked",
                true,
            ),
        ),
    );
    expect(content()).toContain("The saved link remains.");
    await press("device-forget-locally");
    await press("device-confirm-forget");
    expect(props.onUnlinkLocal).toHaveBeenLastCalledWith(local, true);
});

it("keeps dirty settings protected after validation failure until explicitly discarded", async () => {
    await press("device-sync-settings");
    await renameDraft(" ");
    await press("device-save-settings");
    expect(content()).toContain("Device name is required");
    expect(props.onDismissibleChange).toHaveBeenLastCalledWith(false);
    await press("device-dismiss-error");
    await press("device-cancel-settings");
    expect(content()).toContain("You have unsaved changes.");
    expect(props.onDismissibleChange).toHaveBeenLastCalledWith(false);
    await press("device-discard-settings");
    expect(props.onDismissibleChange).toHaveBeenLastCalledWith(true);
    expect(props.onSave).not.toHaveBeenCalled();
});

it("retains dirty settings and their dismiss guard after a failed save", async () => {
    jest.mocked(props.onSave).mockRejectedValueOnce(
        new Error("Could not persist changes"),
    );
    await press("device-sync-settings");
    await renameDraft("Changed laptop");
    await press("device-save-settings");
    expect(content()).toContain("Could not persist changes");
    expect(props.onDismissibleChange).toHaveBeenLastCalledWith(false);
    await press("device-dismiss-error");
    expect(
        renderer!.root
            .findAllByType("Input" as never)
            .find(
                (node) =>
                    node.props.accessibilityLabel === "Device display name",
            )!.props.value,
    ).toBe("Changed laptop");
    await press("device-save-settings");
    expect(props.onDismissibleChange).toHaveBeenLastCalledWith(true);
    expect(element("device-sync-settings")).toBeDefined();
});

it("does not let a late save return or announce success in a new selection", async () => {
    const request = deferred();
    jest.mocked(props.onSave).mockReturnValueOnce(request.promise);
    await press("device-sync-settings");
    await renameDraft("Changed laptop");
    await press("device-save-settings");
    props.selection = { kind: "edge", id: "server:remote" };
    await render();
    await act(async () => request.resolve());
    expect(props.onSuccess).not.toHaveBeenCalled();
    expect(element("device-unlink")).toBeDefined();
    expect(element("device-save-settings")).toBeUndefined();
    expect(props.onDismissibleChange).toHaveBeenLastCalledWith(true);
});

function changeRelationshipId(syncId: string) {
    props.map = {
        ...props.map,
        relationships: props.map.relationships.map((edge) =>
            edge.id === props.selection.id ? { ...edge, syncId } : edge,
        ),
    };
}

it("clears copied feedback when the displayed relationship ID changes", async () => {
    await press("device-link-information");
    await press("device-copy-relationship-id");
    expect(content()).toContain("Copied");
    changeRelationshipId("replacement-id");
    await render();
    expect(content()).not.toContain("Copied");
    await press("device-copy-relationship-id");
    expect(props.onCopy).toHaveBeenLastCalledWith("replacement-id");
});

it.each(["resolve", "reject"] as const)(
    "ignores a late clipboard %s for a replaced relationship ID",
    async (outcome) => {
        const request = deferred();
        jest.mocked(props.onCopy).mockReturnValueOnce(request.promise);
        await press("device-link-information");
        await press("device-copy-relationship-id");
        changeRelationshipId("replacement-id");
        await render();
        await act(async () => {
            if (outcome === "resolve") request.resolve();
            else request.reject(new Error("Clipboard unavailable"));
        });
        expect(content()).not.toContain("Copied");
        expect(content()).not.toContain("Could not copy ID");
        expect(element("device-copy-relationship-id")).toBeDefined();
    },
);

it("ignores a late clipboard error after the same connection is closed and reopened", async () => {
    const request = deferred();
    jest.mocked(props.onCopy).mockReturnValueOnce(request.promise);
    await press("device-link-information");
    await press("device-copy-relationship-id");
    props.open = false;
    await render();
    props.open = true;
    await render();
    await act(async () => request.reject(new Error("Clipboard unavailable")));
    expect(content()).not.toContain("Could not copy ID");
    expect(element("device-unlink")).toBeDefined();
});

it("keeps editing settings when an earlier overview clipboard request fails", async () => {
    const request = deferred();
    jest.mocked(props.onCopy).mockReturnValueOnce(request.promise);
    await press("device-link-information");
    await press("device-copy-relationship-id");
    await press("device-sync-settings");
    await renameDraft("Changed laptop");
    await act(async () => request.reject(new Error("Clipboard unavailable")));
    expect(element("device-save-settings")).toBeDefined();
    expect(content()).not.toContain("Could not copy ID");
    expect(props.onDismissibleChange).toHaveBeenLastCalledWith(false);
    await press("device-cancel-settings");
    await press("device-discard-settings");
    expect(element("device-sync-settings")).toBeDefined();
});

it("keeps the discard prompt guarded after its save fails", async () => {
    jest.mocked(props.onSave).mockRejectedValueOnce(
        new Error("Could not persist changes"),
    );
    await press("device-sync-settings");
    await renameDraft("Changed laptop");
    await press("device-cancel-settings");
    const saveButton = renderer!.root
        .findAllByType("Button" as never)
        .find((node) => node.props.children === "Save changes")!;
    await act(async () => saveButton.props.onPress());
    expect(props.onDismissibleChange).toHaveBeenLastCalledWith(false);
    await press("device-dismiss-error");
    expect(content()).toContain("You have unsaved changes.");
    await press("device-discard-settings");
    expect(props.onDismissibleChange).toHaveBeenLastCalledWith(true);
    expect(element("device-sync-settings")).toBeDefined();
});

it.each(["node", "edge"] as const)(
    "shows an unavailable %s overview when refresh removes the selected record",
    async (kind) => {
        props.selection =
            kind === "node"
                ? { kind: "node", id: "account:peer" }
                : { kind: "edge", id: "server:direct" };
        await render();
        props.map = {
            ...props.map,
            nodes:
                kind === "node"
                    ? props.map.nodes.filter(
                          (node) => node.id !== props.selection.id,
                      )
                    : props.map.nodes,
            relationships:
                kind === "edge"
                    ? props.map.relationships.filter(
                          (edge) => edge.id !== props.selection.id,
                      )
                    : props.map.relationships,
        };
        await render();
        expect(content()).toContain("is no longer available");
        expect(content()).not.toContain("Current session");
        expect(element("device-unlink")).toBeUndefined();
        expect(element("device-remove-account")).toBeUndefined();
        await press("device-close-details");
        expect(props.onClose).toHaveBeenCalledTimes(1);
        expect(props.onChoose).not.toHaveBeenCalled();
    },
);
