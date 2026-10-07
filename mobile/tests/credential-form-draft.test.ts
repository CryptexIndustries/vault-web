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
import { Provider, createStore } from "jotai";
import { err, ok } from "neverthrow";
import { CustomFieldType } from "@cryptex-industries/vault-core/proto";

import {
    Vault,
    VaultCredential,
    type CredentialFormSchemaType,
} from "@cryptex-industries/vault-core/vault-utils/vault";
import { CredentialForm } from "@/components/vault/credential-form";
import { unlockedVaultAtom } from "@/utils/atoms";
import { persistVaultMutation } from "@/utils/vault-mutations";

jest.mock("react-native", () => ({ Pressable: "Pressable", View: "View" }));
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
    Plus: "Plus",
    ScanLine: "ScanLine",
    Shield: "Shield",
    Trash2: "Trash2",
}));
jest.mock("@/components/unlocked/confirmation-sheet", () => ({
    useUnlockedConfirmation: () => jest.fn(),
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

const store = createStore();
let renderer: ReactTestRenderer | undefined;
let beforeMutation: (() => void) | undefined;
const persist = jest.mocked(persistVaultMutation);

beforeEach(() => {
    (
        globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    (
        globalThis as { IS_REACT_NATIVE_TEST_ENVIRONMENT?: boolean }
    ).IS_REACT_NATIVE_TEST_ENVIRONMENT = true;
    beforeMutation = undefined;
    persist.mockImplementation(async (_kind, mutate) => {
        beforeMutation?.();
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
    delete (globalThis as { IS_REACT_NATIVE_TEST_ENVIRONMENT?: boolean })
        .IS_REACT_NATIVE_TEST_ENVIRONMENT;
});

function credential(id: string, name: string): VaultCredential {
    return Object.assign(new VaultCredential(), {
        ID: id,
        Name: name,
        Username: `${id}@example.test`,
        Password: "saved-password",
    });
}

function tree(
    credentialId: string,
    props: {
        initialValues?: Partial<CredentialFormSchemaType>;
        onSaved?: (saved: VaultCredential) => void;
    } = {},
) {
    return createElement(
        Provider,
        { store },
        createElement(CredentialForm, {
            credentialId,
            ...props,
        }),
    );
}

async function mount(...credentials: VaultCredential[]) {
    const vault = new Vault();
    vault.Credentials = credentials;
    store.set(unlockedVaultAtom, vault);
    await act(async () => {
        renderer = create(tree(credentials[0]!.ID));
    });
}

function input(label: string) {
    return renderer!.root
        .findAllByType("Input" as never)
        .find((node) => node.props.accessibilityLabel === label)!;
}

function publish(updated: VaultCredential) {
    const vault = Object.assign(new Vault(), store.get(unlockedVaultAtom));
    vault.Credentials = vault.Credentials.map((item) =>
        item.ID === updated.ID ? updated : item,
    );
    store.set(unlockedVaultAtom, vault);
}

async function save() {
    await act(async () => {
        renderer!.root
            .findAllByType("Button" as never)
            .find((node) => node.props.testID === "credential-submit")!
            .props.onPress();
    });
}

describe("credential editor drafts", () => {
    it("keeps unsaved values when sync replaces the same credential", async () => {
        const saved = credential("first", "Saved name");
        await mount(saved);
        await act(async () => {
            input("Credential name").props.onChangeText("Draft name");
            input("Password").props.onChangeText("draft-password");
        });

        await act(async () =>
            publish(
                Object.assign(new VaultCredential(), saved, {
                    Name: "Remote name",
                    Password: "remote-password",
                    Version: 4,
                }),
            ),
        );

        expect(input("Credential name").props.value).toBe("Draft name");
        expect(input("Password").props.value).toBe("draft-password");
    });

    it("initializes request prefills once and preserves later edits", async () => {
        const saved = credential("first", "Saved name");
        const vault = new Vault();
        vault.Credentials = [saved];
        store.set(unlockedVaultAtom, vault);
        await act(async () => {
            renderer = create(
                tree(saved.ID, {
                    initialValues: { Password: "request-password" },
                }),
            );
        });
        expect(input("Password").props.value).toBe("request-password");
        await act(async () =>
            input("Password").props.onChangeText("edited-password"),
        );
        await act(async () =>
            renderer!.update(
                tree(saved.ID, {
                    initialValues: { Password: "request-password" },
                }),
            ),
        );
        expect(input("Password").props.value).toBe("edited-password");
    });

    it("starts a fresh draft when the edited credential ID changes", async () => {
        const first = credential("first", "First name");
        const second = credential("second", "Second name");
        await mount(first, second);
        await act(async () =>
            input("Credential name").props.onChangeText("First draft"),
        );
        await act(async () => renderer!.update(tree(second.ID)));
        expect(input("Credential name").props.value).toBe("Second name");
        expect(input("Credential username").props.value).toBe(
            "second@example.test",
        );
    });

    it("saves an unchanged revision and keeps credential metadata", async () => {
        const saved = Object.assign(credential("first", "Saved name"), {
            Version: 2,
            DateCreatedTimestamp: 1234,
        });
        await mount(saved);
        const onSaved = jest.fn<(saved: VaultCredential) => void>();
        await act(async () => renderer!.update(tree(saved.ID, { onSaved })));
        await act(async () =>
            input("Credential name").props.onChangeText("Draft name"),
        );

        await save();

        const updated = store.get(unlockedVaultAtom).Credentials[0]!;
        expect(updated.Name).toBe("Draft name");
        expect(updated.Version).toBe(3);
        expect(updated.DateCreatedTimestamp).toBe(1234);
        expect(onSaved).toHaveBeenCalledWith(updated);
    });

    it("retains the draft and rejects a change arriving while save is queued", async () => {
        const saved = credential("first", "Saved name");
        await mount(saved);
        const onSaved = jest.fn<(saved: VaultCredential) => void>();
        await act(async () => renderer!.update(tree(saved.ID, { onSaved })));
        await act(async () =>
            input("Credential name").props.onChangeText("Draft name"),
        );
        const remotePasskey = {
            CredentialID: "remote-passkey",
            RPID: "example.test",
            UserName: "remote-user",
        } as NonNullable<VaultCredential["Passkey"]>;
        const incoming = Object.assign(new VaultCredential(), saved, {
            Version: 8,
            Password: "remote-password",
            DateCreatedTimestamp: 1234,
            Passkey: remotePasskey,
        });
        beforeMutation = () => publish(incoming);

        await save();

        const updated = store.get(unlockedVaultAtom).Credentials[0]!;
        expect(updated).toBe(incoming);
        expect(updated.Password).toBe("remote-password");
        expect(updated.Version).toBe(8);
        expect(updated.DateCreatedTimestamp).toBe(1234);
        expect(updated.Passkey).toEqual(remotePasskey);
        expect(onSaved).not.toHaveBeenCalled();
        expect(input("Credential name").props.value).toBe("Draft name");
        expect(input("Password").props.value).toBe("saved-password");
        expect(
            renderer!.root
                .findAllByType("Text" as never)
                .some(
                    (node) =>
                        typeof node.props.children === "string" &&
                        node.props.children.includes(
                            "Cancel editing and reopen",
                        ),
                ),
        ).toBe(true);
    });

    it("rejects a synced change before saving even when the version is tied", async () => {
        const saved = Object.assign(credential("first", "Saved name"), {
            Version: 2,
            Hash: "opening-hash",
        });
        await mount(saved);
        await act(async () =>
            input("Credential name").props.onChangeText("Draft name"),
        );
        const incoming = Object.assign(new VaultCredential(), saved, {
            Hash: "incoming-hash",
            Password: "incoming-password",
        });
        await act(async () => publish(incoming));

        await save();

        expect(store.get(unlockedVaultAtom).Credentials[0]).toBe(incoming);
        expect(input("Credential name").props.value).toBe("Draft name");
    });

    it("allows saving after sync changes a different credential", async () => {
        const first = credential("first", "First name");
        const second = credential("second", "Second name");
        await mount(first, second);
        await act(async () =>
            input("Credential name").props.onChangeText("First draft"),
        );
        const incoming = Object.assign(new VaultCredential(), second, {
            Version: 4,
            Password: "remote-password",
        });
        beforeMutation = () => publish(incoming);

        await save();

        expect(store.get(unlockedVaultAtom).Credentials[0]!.Name).toBe(
            "First draft",
        );
        expect(store.get(unlockedVaultAtom).Credentials[1]).toBe(incoming);
    });

    it("saves a newly named Boolean field as false without toggling it", async () => {
        await mount(credential("first", "Saved name"));
        await act(async () =>
            renderer!.root
                .findAllByType("Button" as never)
                .find(
                    (node) =>
                        node.props.accessibilityLabel === "Add custom field",
                )!
                .props.onPress(),
        );
        await act(async () =>
            input("Custom field 1 name").props.onChangeText("Remember me"),
        );
        await act(async () =>
            renderer!.root
                .findAllByType("Pressable" as never)
                .find((node) =>
                    node.props.accessibilityLabel?.startsWith(
                        "Change field type",
                    ),
                )!
                .props.onPress(),
        );
        await act(async () =>
            renderer!.root
                .findAllByType("Pressable" as never)
                .find((node) =>
                    node
                        .findAllByType("Text" as never)
                        .some((text) => text.props.children === "Bool"),
                )!
                .props.onPress(),
        );
        expect(
            renderer!.root
                .findAllByType("Switch" as never)
                .find(
                    (node) =>
                        node.props.accessibilityLabel ===
                        "Remember me boolean value",
                )!.props.value,
        ).toBe(false);

        await save();

        expect(
            store.get(unlockedVaultAtom).Credentials[0]!.CustomFields,
        ).toEqual([
            expect.objectContaining({
                Name: "Remember me",
                Type: CustomFieldType.Boolean,
                Value: "false",
            }),
        ]);
    });

    it("shows a missing item after sync deletes the edited credential", async () => {
        const saved = credential("first", "Saved name");
        await mount(saved);
        await act(async () =>
            input("Credential name").props.onChangeText("Draft name"),
        );
        await act(async () =>
            publish(
                Object.assign(new VaultCredential(), saved, { Deleted: true }),
            ),
        );
        expect(
            renderer!.root.findByType("TaskScreen" as never).props.title,
        ).toBe("Item not found");
        expect(renderer!.root.findAllByType("Input" as never)).toHaveLength(0);
    });

    it("does not recreate an item deleted while its save is queued", async () => {
        const saved = credential("first", "Saved name");
        await mount(saved);
        const onSaved = jest.fn<(saved: VaultCredential) => void>();
        await act(async () => renderer!.update(tree(saved.ID, { onSaved })));
        beforeMutation = () =>
            publish(
                Object.assign(new VaultCredential(), saved, { Deleted: true }),
            );

        await save();

        expect(store.get(unlockedVaultAtom).Credentials).toHaveLength(1);
        expect(store.get(unlockedVaultAtom).Credentials[0]!.Deleted).toBe(true);
        expect(onSaved).not.toHaveBeenCalled();
    });
});
