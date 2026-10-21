/**
 * @jest-environment jsdom
 */
import "../helpers/jsdom-encoding";
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    jest,
} from "@jest/globals";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { setNativeValue, waitFor } from "../helpers/dom";
import { sshFixture } from "../helpers/ssh-fixtures";
import { ItemType } from "@cryptex-industries/vault-core/proto";
import {
    describeSSHKey,
    SSH_KEY_TASK_INTERNAL_ERROR,
} from "@cryptex-industries/vault-core/vault-utils/ssh-key-info";
import {
    runSSHKeyTask,
    type SSHKeyTask,
    type SSHKeyTaskResult,
} from "@cryptex-industries/vault-core/vault-utils/ssh-key-task";
import {
    VaultCredential,
    type CredentialFormSchemaType,
} from "@cryptex-industries/vault-core/vault-utils/vault";

type RunOptions = { signal?: AbortSignal };
const mockRunTask =
    jest.fn<
        (task: SSHKeyTask, options?: RunOptions) => Promise<SSHKeyTaskResult>
    >();

jest.mock("@/utils/ssh-key", () => ({
    ...jest.requireActual<typeof import("@/utils/ssh-key")>("@/utils/ssh-key"),
    runSSHKeyTaskInWorker: (task: SSHKeyTask, options?: RunOptions) =>
        mockRunTask(task, options),
}));

jest.mock("sonner", () => ({
    toast: { error: jest.fn(), info: jest.fn(), success: jest.fn() },
}));

import { toast } from "sonner";
import { CredentialDetail } from "@/components/vault-dashboard/credential-detail";
import { credentialMatchesSearch } from "@/components/vault-dashboard/credential-search";
import { EditDrawer } from "@/components/vault-dashboard/edit-drawer";

(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const ENCRYPTED_KEY = sshFixture("ed25519-aes256-ctr.key");
const ENCRYPTED_PUB = sshFixture("ed25519-aes256-ctr.key.pub");
const PLAIN_KEY = sshFixture("ed25519.key");
const PLAIN_PUB = sshFixture("ed25519.key.pub");
const encryptedKeyFile = {
    name: "ed25519-aes256-ctr.key",
    text: ENCRYPTED_KEY,
};
const encryptedPubFile = {
    name: "ed25519-aes256-ctr.key.pub",
    text: ENCRYPTED_PUB,
};
const plainKeyFile = { name: "ed25519.key", text: PLAIN_KEY };
const plainPubFile = { name: "ed25519.key.pub", text: PLAIN_PUB };
const PASSPHRASE = "correct horse";

const internalError: SSHKeyTaskResult = {
    ok: false,
    code: "internal",
    message: SSH_KEY_TASK_INTERNAL_ERROR,
};

function importedKey() {
    const result = runSSHKeyTask({
        kind: "import",
        text: ENCRYPTED_KEY,
        passphrase: PASSPHRASE,
    });
    if (!result.ok || result.kind !== "import") throw new Error("fixture");
    return result.data;
}

const sshCredential = () =>
    Object.assign(new VaultCredential(), {
        ID: "ssh",
        Type: ItemType.SSHKey,
        Name: "Server key",
        SSHKey: importedKey(),
        DateCreatedTimestamp: 1_700_000_000_000,
    });

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

const byId = <T extends HTMLElement>(id: string) =>
    document.getElementById(id) as T | null;

const buttonByText = (text: string) =>
    Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
        (button) => button.textContent?.trim() === text,
    );

const buttonByLabel = (label: string) =>
    document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);

const textOf = () => document.body.textContent ?? "";

const alertText = () =>
    Array.from(document.querySelectorAll('[role="alert"]'))
        .map((element) => element.textContent)
        .join(" ");

/** Records whether a busy line shows up at any point from now on. */
function watchBusy() {
    let seen = false;
    const observer = new MutationObserver(() => {
        if (document.querySelector('[role="status"]')) seen = true;
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
        observer.disconnect();
        return seen;
    };
}

const fingerprintText = () =>
    document.querySelector('[data-testid="ssh-key-fingerprint"]')?.textContent;

type PickedFile = { name: string; text: string };

/** jsdom 20 has no Blob.text(), so hand the picker a plain file-like. */
async function pick(testId: string, file: PickedFile) {
    const input = document.querySelector<HTMLInputElement>(
        `[data-testid="${testId}"]`,
    )!;
    Object.defineProperty(input, "files", {
        configurable: true,
        value: [
            {
                name: file.name,
                size: file.text.length,
                text: async () => file.text,
            },
        ],
    });
    await act(async () => {
        input.dispatchEvent(new Event("change", { bubbles: true }));
    });
}

const chooseKeyFile = (file: PickedFile) => pick("ssh-key-file-input", file);
const addPubFile = (file: PickedFile) => pick("ssh-pub-file-input", file);

/** Lets any delayed check start and finish. */
const settle = () =>
    act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 700));
    });

describe("SSH key items", () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        mockRunTask.mockReset();
        mockRunTask.mockImplementation(async (task) => runSSHKeyTask(task));
        jest.mocked(toast.error).mockClear();
        jest.mocked(toast.info).mockClear();
        container = document.createElement("div");
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    const renderDrawer = async (
        credential: VaultCredential | null,
        onSave = jest.fn(async (_form: CredentialFormSchemaType) => true),
    ) => {
        await act(async () => {
            root.render(
                <EditDrawer
                    credential={credential}
                    isOpen={true}
                    onClose={jest.fn()}
                    onSave={onSave}
                    newItemType={ItemType.SSHKey}
                    directories={[]}
                    onCreateDirectory={jest.fn((_name: string) => undefined)}
                />,
            );
        });
        return onSave;
    };

    const openImport = async () => {
        await renderDrawer(null);
        const importRadio = Array.from(
            document.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
        )[1]!;
        await act(async () => importRadio.click());
    };

    const pasteKey = async (text: string) => {
        await act(async () => {
            setNativeValue(byId<HTMLTextAreaElement>("ssh-private-key")!, text);
        });
    };

    /** Types the passphrase once its prompt shows; returns the field. */
    const enterPassphrase = async () => {
        const passphrase = await waitFor(() =>
            byId<HTMLInputElement>("ssh-import-passphrase"),
        );
        await act(async () => setNativeValue(passphrase, PASSPHRASE));
        return passphrase;
    };

    it("clears the busy state and shows the error when a check fails", async () => {
        mockRunTask.mockResolvedValue(internalError);
        await openImport();
        await pasteKey("some key");
        expect(buttonByText("Create SSH key")!.disabled).toBe(true);

        await waitFor(() => textOf().includes(SSH_KEY_TASK_INTERNAL_ERROR));
        expect(textOf()).not.toContain("Checking key...");
        expect(buttonByText("Create SSH key")!.disabled).toBe(false);
    });

    it("disables Create while checking and ignores an obsolete result", async () => {
        const first = deferred<SSHKeyTaskResult>();
        const second = deferred<SSHKeyTaskResult>();
        mockRunTask
            .mockReturnValueOnce(first.promise)
            .mockReturnValueOnce(second.promise);
        await openImport();

        await pasteKey("first key");
        await waitFor(() => mockRunTask.mock.calls.length === 1);
        expect(textOf()).toContain("Checking key...");
        expect(buttonByText("Create SSH key")!.disabled).toBe(true);

        await pasteKey("second key");
        await waitFor(() => mockRunTask.mock.calls.length === 2);
        expect(mockRunTask.mock.calls[0]![1]?.signal?.aborted).toBe(true);
        expect(mockRunTask.mock.calls[1]![1]?.signal?.aborted).toBe(false);

        const key = importedKey();
        await act(async () => {
            second.resolve({ ok: true, kind: "import", data: key });
        });
        await act(async () => {
            first.resolve({
                ok: false,
                code: "invalid",
                message: "This doesn't look like an SSH private key.",
            });
        });

        await waitFor(() => fingerprintText());
        expect(fingerprintText()).toBe(describeSSHKey(key)?.fingerprint);
        expect(textOf()).not.toContain("doesn't look like");
        expect(buttonByText("Create SSH key")!.disabled).toBe(false);
    });

    it("keeps an unlocked key unlocked when its .pub file changes", async () => {
        await openImport();
        await pasteKey(ENCRYPTED_KEY);

        await enterPassphrase();
        await act(async () => buttonByText("Unlock")!.click());
        await waitFor(() => fingerprintText());
        expect(byId("ssh-import-passphrase")).toBeNull();

        mockRunTask.mockClear();
        await addPubFile(encryptedPubFile);
        await waitFor(() => mockRunTask.mock.calls.length === 1);
        expect(mockRunTask.mock.calls[0]![0]).toMatchObject({
            kind: "import",
            text: ENCRYPTED_KEY,
            passphrase: PASSPHRASE,
            publicKey: ENCRYPTED_PUB,
        });
        await waitFor(() => fingerprintText());
        expect(byId("ssh-import-passphrase")).toBeNull();
        expect(textOf()).toContain(
            "Public key file: ed25519-aes256-ctr.key.pub",
        );

        await act(async () => buttonByLabel("Remove public key file")!.click());
        await waitFor(() => mockRunTask.mock.calls.length === 2);
        expect(mockRunTask.mock.calls[1]![0]).toMatchObject({
            passphrase: PASSPHRASE,
            publicKey: undefined,
        });
        await waitFor(() => fingerprintText());
        expect(byId("ssh-import-passphrase")).toBeNull();
    });

    it("unlocks without the .pub when Unlock is clicked right after removing it", async () => {
        await openImport();
        await pasteKey(ENCRYPTED_KEY);
        await addPubFile(encryptedPubFile);
        await enterPassphrase();

        mockRunTask.mockClear();
        await act(async () => buttonByLabel("Remove public key file")!.click());
        // Click inside the check's delay, before it has started.
        expect(mockRunTask).not.toHaveBeenCalled();
        await act(async () => buttonByText("Unlock")!.click());

        await waitFor(() => fingerprintText());
        // Wait past the delay: the skipped check must not run afterwards.
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 800));
        });
        expect(mockRunTask.mock.calls.map(([task]) => task)).toEqual([
            expect.objectContaining({
                passphrase: PASSPHRASE,
                publicKey: undefined,
            }),
        ]);
        expect(byId("ssh-import-passphrase")).toBeNull();
        expect(fingerprintText()).toBeTruthy();
    });

    it("keeps the passphrase when the .pub changes during an unlock", async () => {
        const unlock = deferred<SSHKeyTaskResult>();
        mockRunTask.mockImplementation(async (task) =>
            task.kind === "import" && task.passphrase && !task.publicKey
                ? unlock.promise
                : runSSHKeyTask(task),
        );
        await openImport();
        await pasteKey(ENCRYPTED_KEY);
        await enterPassphrase();
        await act(async () => buttonByText("Unlock")!.click());

        await addPubFile(encryptedPubFile);
        await waitFor(() =>
            mockRunTask.mock.calls.some(([task]) =>
                task.kind === "import" ? task.publicKey : false,
            ),
        );
        const last = mockRunTask.mock.calls.at(-1)!;
        expect(last[0]).toMatchObject({
            passphrase: PASSPHRASE,
            publicKey: ENCRYPTED_PUB,
        });
        await waitFor(() => fingerprintText());
        expect(byId("ssh-import-passphrase")).toBeNull();
    });

    it("starts one unlock at a time", async () => {
        const unlock = deferred<SSHKeyTaskResult>();
        mockRunTask.mockImplementation(async (task) =>
            task.kind === "import" && task.passphrase
                ? unlock.promise
                : runSSHKeyTask(task),
        );
        await openImport();
        await pasteKey(ENCRYPTED_KEY);
        const passphrase = await enterPassphrase();

        await act(async () => buttonByText("Unlock")!.click());
        await act(async () => {
            passphrase.dispatchEvent(
                new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
            );
        });
        expect(
            mockRunTask.mock.calls.filter(
                ([task]) => task.kind === "import" && task.passphrase,
            ),
        ).toHaveLength(1);
        expect(textOf()).toContain("Unlocking...");
        expect(passphrase.disabled).toBe(true);
        expect(buttonByText("Create SSH key")!.disabled).toBe(true);

        await act(async () => {
            unlock.resolve({ ok: true, kind: "import", data: importedKey() });
        });
        await waitFor(() => fingerprintText());
    });

    it("is not left checking when the same files are picked again", async () => {
        await openImport();
        await chooseKeyFile(plainKeyFile);
        await addPubFile(plainPubFile);
        await waitFor(() => fingerprintText());

        mockRunTask.mockClear();
        await chooseKeyFile(plainKeyFile);
        await addPubFile(plainPubFile);
        await settle();
        expect(mockRunTask).not.toHaveBeenCalled();
        expect(fingerprintText()).toBeTruthy();
        expect(buttonByText("Create SSH key")!.disabled).toBe(false);
    });

    it("keeps an unlocked key as it is when the same files are picked again", async () => {
        await openImport();
        await chooseKeyFile(encryptedKeyFile);
        await addPubFile(encryptedPubFile);
        await enterPassphrase();
        await act(async () => buttonByText("Unlock")!.click());
        await waitFor(() => fingerprintText());
        await act(async () =>
            setNativeValue(byId<HTMLInputElement>("ssh-comment")!, "edited"),
        );

        mockRunTask.mockClear();
        const sawBusy = watchBusy();
        await chooseKeyFile(encryptedKeyFile);
        await addPubFile(encryptedPubFile);
        await settle();
        expect(sawBusy()).toBe(false);
        expect(mockRunTask).not.toHaveBeenCalled();
        expect(byId("ssh-import-passphrase")).toBeNull();
        expect(fingerprintText()).toBeTruthy();
        expect(byId<HTMLInputElement>("ssh-comment")!.value).toBe("edited");
        expect(buttonByText("Create SSH key")!.disabled).toBe(false);
    });

    it("keeps an unlock running when the same key file is picked during it", async () => {
        const unlock = deferred<SSHKeyTaskResult>();
        mockRunTask.mockImplementation(async (task) =>
            task.kind === "import" && task.passphrase
                ? unlock.promise
                : runSSHKeyTask(task),
        );
        await openImport();
        await chooseKeyFile(encryptedKeyFile);
        await enterPassphrase();
        await act(async () => buttonByText("Unlock")!.click());

        await chooseKeyFile(encryptedKeyFile);
        const unlocks = mockRunTask.mock.calls.filter(
            ([task]) => task.kind === "import" && task.passphrase,
        );
        expect(unlocks).toHaveLength(1);
        expect(unlocks[0]![1]?.signal?.aborted).toBe(false);

        await act(async () => {
            unlock.resolve({ ok: true, kind: "import", data: importedKey() });
        });
        await waitFor(() => fingerprintText());
        expect(buttonByText("Create SSH key")!.disabled).toBe(false);
    });

    it("explains a .pub file chosen as the private key", async () => {
        await openImport();
        await chooseKeyFile(plainPubFile);

        const expected = runSSHKeyTask({ kind: "import", text: PLAIN_PUB });
        expect(expected).toMatchObject({ ok: false, code: "public-key-only" });
        await waitFor(
            () => !expected.ok && alertText().includes(expected.message),
        );
        expect(buttonByText("Create SSH key")!.disabled).toBe(false);
    });

    it("refuses a private key added as the .pub file and keeps the key", async () => {
        await openImport();
        await chooseKeyFile(plainKeyFile);
        await waitFor(() => fingerprintText());

        mockRunTask.mockClear();
        await addPubFile(plainKeyFile);
        // The same message vault-core gives for a .pub it can't read.
        const expected = runSSHKeyTask({
            kind: "import",
            text: PLAIN_KEY,
            publicKey: PLAIN_KEY,
        });
        expect(expected).toMatchObject({
            ok: false,
            code: "public-key-invalid",
        });
        await waitFor(
            () => !expected.ok && alertText().includes(expected.message),
        );
        expect(mockRunTask).not.toHaveBeenCalled();
        expect(buttonByLabel("Remove public key file")).toBeNull();
        expect(fingerprintText()).toBeTruthy();
        expect(buttonByText("Create SSH key")!.disabled).toBe(false);
    });

    it("generates an Ed25519 key whose comment follows the name", async () => {
        const onSave = await renderDrawer(null);

        const fingerprint = await waitFor(() => fingerprintText(), 20_000);
        expect(fingerprint).toMatch(/^SHA256:/);

        await act(async () => {
            setNativeValue(byId<HTMLInputElement>("name")!, "Work laptop");
        });
        await waitFor(
            () =>
                byId<HTMLInputElement>("ssh-comment")?.value === "Work laptop",
        );

        // Switching modes keeps the generated key.
        const radios = Array.from(
            document.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
        );
        await act(async () => radios[1]!.click());
        expect(byId("ssh-private-key")).not.toBeNull();
        await act(async () => radios[0]!.click());
        expect(fingerprintText()).toBe(fingerprint);

        // Once edited, the comment no longer follows the name.
        await act(async () => {
            setNativeValue(byId<HTMLInputElement>("ssh-comment")!, "me@laptop");
            setNativeValue(byId<HTMLInputElement>("name")!, "Laptop key");
        });

        await act(async () => buttonByText("Create SSH key")!.click());
        await waitFor(() => onSave.mock.calls.length > 0);
        const form = onSave.mock.calls[0]![0];
        expect(form).toMatchObject({
            Type: ItemType.SSHKey,
            Name: "Laptop key",
            Username: "",
            Password: "",
            URL: "",
        });
        expect(form.SSHKey?.Comment).toBe("me@laptop");
        expect(describeSSHKey(form.SSHKey!)?.fingerprint).toBe(fingerprint);
        expect(form.SSHKey?.PrivateKey).toContain("BEGIN OPENSSH PRIVATE KEY");
    }, 60_000);

    it("edits the details of an SSH key without replacing the key", async () => {
        const credential = sshCredential();
        const onSave = await renderDrawer(credential);

        expect(byId("ssh-private-key")).toBeNull();
        expect(byId<HTMLInputElement>("ssh-comment")!.value).toBe(
            credential.SSHKey!.Comment,
        );

        await act(async () => {
            setNativeValue(byId<HTMLInputElement>("ssh-comment")!, "ops@host");
        });
        await act(async () => buttonByText("Save Changes")!.click());
        await waitFor(() => onSave.mock.calls.length > 0);
        expect(onSave.mock.calls[0]![0].SSHKey).toEqual({
            ...credential.SSHKey,
            Comment: "ops@host",
        });
    });

    it("matches SSH keys by comment and fingerprint", () => {
        const credential = sshCredential();
        const { fingerprint } = describeSSHKey(credential.SSHKey!)!;

        expect(credentialMatchesSearch(credential, "fixtures")).toBe(true);
        expect(credentialMatchesSearch(credential, fingerprint)).toBe(true);
        expect(
            credentialMatchesSearch(credential, fingerprint.slice(7, 20)),
        ).toBe(true);
        expect(credentialMatchesSearch(credential, "missing")).toBe(false);
    });

    describe("detail panel", () => {
        const writeText = jest.fn(async (_text: string) => undefined);

        beforeEach(() => {
            writeText.mockClear();
            Object.defineProperty(navigator, "clipboard", {
                configurable: true,
                value: { writeText },
            });
        });

        const renderDetail = async (credential: VaultCredential) => {
            await act(async () => {
                root.render(
                    <CredentialDetail
                        credential={credential}
                        onEdit={jest.fn()}
                        onOpenUrl={jest.fn()}
                        onDeleteCredential={jest.fn()}
                        directoryName="Root"
                    />,
                );
            });
        };

        it("shows an error when the private key can't be loaded", async () => {
            mockRunTask.mockResolvedValue(internalError);
            await renderDetail(sshCredential());

            await act(async () => buttonByLabel("Copy private key")!.click());
            await waitFor(() => jest.mocked(toast.error).mock.calls.length > 0);
            expect(toast.error).toHaveBeenCalledWith(
                SSH_KEY_TASK_INTERNAL_ERROR,
            );
            expect(writeText).not.toHaveBeenCalled();
            expect(buttonByLabel("Copy private key")!.disabled).toBe(false);

            await act(async () => buttonByLabel("Show private key")!.click());
            await waitFor(() => jest.mocked(toast.error).mock.calls.length > 1);
            expect(textOf()).not.toContain("BEGIN OPENSSH PRIVATE KEY");
            expect(buttonByLabel("Show private key")!.disabled).toBe(false);
        });

        it("copies the private key with the clipboard reminder", async () => {
            await renderDetail(sshCredential());

            await act(async () => buttonByLabel("Copy private key")!.click());
            await waitFor(() => writeText.mock.calls.length > 0);
            expect(writeText.mock.calls[0]![0]).toContain(
                "BEGIN OPENSSH PRIVATE KEY",
            );
            await waitFor(() => jest.mocked(toast.info).mock.calls.length > 0);
            expect(jest.mocked(toast.info).mock.calls[0]![0]).toMatch(
                /Clear it when done/,
            );

            jest.mocked(toast.info).mockClear();
            await act(async () => buttonByLabel("Copy public key")!.click());
            await waitFor(() => jest.mocked(toast.info).mock.calls.length > 0);
            expect(jest.mocked(toast.info).mock.calls[0]![0]).toBe("Copied");
        });

        it("only reminds to clear the clipboard for secrets", async () => {
            await renderDetail(
                Object.assign(new VaultCredential(), {
                    ID: "login",
                    Type: ItemType.Credentials,
                    Name: "Example",
                    Username: "me@example.com",
                    Password: "hunter2-hunter2",
                    DateCreatedTimestamp: 1_700_000_000_000,
                }),
            );

            await act(async () => buttonByLabel("Copy username")!.click());
            await waitFor(() => jest.mocked(toast.info).mock.calls.length > 0);
            expect(jest.mocked(toast.info).mock.calls[0]![0]).toBe("Copied");

            await act(async () => buttonByLabel("Copy password")!.click());
            await waitFor(() => jest.mocked(toast.info).mock.calls.length > 1);
            expect(jest.mocked(toast.info).mock.calls[1]![0]).toMatch(
                /Clear it when done/,
            );
        });
    });
});
