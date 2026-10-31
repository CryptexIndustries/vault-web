import "../helpers/jsdom-encoding";
import { act, Fragment, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    jest,
} from "@jest/globals";
import { VaultSignalingConfigDialog } from "@/components/vault-dashboard/link";
import {
    type LinkedDevice,
    SignalingServerConfiguration,
    STUNServerConfiguration,
    TURNServerConfiguration,
} from "@cryptex-industries/vault-core/vault-utils/vault";

// Virtuoso renders nothing without layout, so the list renders every row.
jest.mock("react-virtuoso", () => ({
    Virtuoso: <T,>({
        data,
        itemContent,
        computeItemKey,
    }: {
        data: T[];
        itemContent: (index: number, item: T) => ReactNode;
        computeItemKey: (index: number, item: T) => string;
    }) =>
        data.map((item, index) => (
            <Fragment key={computeItemKey(index, item)}>
                {itemContent(index, item)}
            </Fragment>
        )),
}));
(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const device = (
    name: string,
    servers: Pick<
        LinkedDevice,
        "SignalingServerID" | "STUNServerIDs" | "TURNServerIDs"
    >,
) =>
    ({
        ID: name,
        Name: name,
        SyncID: `${name}-sync`,
        AutoConnect: false,
        AutoSync: false,
        LinkedAtTimestamp: 0,
        SyncTimeout: false,
        SyncTimeoutPeriod: 30,
        RemoteSyncPublicKey: "",
        RemoteSyncKemPublicKey: "",
        LastSync: undefined,
        ...servers,
    }) satisfies LinkedDevice;

const withID = <T extends { ID: string }>(server: T, id: string) =>
    Object.assign(server, { ID: id });
const stun = withID(
    new STUNServerConfiguration("Home STUN", "stun.home"),
    "stun",
);
const turn = withID(
    new TURNServerConfiguration("Home TURN", "turn.home", "user", "pass"),
    "turn",
);
const signaling = withID(
    new SignalingServerConfiguration(
        "Home signaling",
        "signal.home",
        "app",
        "key",
        "secret",
        "6001",
        "0",
    ),
    "signaling",
);
const devices = [
    device("Laptop", {
        SignalingServerID: "signaling",
        STUNServerIDs: ["stun"],
        TURNServerIDs: [],
    }),
    device("Phone", {
        SignalingServerID: "signaling",
        STUNServerIDs: [],
        TURNServerIDs: [],
    }),
];

describe("vault signaling dialog delete confirm", () => {
    let container: HTMLDivElement, root: Root;
    beforeEach(() => {
        container = document.createElement("div");
        document.body.append(container);
        root = createRoot(container);
        act(() =>
            root.render(
                <VaultSignalingConfigDialog
                    open
                    onOpenChange={() => {}}
                    stunServers={[stun]}
                    turnServers={[turn]}
                    signalingServers={[signaling]}
                    devices={devices}
                    onSave={() => {}}
                />,
            ),
        );
    });
    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    const button = (name: string) => {
        const found = [...document.querySelectorAll("button")].find(
            (item) =>
                item.getAttribute("aria-label") === name ||
                item.textContent === name,
        );
        if (!found) throw new Error(`No ${name} button`);
        return found;
    };
    const openTab = (name: string) =>
        act(() => {
            // Radix tabs switch on mouse down.
            button(name).dispatchEvent(
                new MouseEvent("mousedown", { bubbles: true, button: 0 }),
            );
        });
    const confirmDelete = (name: string) => {
        act(() => button(`Delete ${name}`).click());
        const dialog = document.querySelector('[role="dialog"]');
        expect(dialog?.textContent).toContain(`Remove ${name} from the vault.`);
        return dialog?.textContent ?? "";
    };

    it("names the one device that uses a STUN server", () => {
        expect(confirmDelete("Home STUN")).toContain(
            "Used by Laptop. It may stop syncing until you choose another server for it.",
        );
    });

    it("names every device that uses a signaling server", () => {
        openTab("Signaling");
        expect(confirmDelete("Home signaling")).toContain(
            "Used by Laptop and Phone. They may stop syncing until you choose another server for them.",
        );
    });

    it("warns about nothing for a server no device uses", () => {
        openTab("TURN");
        expect(confirmDelete("Home TURN")).not.toContain("Used by");
    });
});
