import { ONLINE_SERVICES_SELECTION_ID } from "@cryptex-industries/vault-core/consts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
    beforeEach,
    afterEach,
    describe,
    it,
    expect,
    jest,
} from "@jest/globals";
import {
    DevicesPanel,
    type DevicesPanelProps,
} from "@/components/vault-dashboard/device-tab";
import {
    buildDeviceRelationshipMap,
    type DeviceTopology,
} from "@/components/vault-dashboard/account-dialog/device-topology";
import type { DeviceControls } from "@/components/vault-dashboard/device-controls";
import type { LinkedDevice } from "@cryptex-industries/vault-core/vault-utils/vault";
import {
    WebRTCStatus,
    SignalingStatus,
} from "@cryptex-industries/vault-core/synchronization-utils";
(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const peer: LinkedDevice = {
    ID: "custom",
    Name: "Home desktop",
    SyncID: "custom-sync",
    SignalingServerID: "signal",
    STUNServerIDs: ["stun"],
    TURNServerIDs: ["turn"],
    LinkedAtTimestamp: 0,
    LastSync: undefined,
    AutoConnect: false,
    AutoSync: false,
    SyncTimeout: true,
    SyncTimeoutPeriod: 30,
    RemoteSyncPublicKey: "",
    RemoteSyncKemPublicKey: "",
};
const controls: DeviceControls = {
    statuses: {
        custom: {
            webRTCStatus: WebRTCStatus.Connected,
            signalingServerStatus: SignalingStatus.Connected,
            lastSync: null,
        },
    },
    signalingConfig: { signalingServers: [], stunServers: [], turnServers: [] },
    unlinkingId: null,
    onConnect: jest.fn(),
    onSync: jest.fn(),
    onEdit: jest.fn(),
    onUnlink: jest.fn(async () => {}),
    onCreateInvitation: jest.fn(),
    onReceiveInvitation: jest.fn(),
};
function button(name: string) {
    return [...document.querySelectorAll("button")].find(
        (b) =>
            b.textContent?.trim() === name ||
            b.getAttribute("aria-label") === name,
    )!;
}
describe("device management UI", () => {
    let container: HTMLDivElement, root: Root;
    beforeEach(() => {
        jest.clearAllMocks();
        container = document.createElement("div");
        document.body.append(container);
        root = createRoot(container);
    });
    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        jest.useRealTimers();
    });
    function render(
        topology?: DeviceTopology,
        isRoot = false,
        local = peer,
        refresh?: DevicesPanelProps["refresh"],
        removalToken?: number,
    ) {
        const map = buildDeviceRelationshipMap(topology, [local], "this", {
            topologyVerified: !!topology,
            currentRoot: isRoot,
        });
        act(() =>
            root.render(
                <DevicesPanel
                    refresh={refresh}
                    map={map}
                    controls={controls}
                    selectedLocalId="custom"
                    selectionToken={removalToken}
                    requestedSection={removalToken ? "remove" : undefined}
                    isRoot={isRoot}
                    canPromote={isRoot}
                    busy={false}
                    onRemove={async () => {}}
                    onToggleRoot={async () => {}}
                    expanded={false}
                    onExpand={() => {}}
                />,
            ),
        );
    }
    it("keeps local sync and editing available without root and does not flag custom links", () => {
        render();
        expect(button("Sync now")).toBeDefined();
        expect(button("Edit name and sync settings")).toBeDefined();
        expect(button("Unlink from this vault")).toBeDefined();
        expect(button("Allow root access")).toBeUndefined();
        expect(container.textContent).not.toContain(
            "relationship was not found",
        );
        expect(container.textContent).toContain("Never synced");
        act(() => button("Sync now").click());
        expect(controls.onSync).toHaveBeenCalledWith(peer);
        act(() => button("Edit name and sync settings").click());
        expect(controls.onEdit).toHaveBeenCalledWith(peer);
    });
    it("explains root access for a registered peer and preserves last-seen independently", () => {
        const seen = new Date(Date.now() - 5 * 60000);
        render(
            {
                devices: [
                    {
                        id: "this",
                        current: true,
                        root: true,
                        createdAt: new Date(0),
                        lastSeen: seen,
                    },
                    {
                        id: "peer-id",
                        current: false,
                        root: false,
                        createdAt: new Date(0),
                        lastSeen: seen,
                    },
                ],
                relationships: [
                    {
                        syncId: peer.SyncID,
                        fromDeviceId: "this",
                        toDeviceId: "peer-id",
                        createdAt: new Date(0),
                    },
                ],
            },
            true,
        );
        expect(container.textContent).toContain("Last seen by Online Services");
        expect(container.textContent).toContain("5m ago");
        expect(container.textContent).toContain("Never synced");
        expect(container.textContent).toContain(
            "delete the Online Services account",
        );
        expect(button("Allow root access")).toBeDefined();
    });
    it("opens on the map and explores connections even when the map is already visible", () => {
        render();
        const svg = container.querySelector("svg.device-network")!;
        expect(svg).not.toBeNull();
        const before = svg.getAttribute("viewBox");
        act(() => button("Explore connections").click());
        expect(svg.getAttribute("viewBox")).not.toBe(before);
        expect(button("Focus selection").getAttribute("aria-pressed")).toBe(
            "true",
        );
        act(() =>
            container
                .querySelector<HTMLButtonElement>(
                    '[aria-label="View device list"]',
                )!
                .click(),
        );
        expect(container.querySelector("svg.device-network")).toBeNull();
        act(() => button("Explore connections").click());
        expect(container.querySelector("svg.device-network")).not.toBeNull();
        expect(button("Focus selection").getAttribute("aria-pressed")).toBe(
            "true",
        );
        act(() =>
            container
                .querySelector('svg [aria-label="This device"]')!
                .dispatchEvent(new MouseEvent("click", { bubbles: true })),
        );
        act(() => button("View device list").click());
        act(() => button("View connection map").click());
        expect(button("Focus selection").getAttribute("aria-pressed")).toBe(
            "false",
        );
        expect(
            container
                .querySelector("svg.device-network")!
                .getAttribute("viewBox"),
        ).toBe(before);
    });
    it("hides cleanup for unverified Online Services links while retaining custom unlinking", () => {
        render(undefined, false, {
            // This fixture is a plain object, not a LinkedDevice class instance.
            // eslint-disable-next-line @typescript-eslint/no-misused-spread
            ...peer,
            SignalingServerID: ONLINE_SERVICES_SELECTION_ID,
        });
        expect(button("Unlink devices").disabled).toBe(true);
        expect(button("Remove saved link from this vault")).toBeUndefined();
        render();
        expect(button("Unlink from this vault").disabled).toBe(false);
    });
    function officialPeer() {
        // This fixture is a plain object, not a LinkedDevice class instance.
        // eslint-disable-next-line @typescript-eslint/no-misused-spread
        return { ...peer, SignalingServerID: ONLINE_SERVICES_SELECTION_ID };
    }
    function accountTopology(linked: boolean): DeviceTopology {
        return {
            devices: [
                {
                    id: "this",
                    current: true,
                    root: true,
                    createdAt: new Date(0),
                    lastSeen: null,
                },
                {
                    id: "peer-id",
                    current: false,
                    root: false,
                    createdAt: new Date(0),
                    lastSeen: null,
                },
            ],
            relationships: linked
                ? [
                      {
                          syncId: peer.SyncID,
                          fromDeviceId: "this",
                          toDeviceId: "peer-id",
                          createdAt: new Date(0),
                      },
                  ]
                : [],
        };
    }
    it("offers local cleanup only after a verified lookup confirms the link is missing", async () => {
        const local = officialPeer();
        render(accountTopology(false), true, local);
        expect(button("Unlink devices").disabled).toBe(true);
        expect(button("Remove saved link from this vault").disabled).toBe(
            false,
        );
        act(() => button("Remove saved link from this vault").click());
        expect(document.body.textContent).toContain(
            "saved device name, connection settings",
        );
        await act(async () => button("Remove saved link").click());
        expect(controls.onUnlink).toHaveBeenCalledWith(local, true);
    });
    it("groups server removal with unlinking and offers explicit cleanup after unlinking fails", async () => {
        const local = officialPeer();
        render(accountTopology(true), true, local);
        expect(button("Remove saved link from this vault")).toBeUndefined();
        const section = button("Unlink devices").closest("section");
        expect(section?.getAttribute("aria-label")).toBe("Remove device");
        expect(section?.contains(button("Remove from Online Services"))).toBe(
            true,
        );
        const onUnlink = controls.onUnlink as jest.MockedFunction<
            DeviceControls["onUnlink"]
        >;
        onUnlink.mockRejectedValueOnce(new Error("Offline"));
        act(() => button("Unlink devices").click());
        await act(async () =>
            document
                .querySelector<HTMLButtonElement>(
                    '[role="alertdialog"] button:last-child',
                )!
                .click(),
        );
        expect(document.querySelector('[role="alertdialog"]')).toBeNull();
        expect(button("Remove saved link from this vault").disabled).toBe(
            false,
        );
        expect(container.textContent).toContain(
            "Online Services sync relationship may remain",
        );
        act(() => button("Remove saved link from this vault").click());
        await act(async () => button("Remove saved link").click());
        expect(onUnlink).toHaveBeenLastCalledWith(local, true);
    });
    it("scrolls to and briefly highlights removal only for an explicit shortcut request", () => {
        jest.useFakeTimers();
        const scroll = jest.fn();
        Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
            configurable: true,
            value: scroll,
        });
        render();
        expect(scroll).not.toHaveBeenCalled();
        render(undefined, false, peer, undefined, 1);
        const section = container.querySelector<HTMLElement>(
            'section[aria-label="Remove device"]',
        )!;
        expect(scroll).toHaveBeenCalledTimes(1);
        expect(document.activeElement).toBe(section);
        expect(section.className).toContain("ring-2");
        expect(document.querySelector('[role="alertdialog"]')).toBeNull();
        expect(controls.onUnlink).not.toHaveBeenCalled();
        act(() => jest.advanceTimersByTime(2400));
        expect(section.className).not.toContain("ring-2");
        render(undefined, false, peer, undefined, 2);
        expect(scroll).toHaveBeenCalledTimes(2);
        delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
    });
    it("throttles refresh clicks for ten seconds and remains disabled while loading", () => {
        jest.useFakeTimers();
        const onRefresh = jest.fn();
        const refresh = {
            available: true,
            loading: false,
            message: "",
            onRefresh,
        };
        render(undefined, false, peer, refresh);
        act(() => {
            button("Refresh devices").click();
            button("Refresh devices").click();
        });
        expect(onRefresh).toHaveBeenCalledTimes(1);
        expect(button("Refresh devices").disabled).toBe(true);
        act(() => jest.advanceTimersByTime(9000));
        expect(button("Refresh devices").disabled).toBe(true);
        expect(
            container.querySelector('[aria-label="Refresh available in 1s"]'),
        ).not.toBeNull();
        render(undefined, false, peer, { ...refresh, loading: true });
        act(() => jest.advanceTimersByTime(1000));
        expect(button("Refresh devices").disabled).toBe(true);
        render(undefined, false, peer, refresh);
        expect(button("Refresh devices").disabled).toBe(false);
        act(() => button("Refresh devices").click());
        expect(onRefresh).toHaveBeenCalledTimes(2);
    });
});
