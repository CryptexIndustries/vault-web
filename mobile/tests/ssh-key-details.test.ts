import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement, type ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { ItemType } from "@cryptex-industries/vault-core/proto";
import { VaultCredential } from "@cryptex-industries/vault-core/vault-utils/vault";
import { SSHKeyDetails } from "@/components/vault/ssh-key-details";
import { shareSSHKeyFile } from "@/utils/ssh-key-files";

// Key work runs later on the same thread through the real worker program.
const mockWorker = { hold: false, queue: [] as Array<() => void> };
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
    scheduleOnRuntime: (_runtime: unknown, work: () => void) => {
        if (mockWorker.hold) mockWorker.queue.push(work);
        else setTimeout(work, 0);
    },
    scheduleOnRN: (run: (...args: unknown[]) => void, ...args: unknown[]) =>
        run(...args),
}));
jest.mock("react-native", () => ({
    ActivityIndicator: "ActivityIndicator",
    View: "View",
}));
jest.mock("lucide-react-native", () => ({
    Copy: "Copy",
    Download: "Download",
    ExternalLink: "ExternalLink",
    Eye: "Eye",
    EyeOff: "EyeOff",
}));
jest.mock("@/components/unlocked/unlocked-ui", () => ({
    UnlockedButton: "Button",
    UnlockedDialogTitle: "DialogTitle",
    UnlockedInput: "Input",
    UnlockedLabel: "Label",
    UnlockedText: "Text",
}));
jest.mock("@/components/unlocked/unlocked-snackbar", () => ({
    useUnlockedSnackbar: () => jest.fn(),
}));
jest.mock("@/components/ui/dialog", () => ({
    Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
        open ? createElement("Dialog", {}, children) : null,
    DialogDescription: "DialogDescription",
    DialogHeader: "DialogHeader",
}));
jest.mock("@/components/icon-button", () => ({ IconButton: "IconButton" }));
jest.mock("@/components/inline-notice", () => ({ InlineNotice: "Notice" }));
jest.mock("@/lib/utils", () => ({
    cn: (...values: unknown[]) => values.filter(Boolean).join(" "),
}));
jest.mock("@/utils/clipboard", () => ({
    copySecretToClipboard: jest.fn(async () => true),
    copyTextToClipboard: jest.fn(async () => true),
}));
jest.mock("@/utils/ssh-key-files", () => ({
    shareSSHKeyFile: jest.fn(async () => "shared"),
}));
const mockSession = { current: true };
jest.mock("@/utils/vault-session", () => ({
    captureVaultSession: () => ({ generation: 1, lockEpoch: 0 }),
    isVaultSessionCurrent: () => mockSession.current,
}));

type WorkerGlobal = typeof globalThis & { runSSHKeyWorkerTask?: unknown };
const worker = globalThis as WorkerGlobal;
const fixture = (name: string) =>
    readFileSync(
        resolve(__dirname, "../../packages/vault-core/src/tests/fixtures/ssh", name),
        "utf8",
    );
const credential = Object.assign(new VaultCredential(), {
    ID: "ssh",
    Type: ItemType.SSHKey,
    Name: "Work laptop",
    SSHKey: {
        PrivateKey: fixture("ed25519.key"),
        PublicKey: fixture("ed25519.key.pub").split(" ").slice(0, 2).join(" "),
        Comment: "me@laptop",
    },
});
let renderer: ReactTestRenderer | undefined;

beforeEach(() => {
    (
        globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    mockWorker.hold = false;
    mockWorker.queue = [];
    mockSession.current = true;
});

afterEach(async () => {
    await act(async () => renderer?.unmount());
    renderer = undefined;
});

async function settle(ms = 20) {
    await act(async () => {
        await new Promise((done) => setTimeout(done, ms));
    });
}

async function release() {
    mockWorker.hold = false;
    const queued = mockWorker.queue.splice(0);
    await act(async () => {
        for (const work of queued) work();
    });
    await settle();
}

async function render() {
    await act(async () => {
        renderer = create(createElement(SSHKeyDetails, { credential }));
    });
}

const texts = () =>
    renderer!.root
        .findAllByType("Text" as never)
        .map((node) => [node.props.children].flat().join(""));
const labelled = (label: string) =>
    renderer!.root.findAll(
        (node) =>
            typeof node.type === "string" &&
            (node.props.accessibilityLabel ?? node.props.label) === label,
    )[0];
const button = (text: string) =>
    renderer!.root
        .findAllByType("Button" as never)
        .find((node) => node.props.children === text);

describe("SSH key details", () => {
    it("keeps the private key row while it loads, and offers a retry when loading fails", async () => {
        mockWorker.hold = true;
        await render();
        expect(texts()).toEqual(expect.arrayContaining(["Private key", "Loading…"]));
        expect(labelled("Copy Private key")).toBeUndefined();
        await release();
        expect(texts()).not.toContain("Loading…");
        expect(labelled("Copy Private key")).toBeDefined();
        await act(async () => labelled("Reveal Private key")!.props.onPress());
        expect(
            texts().some((text) =>
                text.startsWith("-----BEGIN OPENSSH PRIVATE KEY-----"),
            ),
        ).toBe(true);

        await act(async () => renderer!.unmount());
        const workerTask = worker.runSSHKeyWorkerTask;
        worker.runSSHKeyWorkerTask = () => {
            throw new Error("broken");
        };
        try {
            await render();
            await settle();
            expect(texts()).toContain("The private key could not be loaded.");
        } finally {
            worker.runSSHKeyWorkerTask = workerTask;
        }
        await act(async () => button("Try again")!.props.onPress());
        await settle();
        expect(labelled("Copy Private key")).toBeDefined();
    });

    it("shows the encryption step, and Cancel drops the file instead of sharing it", async () => {
        await render();
        await settle();
        await act(async () => labelled("Save private key")!.props.onPress());
        for (const label of ["File passphrase", "Confirm file passphrase"]) {
            await act(async () =>
                labelled(label)!.props.onChangeText("file passphrase"),
            );
        }
        mockWorker.hold = true;
        await act(async () => button("Save encrypted file")!.props.onPress());
        expect(button("Save encrypted file")!.props.loading).toBe(true);
        expect(labelled("File passphrase")!.props.editable).toBe(false);
        await act(async () => button("Cancel")!.props.onPress());
        expect(button("Save encrypted file")).toBeUndefined();
        await release();
        expect(shareSSHKeyFile).not.toHaveBeenCalled();

        await act(async () => labelled("Save private key")!.props.onPress());
        await act(async () => button("Save unencrypted file")!.props.onPress());
        await settle();
        expect(shareSSHKeyFile).toHaveBeenCalledWith(
            "Work_laptop",
            expect.stringContaining("-----BEGIN OPENSSH PRIVATE KEY-----"),
            expect.objectContaining({ mimeType: "application/octet-stream" }),
        );
    });

    it("drops a private key export when the vault starts locking, and passes the session check on", async () => {
        await render();
        await settle();
        await act(async () => labelled("Save private key")!.props.onPress());
        mockWorker.hold = true;
        await act(async () => button("Save unencrypted file")!.props.onPress());
        mockSession.current = false;
        await release();
        expect(shareSSHKeyFile).not.toHaveBeenCalled();

        mockSession.current = true;
        await act(async () => labelled("Save private key")!.props.onPress());
        await act(async () => button("Save unencrypted file")!.props.onPress());
        await settle();
        const [, , options] = jest.mocked(shareSSHKeyFile).mock.calls[0]!;
        expect(options.isCurrent?.()).toBe(true);
        mockSession.current = false;
        expect(options.isCurrent?.()).toBe(false);
    });
});
