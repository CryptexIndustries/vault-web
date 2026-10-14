/**
 * @jest-environment jsdom
 */
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    jest,
} from "@jest/globals";
import { webcrypto } from "node:crypto";
import { TextDecoder, TextEncoder } from "node:util";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ShareBackend } from "@/components/share/share-backend";

Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    writable: true,
});
Object.defineProperty(globalThis, "TextEncoder", {
    value: TextEncoder,
    writable: true,
});
Object.defineProperty(globalThis, "TextDecoder", {
    value: TextDecoder,
    writable: true,
});

type Created = { link: string; record: unknown };
const createShareLinkMock =
    jest.fn<
        (deps: unknown, input: { credentialId: string }) => Promise<Created>
    >();
const refreshShareStatusesMock = jest.fn<() => Promise<void>>();

jest.mock("@cryptex-industries/vault-core/vault-utils/share-service", () => {
    const actual = jest.requireActual<
        typeof import("@cryptex-industries/vault-core/vault-utils/share-service")
    >("@cryptex-industries/vault-core/vault-utils/share-service");
    return {
        ...actual,
        createShareLink: (deps: unknown, input: { credentialId: string }) =>
            createShareLinkMock(deps, input),
        refreshShareStatuses: () => refreshShareStatusesMock(),
    };
});
jest.mock("@/utils/clipboard", () => ({
    copySecretToClipboard: jest.fn(async () => true),
}));
jest.mock("sonner", () => ({
    toast: { error: jest.fn(), success: jest.fn() },
}));

import {
    ShareDialog,
    type ShareDialogTarget,
} from "@/components/share/share-dialog";
import { SharedLinksView } from "@/components/share/shared-links-view";

function backendFor(maxTtl = 604800): ShareBackend {
    const fetchImpl = (async () => ({
        ok: true,
        status: 200,
        json: async () => ({
            version: 1,
            auth: "token",
            maxBytes: 65536,
            maxTtl,
        }),
    })) as unknown as typeof fetch;
    return {
        deps: {
            store: {
                getShareLinks: async () => [],
                updateShareLinks: async () => undefined,
                getShareSettings: async () => ({
                    ServerOrigin: "",
                    CreationToken: "operator-token",
                }),
            },
            defaultOrigin: "https://vault.example.com",
            fetch: fetchImpl,
        },
        hasOnlineServicesSharing: undefined,
        allowCustomServer: false,
        saveSettings: async () => undefined,
    };
}

const credential = (id: string, name: string): ShareDialogTarget => ({
    kind: "credential",
    credential: {
        ID: id,
        Name: name,
        Username: "user",
        Password: "pass",
        URL: "",
        AdditionalURLs: [],
        Notes: "",
        TOTP: undefined,
        CustomFields: [],
        Passkey: undefined,
    },
});

const flush = async () => {
    for (let i = 0; i < 5; i++) {
        await act(async () => {
            await Promise.resolve();
        });
    }
};

const button = (name: string) =>
    [...document.body.querySelectorAll("button")].find(
        (element) => element.textContent?.trim() === name,
    );

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    (
        globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    createShareLinkMock.mockReset();
    refreshShareStatusesMock.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    document.body.innerHTML = "";
});

describe("ShareDialog", () => {
    it("drops a link that finishes after the dialog moved on", async () => {
        let resolveFirst!: (value: Created) => void;
        createShareLinkMock.mockImplementationOnce(
            () => new Promise((resolve) => (resolveFirst = resolve)),
        );
        const backend = backendFor();
        const render = (open: boolean, target: ShareDialogTarget) =>
            act(() =>
                root.render(
                    <ShareDialog
                        open={open}
                        onOpenChange={() => undefined}
                        target={target}
                        backend={backend}
                    />,
                ),
            );

        const first = credential("a", "Item A");
        render(true, first);
        await flush();
        await act(async () => button("Create link")!.click());
        expect(createShareLinkMock).toHaveBeenCalledTimes(1);

        // The user closes the dialog and shares another item instead.
        render(false, first);
        render(true, credential("b", "Item B"));
        await flush();

        await act(async () =>
            resolveFirst({
                link: "https://vault.example.com/s/aaaa#key-a",
                record: {},
            }),
        );
        await flush();

        expect(document.body.querySelector("#share-link")).toBeNull();
        expect(document.body.textContent).toContain("Name (Item B)");
        expect(button("Create link")?.disabled).toBe(false);
    });

    it("describes the link that was created, not later form changes", async () => {
        let resolveCreate!: (value: Created) => void;
        createShareLinkMock.mockImplementationOnce(
            () => new Promise((resolve) => (resolveCreate = resolve)),
        );
        act(() =>
            root.render(
                <ShareDialog
                    open
                    onOpenChange={() => undefined}
                    target={credential("a", "Item A")}
                    backend={backendFor()}
                />,
            ),
        );
        await flush();
        await act(async () => button("Create link")!.click());

        // The form is locked while the link is created.
        const toggle = document.body.querySelector<HTMLButtonElement>(
            "#share-passphrase-toggle",
        )!;
        expect(toggle.matches(":disabled")).toBe(true);
        await act(async () => toggle.click());
        expect(toggle.getAttribute("aria-checked")).toBe("false");

        await act(async () =>
            resolveCreate({
                link: "https://vault.example.com/s/aaaa#key-a",
                record: { Passphrase: false },
            }),
        );
        await flush();
        expect(
            document.body.querySelector<HTMLInputElement>("#share-link")?.value,
        ).toBe("https://vault.example.com/s/aaaa#key-a");
        expect(document.body.textContent).not.toContain("Send the passphrase");
    });

    it("offers only expiries the server keeps", async () => {
        act(() =>
            root.render(
                <ShareDialog
                    open
                    onOpenChange={() => undefined}
                    target={{ kind: "text" }}
                    backend={backendFor(1800)}
                />,
            ),
        );
        await flush();
        const trigger = document.body.querySelector("#share-expiry");
        expect(trigger?.textContent).toContain("30 minutes");
    });

    it("leaves the checking state when settings can't be read", async () => {
        const backend = backendFor();
        backend.deps.defaultOrigin = "";
        backend.deps.store.getShareSettings = async () => {
            throw new Error("vault locked");
        };
        act(() =>
            root.render(
                <ShareDialog
                    open
                    onOpenChange={() => undefined}
                    target={{ kind: "text" }}
                    backend={{ ...backend, allowCustomServer: true }}
                />,
            ),
        );
        await flush();
        expect(document.body.textContent).toContain(
            "Can't reach the share server",
        );
        expect(
            document.body
                .querySelector("#share-server-origin")
                ?.getAttribute("placeholder"),
        ).toBe("https://vault.example.com");
    });
});

describe("SharedLinksView", () => {
    it("re-reads records after every refresh", async () => {
        refreshShareStatusesMock.mockResolvedValue(undefined);
        const reload = jest.fn(async () => undefined);
        act(() =>
            root.render(
                <SharedLinksView
                    records={[]}
                    credentialNames={new Map()}
                    backend={{ ...backendFor(), reload }}
                    onShareSecret={() => undefined}
                    confirm={() => undefined}
                />,
            ),
        );
        await flush();
        expect(refreshShareStatusesMock).toHaveBeenCalledTimes(1);
        expect(reload).toHaveBeenCalledTimes(1);
    });
});
