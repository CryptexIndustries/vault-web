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
import { DeviceSidebar } from "@/components/vault-dashboard/device-sidebar";
import type { LinkedDevice } from "@cryptex-industries/vault-core/vault-utils/vault";
import type { SyncConnectionController } from "@cryptex-industries/vault-core/synchronization";
import {
    WebRTCStatus,
    SignalingStatus,
} from "@cryptex-industries/vault-core/synchronization-utils";
jest.mock("@/components/vault-dashboard/link", () => ({
    VaultSignalingConfigDialog: () => null,
}));
jest.mock("@/components/vault-dashboard/subscription-cta-popover", () => ({
    SubscriptionCtaPopover: () => null,
}));
jest.mock("@/components/vault-dashboard/backup-dialog", () => ({
    BackupSidebarEntry: () => null,
}));
jest.mock("@/utils/online-services-api-url", () => ({
    isCloudServicesEnabled: () => false,
}));
(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const peer = {
    ID: "home",
    Name: "Home desktop",
    SyncID: "home-sync",
    SignalingServerID: "custom",
    STUNServerIDs: ["custom"],
    TURNServerIDs: ["custom"],
    AutoConnect: false,
    AutoSync: false,
    LinkedAtTimestamp: 0,
    SyncTimeout: false,
    SyncTimeoutPeriod: 30,
    RemoteSyncPublicKey: "",
    RemoteSyncKemPublicKey: "",
    LastSync: undefined,
} satisfies LinkedDevice;
describe("device sidebar shortcuts", () => {
    let container: HTMLDivElement, root: Root;
    const sync = jest.fn(),
        connect = jest.fn(),
        details = jest.fn(),
        edit = jest.fn();
    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();
        container = document.createElement("div");
        document.body.append(container);
        root = createRoot(container);
    });
    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        jest.useRealTimers();
    });
    function render(connected: boolean) {
        act(() =>
            root.render(
                <DeviceSidebar
                    vaultName="Test vault"
                    devices={[peer]}
                    onEditDevice={edit}
                    onManageDevices={details}
                    onCreateInvitation={() => {}}
                    onReceiveInvitation={() => {}}
                    onOpenSecurityReport={() => {}}
                    onOpenBackup={() => {}}
                    activeView="credentials"
                    signalingConfig={{
                        stunServers: [],
                        turnServers: [],
                        signalingServers: [],
                    }}
                    onSaveSignalingConfig={() => {}}
                    syncConnectionController={
                        {
                            connectDevice: connect,
                            transmitSyncHello: sync,
                        } as unknown as SyncConnectionController
                    }
                    deviceConnectionStatuses={{
                        home: {
                            webRTCStatus: connected
                                ? WebRTCStatus.Connected
                                : WebRTCStatus.Disconnected,
                            signalingServerStatus: SignalingStatus.Connected,
                            lastSync: null,
                        },
                    }}
                />,
            ),
        );
    }
    function longPress() {
        const button = [...container.querySelectorAll("button")].find(
            (b) => b.textContent === "Home desktop",
        )!;
        const down = new Event("pointerdown", { bubbles: true });
        Object.assign(down, {
            clientX: 0,
            clientY: 0,
            pointerType: "touch",
            isPrimary: true,
        });
        act(() => button.dispatchEvent(down));
        act(() => jest.advanceTimersByTime(500));
        act(() =>
            button.dispatchEvent(new Event("pointerup", { bubbles: true })),
        );
    }
    it("opens the actual dropdown on long press and retains sync, details, edit and unlink", async () => {
        render(true);
        longPress();
        const items = [...document.querySelectorAll('[role="menuitem"]')];
        expect(items.map((i) => i.textContent)).toEqual(
            expect.arrayContaining([
                "Sync now",
                "View details",
                "Edit name and sync settings",
                "Remove device…",
            ]),
        );
        const item = items.find((i) => i.textContent === "Sync now")!;
        await act(async () =>
            item.dispatchEvent(new MouseEvent("click", { bubbles: true })),
        );
        expect(sync).toHaveBeenCalledWith("home");
        longPress();
        const editItem = [
            ...document.querySelectorAll('[role="menuitem"]'),
        ].find((i) => i.textContent === "Edit name and sync settings")!;
        await act(async () =>
            editItem.dispatchEvent(new MouseEvent("click", { bubbles: true })),
        );
        expect(edit).toHaveBeenCalledWith(
            expect.objectContaining({ ID: "home" }),
        );
    });
    it("routes the removal shortcut to the selected device's removal section", async () => {
        render(true);
        longPress();
        const item = [...document.querySelectorAll('[role="menuitem"]')].find(
            (i) => i.textContent === "Remove device…",
        )!;
        await act(async () =>
            item.dispatchEvent(new MouseEvent("click", { bubbles: true })),
        );
        expect(details).toHaveBeenCalledWith("home", "remove");
        expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    });
    it("preserves Connect for disconnected peers and opens shared details from the row", () => {
        render(false);
        const name = [...container.querySelectorAll("button")].find(
            (b) => b.textContent === "Home desktop",
        )!;
        act(() => name.click());
        expect(details).toHaveBeenCalledWith("home");
        longPress();
        expect(
            [...document.querySelectorAll('[role="menuitem"]')].map(
                (i) => i.textContent,
            ),
        ).toContain("Connect");
        expect(
            container.querySelector('[aria-label="Actions for Home desktop"]'),
        ).not.toBeNull();
    });
});
