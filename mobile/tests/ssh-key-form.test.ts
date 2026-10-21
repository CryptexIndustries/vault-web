import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    jest,
} from "@jest/globals";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement, type ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { Provider, createStore } from "jotai";
import { err, ok } from "neverthrow";
import { router } from "expo-router";

import { ItemType } from "@cryptex-industries/vault-core/proto";
import {
    Vault,
    VaultCredential,
} from "@cryptex-industries/vault-core/vault-utils/vault";
import { CredentialForm } from "@/components/vault/credential-form";
import { unlockedVaultAtom } from "@/utils/atoms";
import { persistVaultMutation } from "@/utils/vault-mutations";
import { pickSSHKeyFile } from "@/utils/ssh-key-files";

jest.mock("react-native", () => ({
    Platform: { select: (values: { android?: unknown }) => values.android },
    Pressable: "Pressable",
    View: "View",
}));
// Key work runs on a worker runtime; here it runs later on the same thread,
// through the real bundled worker program. Held tasks wait for release().
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
jest.mock("expo-router", () => ({
    router: { back: jest.fn(), replace: jest.fn() },
}));
jest.mock("expo-camera", () => ({
    CameraView: "CameraView",
    useCameraPermissions: () => [{ granted: true }, jest.fn()],
}));
jest.mock("lucide-react-native", () => ({
    Check: "Check",
    ChevronRight: "ChevronRight",
    FileKey: "FileKey",
    FileUp: "FileUp",
    Plus: "Plus",
    ScanLine: "ScanLine",
    Shield: "Shield",
    Trash2: "Trash2",
    X: "X",
}));
jest.mock("@/components/unlocked/confirmation-sheet", () => ({
    useUnlockedConfirmation: () => jest.fn(),
}));
jest.mock("@/components/unlocked/unlocked-snackbar", () => ({
    useUnlockedSnackbar: () => jest.fn(),
}));
jest.mock("@/components/unlocked/unlocked-ui", () => ({
    UnlockedDialogTitle: "DialogTitle",
    UnlockedTaskScreen: ({
        children,
        footer,
        ...props
    }: {
        children: ReactNode;
        footer?: ReactNode;
    }) => createElement("TaskScreen", props, children, footer),
    UnlockedText: "Text",
    UnlockedButton: "Button",
    UnlockedInput: "Input",
    UnlockedLabel: "Label",
}));
jest.mock("@/components/ui/dialog", () => ({
    Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
        open ? createElement("Dialog", {}, children) : null,
    DialogDescription: "DialogDescription",
    DialogFooter: "DialogFooter",
    DialogHeader: "DialogHeader",
}));
jest.mock("@/components/ui/switch", () => ({ Switch: "Switch" }));
jest.mock("@/components/ui/separator", () => ({ Separator: "Separator" }));
jest.mock("@/components/icon-button", () => ({ IconButton: "IconButton" }));
jest.mock("@/components/inline-notice", () => ({ InlineNotice: "Notice" }));
jest.mock("@/components/vault/password-strength-meter", () => ({
    PasswordStrengthMeter: "Strength",
}));
jest.mock("@/components/vault/password-generator", () => ({
    PasswordGeneratorDialog: () => null,
}));
jest.mock("@/components/vault/totp-field", () => ({ TotpField: "TotpField" }));
jest.mock("@/utils/ssh-key-files", () => ({
    pickSSHKeyFile: jest.fn(),
    SSHKeyFileError: class SSHKeyFileError extends Error {},
}));
jest.mock("@/lib/utils", () => ({
    cn: (...values: unknown[]) => values.filter(Boolean).join(" "),
}));
jest.mock("@/utils/atoms", () => {
    const { atom } = jest.requireActual<typeof import("jotai")>("jotai");
    const vaultAtom = atom<Vault>(new Vault());
    return {
        unlockedVaultAtom: vaultAtom,
        vaultCredentialsAtom: atom((get) => get(vaultAtom).Credentials),
    };
});
jest.mock("@/utils/vault-mutations", () => ({
    persistVaultMutation: jest.fn(),
}));

const fixtures = resolve(
    __dirname,
    "../../packages/vault-core/src/tests/fixtures/ssh",
);
const fixture = (name: string) => readFileSync(resolve(fixtures, name), "utf8");

// Typed or pasted keys are checked after a 500 ms pause.
const TYPING_DELAY = 600;
const store = createStore();
let renderer: ReactTestRenderer | undefined;
const persist = jest.mocked(persistVaultMutation);

beforeEach(() => {
    (
        globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    (
        globalThis as { requestAnimationFrame?: (run: () => void) => void }
    ).requestAnimationFrame = (run) => setTimeout(run, 0);
    store.set(unlockedVaultAtom, new Vault());
    mockWorker.hold = false;
    mockWorker.queue = [];
    persist.mockImplementation(async (_kind, mutate) => {
        try {
            const mutation = await mutate(store.get(unlockedVaultAtom));
            store.set(unlockedVaultAtom, mutation.vault);
            return ok(mutation.result);
        } catch {
            return err("VAULT_MUTATION_FAILED");
        }
    });
});

afterEach(async () => {
    await act(async () => renderer?.unmount());
    renderer = undefined;
    delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
        .IS_REACT_ACT_ENVIRONMENT;
});

async function render(props: Parameters<typeof CredentialForm>[0]) {
    await act(async () => {
        renderer = create(
            createElement(
                Provider,
                { store },
                createElement(CredentialForm, props),
            ),
        );
    });
    // Let the lazily loaded key module generate the new key.
    await settle(50);
}

async function settle(ms: number) {
    await act(async () => {
        await new Promise((done) => setTimeout(done, ms));
    });
}

function input(label: string) {
    return renderer!.root
        .findAllByType("Input" as never)
        .find((node) => node.props.accessibilityLabel === label)!;
}

function byTestId(id: string) {
    return renderer!.root.findAll(
        (node) => typeof node.type === "string" && node.props.testID === id,
    )[0];
}

function labelled(label: string) {
    return renderer!.root.findAll(
        (node) =>
            typeof node.type === "string" &&
            node.props.accessibilityLabel === label,
    )[0]!;
}

function button(text: string) {
    return renderer!.root
        .findAllByType("Button" as never)
        .find((node) => node.props.children === text)!;
}

function texts() {
    return renderer!.root
        .findAllByType("Text" as never)
        .map((node) => [node.props.children].flat().join(""));
}

function notices() {
    return renderer!.root
        .findAllByType("Notice" as never)
        .map((node) => node.props.message as string);
}

const busy = () => byTestId("ssh-key-import-busy");

async function release() {
    mockWorker.hold = false;
    const queued = mockWorker.queue.splice(0);
    await act(async () => {
        for (const work of queued) work();
    });
    await settle(10);
}

async function pick(label: string, name: string, file: string) {
    jest.mocked(pickSSHKeyFile).mockResolvedValueOnce({
        name,
        text: fixture(file),
    });
    await act(async () => labelled(label).props.onPress());
}

async function save() {
    await act(async () => byTestId("ssh-key-submit")!.props.onPress());
}

const savedItems = () =>
    store.get(unlockedVaultAtom).Credentials.filter((item) => !item.Deleted);

describe("SSH key editor", () => {
    it("generates an Ed25519 key whose comment follows the name until edited", async () => {
        await render({ itemType: "ssh-key", initialDirectoryId: "dir" });
        expect(byTestId("ssh-key-generated")).toBeDefined();

        await act(async () =>
            input("SSH key name").props.onChangeText("Work laptop"),
        );
        expect(input("SSH key comment").props.value).toBe("Work laptop");
        expect(
            texts().some((text) =>
                /^ssh-ed25519 AAAA\S+ Work laptop$/.test(text),
            ),
        ).toBe(true);

        // Switching modes keeps the same generated key.
        const before = texts().find((text) => text.startsWith("SHA256:"));
        await act(async () =>
            byTestId("ssh-key-source-import")!.props.onPress(),
        );
        await act(async () =>
            byTestId("ssh-key-source-generate")!.props.onPress(),
        );
        expect(texts().find((text) => text.startsWith("SHA256:"))).toBe(before);

        await save();
        const [saved] = savedItems();
        expect(saved).toEqual(
            expect.objectContaining({
                Type: ItemType.SSHKey,
                Name: "Work laptop",
                DirectoryID: "dir",
                Username: "",
                Password: "",
                URL: "",
            }),
        );
        expect(saved!.SSHKey!.Comment).toBe("Work laptop");
        expect(saved!.SSHKey!.PublicKey).toMatch(/^ssh-ed25519 AAAA\S+$/);
        expect(saved!.SSHKey!.PrivateKey).toContain(
            "BEGIN OPENSSH PRIVATE KEY",
        );
        expect(router.replace).toHaveBeenCalledWith(
            `/(app)/(tabs)/vault/${saved!.ID}`,
        );
    });

    it("keeps an edited comment when the name changes", async () => {
        await render({ itemType: "ssh-key" });
        await act(async () => input("SSH key name").props.onChangeText("A"));
        await act(async () =>
            input("SSH key comment").props.onChangeText("me@host"),
        );
        await act(async () => input("SSH key name").props.onChangeText("B"));
        expect(input("SSH key comment").props.value).toBe("me@host");
    });

    it("imports an encrypted key after its passphrase and never stores the passphrase", async () => {
        await render({ itemType: "ssh-key" });
        await act(async () =>
            byTestId("ssh-key-source-import")!.props.onPress(),
        );
        await act(async () =>
            input("Private key").props.onChangeText(
                fixture("ed25519-aes256-ctr.key"),
            ),
        );
        await settle(TYPING_DELAY);
        expect(input("Key passphrase")).toBeDefined();

        await act(async () =>
            input("Key passphrase").props.onChangeText("wrong horse"),
        );
        await act(async () => button("Unlock").props.onPress());
        await settle(50);
        expect(notices()).toContain("The passphrase is incorrect.");

        await act(async () =>
            input("Key passphrase").props.onChangeText("correct horse"),
        );
        await act(async () => button("Unlock").props.onPress());
        await settle(50);
        expect(byTestId("ssh-key-imported")).toBeDefined();
        expect(texts()).toContain(
            "SHA256:FgJyvLLzDuDxEny970gdFu3G8z6d8daahg2A+LVGV68",
        );
        expect(input("SSH key comment").props.value).toBe(
            "ed25519-enc@fixtures",
        );

        await act(async () =>
            input("SSH key name").props.onChangeText("Imported"),
        );
        await save();
        const [saved] = savedItems();
        expect(saved!.SSHKey!.PublicKey).toBe(
            fixture("ed25519-aes256-ctr.key.pub")
                .trim()
                .split(" ")
                .slice(0, 2)
                .join(" "),
        );
        expect(saved!.SSHKey!.Comment).toBe("ed25519-enc@fixtures");
        expect(JSON.stringify(saved)).not.toContain("correct horse");
    });

    it("shows import errors under the key field", async () => {
        await render({ itemType: "ssh-key" });
        await act(async () =>
            byTestId("ssh-key-source-import")!.props.onPress(),
        );
        await act(async () =>
            input("Private key").props.onChangeText(fixture("ed25519.key.pub")),
        );
        await settle(TYPING_DELAY);
        expect(notices()[0]).toMatch(/^This is a public key\./);
        await save();
        expect(savedItems()).toEqual([]);
    });

    it("edits the details of an existing key without replacing it", async () => {
        const sshKeys =
            await import("@cryptex-industries/vault-core/vault-utils/ssh-key");
        const key = sshKeys.generateSSHKey("old comment");
        const existing = Object.assign(new VaultCredential(), {
            ID: "ssh",
            Type: ItemType.SSHKey,
            Name: "Server",
            SSHKey: key,
        });
        const vault = new Vault();
        vault.Credentials = [existing];
        store.set(unlockedVaultAtom, vault);
        await render({ credentialId: "ssh" });

        await act(async () =>
            input("SSH key comment").props.onChangeText("new comment"),
        );
        await act(async () =>
            input("SSH key name").props.onChangeText("Server 2"),
        );
        await save();
        const [saved] = savedItems();
        expect(saved!.Name).toBe("Server 2");
        expect(saved!.SSHKey).toEqual({ ...key, Comment: "new comment" });
        expect(router.back).toHaveBeenCalled();
    });

    it("shows the check while a key is read and keeps Save disabled until it ends", async () => {
        await render({ itemType: "ssh-key" });
        await act(async () =>
            byTestId("ssh-key-source-import")!.props.onPress(),
        );
        mockWorker.hold = true;
        await act(async () =>
            input("Private key").props.onChangeText(fixture("rsa-pkcs8.key")),
        );
        expect(busy()).toBeDefined();
        expect(byTestId("ssh-key-submit")!.props.disabled).toBe(true);
        await settle(TYPING_DELAY);
        expect(mockWorker.queue).toHaveLength(1);
        expect(busy()).toBeDefined();

        await release();
        expect(byTestId("ssh-key-imported")).toBeDefined();
        expect(busy()).toBeUndefined();
        expect(byTestId("ssh-key-submit")!.props.disabled).toBe(false);
    });

    it("blocks the passphrase field during unlock and ignores a second Go", async () => {
        await render({ itemType: "ssh-key" });
        await act(async () =>
            byTestId("ssh-key-source-import")!.props.onPress(),
        );
        await act(async () =>
            input("Private key").props.onChangeText(
                fixture("ed25519-aes256-ctr.key"),
            ),
        );
        await settle(TYPING_DELAY);
        await act(async () =>
            input("Key passphrase").props.onChangeText("correct horse"),
        );
        mockWorker.hold = true;
        await act(async () => input("Key passphrase").props.onSubmitEditing());
        expect(input("Key passphrase").props.editable).toBe(false);
        expect(button("Unlock").props.loading).toBe(true);
        expect(byTestId("ssh-key-submit")!.props.disabled).toBe(true);
        await act(async () => input("Key passphrase").props.onSubmitEditing());
        await act(async () => button("Unlock").props.onPress());
        expect(mockWorker.queue).toHaveLength(1);

        await release();
        expect(byTestId("ssh-key-imported")).toBeDefined();
    });

    it("re-unlocks with the passphrase that worked when a .pub file is added, and shows it", async () => {
        await render({ itemType: "ssh-key" });
        await act(async () =>
            byTestId("ssh-key-source-import")!.props.onPress(),
        );
        await act(async () =>
            input("Private key").props.onChangeText(
                fixture("ed25519-aes256-ctr.key"),
            ),
        );
        await settle(TYPING_DELAY);
        await act(async () =>
            input("Key passphrase").props.onChangeText("correct horse"),
        );
        await act(async () => button("Unlock").props.onPress());
        await settle(50);
        expect(byTestId("ssh-key-imported")).toBeDefined();

        jest.mocked(pickSSHKeyFile).mockResolvedValueOnce({
            name: "id_ed25519.pub",
            text: fixture("ed25519-aes256-ctr.key.pub"),
        });
        mockWorker.hold = true;
        await act(async () => labelled("Add .pub file").props.onPress());
        expect(notices()).toContain("Unlocking…");
        expect(byTestId("ssh-key-submit")!.props.disabled).toBe(true);
        await settle(TYPING_DELAY);
        await release();
        expect(notices()).not.toContain("Unlocking…");
        expect(input("Key passphrase")).toBeUndefined();
        expect(byTestId("ssh-key-imported")).toBeDefined();
        expect(byTestId("ssh-key-submit")!.props.disabled).toBe(false);
    });

    it("picking the same file again keeps the checked key, and a repeat pick during a check doesn't stall it", async () => {
        await render({ itemType: "ssh-key" });
        await act(async () =>
            byTestId("ssh-key-source-import")!.props.onPress(),
        );
        await pick("Choose key file", "id_rsa", "rsa-pkcs8.key");
        await settle(50);
        expect(byTestId("ssh-key-imported")).toBeDefined();

        // Regression: this left "Checking key…" up and Save disabled for good.
        mockWorker.hold = true;
        await pick("Choose key file", "id_rsa", "rsa-pkcs8.key");
        expect(mockWorker.queue).toHaveLength(0);
        expect(busy()).toBeUndefined();
        expect(byTestId("ssh-key-imported")).toBeDefined();
        expect(byTestId("ssh-key-submit")!.props.disabled).toBe(false);

        await pick("Add .pub file", "id_rsa.pub", "rsa-pkcs8.key.pub");
        expect(mockWorker.queue).toHaveLength(1);
        await release();
        mockWorker.hold = true;
        await pick("Add .pub file", "id_rsa.pub", "rsa-pkcs8.key.pub");
        expect(mockWorker.queue).toHaveLength(0);
        expect(busy()).toBeUndefined();
        expect(byTestId("ssh-key-submit")!.props.disabled).toBe(false);
        await act(async () => labelled("Remove .pub file").props.onPress());
        await release();

        // The same file again while it's still being checked.
        mockWorker.hold = true;
        await pick("Choose key file", "id_ed25519", "ed25519.key");
        await pick("Choose key file", "id_ed25519", "ed25519.key");
        expect(mockWorker.queue).toHaveLength(1);
        expect(busy()).toBeDefined();
        await release();
        expect(busy()).toBeUndefined();
        expect(byTestId("ssh-key-imported")).toBeDefined();
        expect(byTestId("ssh-key-submit")!.props.disabled).toBe(false);
    });

    it("keeps an unlocked key when the same key comes back, without asking again", async () => {
        await render({ itemType: "ssh-key" });
        await act(async () =>
            byTestId("ssh-key-source-import")!.props.onPress(),
        );
        await pick("Choose key file", "id_ed25519", "ed25519-aes256-ctr.key");
        await settle(50);
        await act(async () =>
            input("Key passphrase").props.onChangeText("correct horse"),
        );
        await act(async () => button("Unlock").props.onPress());
        await settle(50);
        expect(byTestId("ssh-key-imported")).toBeDefined();

        mockWorker.hold = true;
        await pick("Choose key file", "id_ed25519", "ed25519-aes256-ctr.key");
        await act(async () =>
            byTestId("ssh-key-source-generate")!.props.onPress(),
        );
        await act(async () =>
            byTestId("ssh-key-source-import")!.props.onPress(),
        );
        expect(mockWorker.queue).toHaveLength(0);
        expect(busy()).toBeUndefined();
        expect(input("Key passphrase")).toBeUndefined();
        expect(byTestId("ssh-key-imported")).toBeDefined();
        expect(byTestId("ssh-key-submit")!.props.disabled).toBe(false);
    });

    it("ignores Cancel during a save and doesn't navigate once the screen is gone", async () => {
        await render({ itemType: "ssh-key" });
        await act(async () => input("SSH key name").props.onChangeText("A"));
        let finish: (value: VaultCredential) => void = () => undefined;
        persist.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    finish = (value) => resolve(ok(value) as never);
                }),
        );
        await act(async () => {
            void byTestId("ssh-key-submit")!.props.onPress();
        });
        expect(byTestId("ssh-key-submit")!.props.loading).toBe(true);
        await act(async () =>
            renderer!.root.findByType("TaskScreen" as never).props.onBack(),
        );
        expect(router.back).not.toHaveBeenCalled();

        await act(async () => renderer!.unmount());
        renderer = undefined;
        await act(async () => finish(new VaultCredential()));
        expect(router.replace).not.toHaveBeenCalled();
        expect(router.back).not.toHaveBeenCalled();
    });
});
