import { afterEach, beforeEach, expect, it, jest } from "@jest/globals";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { Provider } from "jotai";
import { ok } from "neverthrow";
import { router } from "expo-router";
import {
    EncryptedBlob,
    Vault as VaultProto,
} from "@cryptex-industries/vault-core/proto";
import { Vault } from "@cryptex-industries/vault-core/vault-utils/vault";
import { VaultMetadata } from "@/app_lib/vault-utils/storage";
import { UnlockTab } from "@/components/vault-manager/unlock-tab";
import {
    unlockedVaultAtom,
    unlockedVaultMetadataAtom,
    vaultStore,
} from "@/utils/atoms";
import {
    clearVaultDEKFromSession,
    getVaultDEKFromSession,
    getVaultSessionGeneration,
    setVaultDEKInSessionForMetadata,
} from "@/utils/vault-session";
import { isVaultTimeoutSessionActive } from "@/utils/session-timeout";
import { isSecureDekEnrolled, unlockWithSecureDek } from "@/lib/secure-dek";

jest.mock("react-native", () => ({
    View: "View",
    Pressable: "Pressable",
    Alert: { alert: jest.fn() },
    Platform: { OS: "ios" },
}));
jest.mock("expo-router", () => ({
    router: { replace: jest.fn() },
    useFocusEffect: (callback: () => void) => {
        const { useEffect } =
            jest.requireActual<typeof import("react")>("react");
        useEffect(callback, [callback]);
    },
}));
jest.mock("lucide-react-native", () => ({
    ChevronDown: "ChevronDown",
    Fingerprint: "Fingerprint",
    Inbox: "Inbox",
    LockKeyhole: "LockKeyhole",
}));
jest.mock("@/app_lib/vault-utils/storage", () => ({
    VaultMetadata: class {},
    listVaults: async () => [mockMetadata, mockOtherMetadata],
    deleteVault: jest.fn(),
}));
jest.mock("@/utils/atoms", () => {
    const { atom, createStore } =
        jest.requireActual<typeof import("jotai")>("jotai");
    return {
        unlockedVaultAtom: atom(null),
        unlockedVaultMetadataAtom: atom(null),
        vaultStore: createStore(),
    };
});
jest.mock("@/utils/auto-lock-settings", () => ({
    getCachedAutoLockMinutes: () => 5,
}));
jest.mock("@/utils/android-credentials", () => ({
    androidCredentials: {
        available: false,
        clearProviderCredentials: jest.fn(),
    },
}));
jest.mock("@/lib/secure-dek", () => ({
    clearSecureDek: jest.fn(),
    isBiometricAvailable: async () => true,
    isSecureDekEnrolled: jest.fn(),
    unlockWithSecureDek: jest.fn(),
}));
jest.mock("@/app_lib/vault-utils/vault-key-store", () => ({
    clearDeviceAdditionalKeyProtection: jest.fn(),
}));
jest.mock("@/utils/clipboard", () => ({
    clearPendingSecretFromClipboard: jest.fn(),
}));
jest.mock(
    "@cryptex-industries/vault-core/vault-utils/envelope-encryption",
    () => ({
        isEnvelopeBlob: () => true,
        decryptWithDEK: async () => ok(VaultProto.encode(new Vault()).finish()),
    }),
);
jest.mock("@cryptex-industries/vault-core/vault-utils/sync-signing", () => ({
    ensureSyncSigningKeypair: async () => mockGeneratedKeys,
}));
jest.mock(
    "@cryptex-industries/vault-core/vault-utils/post-quantum-kem",
    () => ({ ensureSyncKemKeypair: async () => false }),
);
jest.mock("@/components/ui/button", () => ({ Button: "Button" }));
jest.mock("@/components/ui/input", () => ({ Input: "Input" }));
jest.mock("@/components/ui/label", () => ({ Label: "Label" }));
jest.mock("@/components/ui/text", () => ({ Text: "Text" }));
jest.mock("@/components/ui/icon", () => ({ Icon: "Icon" }));
jest.mock("@/components/inline-notice", () => ({ InlineNotice: "Notice" }));
jest.mock("@/components/empty-state", () => ({ EmptyState: "EmptyState" }));
jest.mock("@/components/ui/dialog", () => ({
    Dialog: "Dialog",
    DialogDescription: "DialogDescription",
    DialogFooter: "DialogFooter",
    DialogHeader: "DialogHeader",
    DialogTitle: "DialogTitle",
}));
jest.mock("@/components/vault/password-strength-meter", () => ({
    PasswordStrengthMeter: "PasswordStrengthMeter",
}));
jest.mock(
    "@/components/vault-security/additional-key-protection-options",
    () => ({
        AdditionalKeyProtectionOptions: "ProtectionOptions",
        choiceToSource: jest.fn(),
        isProtectionPhraseKind: () => false,
    }),
);
jest.mock("@/components/vault-security/secret-reveal", () => ({
    SecretReveal: "SecretReveal",
}));
jest.mock("@/components/vault-entry-ui", () => ({
    VaultEntryAction: "Action",
    VaultEntryAssurance: "Assurance",
    VaultEntryFieldError: "FieldError",
    VaultEntryTextButton: "TextButton",
}));
jest.mock("@/components/keyboard-scroll", () => ({
    useScrollToNode: () => jest.fn(),
}));

const mockSave = jest.fn<(...args: unknown[]) => Promise<void>>();
const mockMetadata = Object.assign(new VaultMetadata(), {
    DBIndex: 7,
    Name: "Stored vault",
    Description: "",
    Blob: EncryptedBlob.fromPartial({
        Blob: new Uint8Array([1]),
        HeaderIV: "Ag==",
    }),
    save: mockSave,
});
const mockOtherMetadata = Object.assign(new VaultMetadata(), {
    DBIndex: 8,
    Name: "Second vault",
    Description: "",
    Blob: EncryptedBlob.fromPartial({
        Blob: new Uint8Array([2]),
        HeaderIV: "Aw==",
    }),
    save: mockSave,
});
let mockDek: CryptoKey;
let mockOtherDek: CryptoKey;
let mockGeneratedKeys = true;
let renderer: ReactTestRenderer | undefined;
const originalAnimationFrame = Object.getOwnPropertyDescriptor(
    globalThis,
    "requestAnimationFrame",
);

beforeEach(async () => {
    Object.defineProperty(globalThis, "requestAnimationFrame", {
        configurable: true,
        value: (callback: (time: number) => void) => {
            callback(0);
            return 0;
        },
    });
    Object.assign(globalThis, {
        IS_REACT_ACT_ENVIRONMENT: true,
        IS_REACT_NATIVE_TEST_ENVIRONMENT: true,
    });
    mockDek = await crypto.subtle.importKey(
        "raw",
        new Uint8Array(32),
        "AES-GCM",
        false,
        ["encrypt", "decrypt"],
    );
    mockOtherDek = await crypto.subtle.importKey(
        "raw",
        new Uint8Array(32).fill(1),
        "AES-GCM",
        false,
        ["encrypt", "decrypt"],
    );
    jest.mocked(unlockWithSecureDek)
        .mockReset()
        .mockImplementation(async (index) =>
            index === 7 ? mockDek : index === 8 ? mockOtherDek : null,
        );
    jest.mocked(isSecureDekEnrolled).mockReset().mockResolvedValue(true);
    clearVaultDEKFromSession();
    vaultStore.set(unlockedVaultMetadataAtom, null);
    mockSave.mockReset().mockResolvedValue(undefined);
    mockGeneratedKeys = true;
    jest.spyOn(Vault.prototype, "upgrade").mockResolvedValue(undefined);
    await act(async () => {
        renderer = create(
            createElement(
                Provider,
                { store: vaultStore },
                createElement(UnlockTab),
            ),
        );
    });
});
afterEach(async () => {
    await act(async () => renderer?.unmount());
    renderer = undefined;
    clearVaultDEKFromSession();
    jest.restoreAllMocks();
    if (originalAnimationFrame)
        Object.defineProperty(
            globalThis,
            "requestAnimationFrame",
            originalAnimationFrame,
        );
    else Reflect.deleteProperty(globalThis, "requestAnimationFrame");
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
    Reflect.deleteProperty(globalThis, "IS_REACT_NATIVE_TEST_ENVIRONMENT");
});
async function pressBiometric() {
    if (!renderer) throw new Error("Unlock screen is not mounted.");
    await act(async () =>
        renderer?.root
            .findByProps({ accessibilityLabel: "Unlock with biometrics" })
            .props.onPress(),
    );
}

it("keeps the biometric key out of the active session when sync-key persistence fails", async () => {
    const generation = getVaultSessionGeneration();
    mockSave.mockRejectedValueOnce(new Error("disk full"));
    await pressBiometric();
    expect(mockSave).toHaveBeenCalledWith(expect.any(Vault), mockDek);
    expect(getVaultDEKFromSession().isErr()).toBe(true);
    expect(getVaultSessionGeneration()).toBe(generation);
    expect(isVaultTimeoutSessionActive()).toBe(false);
    expect(vaultStore.get(unlockedVaultMetadataAtom)).toBeNull();
    expect(router.replace).not.toHaveBeenCalled();
    expect(
        renderer?.root
            .findAllByType("Notice" as never)
            .some(
                (node) =>
                    node.props.message ===
                    "Unlocked, but failed to persist sync keys.",
            ),
    ).toBe(true);
});

it("installs the biometric session only after the generated keys are saved", async () => {
    const generation = getVaultSessionGeneration();
    let finishSave: (() => void) | undefined;
    mockSave.mockImplementationOnce(
        () =>
            new Promise<void>((resolve) => {
                finishSave = resolve;
            }),
    );
    await pressBiometric();
    expect(mockSave).toHaveBeenCalledWith(expect.any(Vault), mockDek);
    expect(getVaultDEKFromSession().isErr()).toBe(true);
    expect(getVaultSessionGeneration()).toBe(generation);
    expect(isVaultTimeoutSessionActive()).toBe(false);
    expect(vaultStore.get(unlockedVaultMetadataAtom)).toBeNull();
    expect(router.replace).not.toHaveBeenCalled();
    if (!finishSave) throw new Error("Sync-key save has not started.");
    await act(async () => finishSave?.());
    const key = getVaultDEKFromSession();
    expect(key.isOk() && key.value).toBe(mockDek);
    expect(getVaultSessionGeneration()).toBe(generation + 1);
    expect(isVaultTimeoutSessionActive()).toBe(true);
    expect(vaultStore.get(unlockedVaultMetadataAtom)).toBe(mockMetadata);
    expect(vaultStore.get(unlockedVaultAtom)).toBeInstanceOf(Vault);
    expect(router.replace).toHaveBeenCalledWith("/(app)/(tabs)/vault");
});

it("opens the biometric session without saving when synchronization keys already exist", async () => {
    mockGeneratedKeys = false;
    await pressBiometric();
    expect(mockSave).not.toHaveBeenCalled();
    const key = getVaultDEKFromSession();
    expect(key.isOk() && key.value).toBe(mockDek);
    expect(vaultStore.get(unlockedVaultMetadataAtom)).toBe(mockMetadata);
    expect(router.replace).toHaveBeenCalledWith("/(app)/(tabs)/vault");
});

it("keeps biometric unlock available when the enrolled vault is selected again", async () => {
    mockGeneratedKeys = false;
    await act(async () => {
        renderer?.root
            .findByProps({
                accessibilityLabel:
                    "Selected vault Stored vault. Choose another vault",
            })
            .props.onPress();
    });
    await act(async () => {
        renderer?.root
            .findByProps({ accessibilityLabel: "Select vault Stored vault" })
            .props.onPress();
    });
    expect(
        renderer?.root.findAllByProps({
            accessibilityLabel: "Unlock with biometrics",
        }),
    ).toHaveLength(1);
    await pressBiometric();
    expect(unlockWithSecureDek).toHaveBeenCalledWith(7);
    const key = getVaultDEKFromSession();
    expect(key.isOk() && key.value).toBe(mockDek);
    expect(vaultStore.get(unlockedVaultMetadataAtom)).toBe(mockMetadata);
    expect(router.replace).toHaveBeenCalledWith("/(app)/(tabs)/vault");
});

it("unlocks each selected vault with its own enrolled key", async () => {
    mockGeneratedKeys = false;
    await pressBiometric();
    expect(unlockWithSecureDek).toHaveBeenNthCalledWith(1, 7);
    const firstKey = getVaultDEKFromSession();
    expect(firstKey.isOk() && firstKey.value).toBe(mockDek);
    clearVaultDEKFromSession();
    await act(async () => {
        renderer?.root
            .findByProps({ accessibilityLabel: "Select vault Second vault" })
            .props.onPress();
    });
    await pressBiometric();
    expect(unlockWithSecureDek).toHaveBeenNthCalledWith(2, 8);
    const secondKey = getVaultDEKFromSession();
    expect(secondKey.isOk() && secondKey.value).toBe(mockOtherDek);
    expect(vaultStore.get(unlockedVaultMetadataAtom)).toBe(mockOtherMetadata);
});

it("ignores A's enrollment check after selecting unenrolled B", async () => {
    let finishEnrollmentCheck: ((enrolled: boolean) => void) | undefined;
    jest.mocked(isSecureDekEnrolled).mockImplementation(async (index) => {
        if (index === 8) return false;
        return new Promise<boolean>((resolve) => {
            finishEnrollmentCheck = resolve;
        });
    });
    for (const name of ["Second vault", "Stored vault", "Second vault"]) {
        await act(async () => {
            renderer?.root
                .findByProps({ accessibilityLabel: `Select vault ${name}` })
                .props.onPress();
        });
    }
    if (!finishEnrollmentCheck)
        throw new Error("Enrollment check has not started.");
    await act(async () => finishEnrollmentCheck?.(true));
    expect(
        renderer?.root.findAllByProps({
            accessibilityLabel: "Unlock with biometrics",
        }),
    ).toHaveLength(0);
});

it("hides biometric unlock when the selected vault's enrollment check fails", async () => {
    jest.mocked(isSecureDekEnrolled).mockRejectedValueOnce(
        new Error("keychain unavailable"),
    );
    await act(async () => {
        renderer?.root
            .findByProps({ accessibilityLabel: "Select vault Second vault" })
            .props.onPress();
    });
    expect(
        renderer?.root.findAllByProps({
            accessibilityLabel: "Unlock with biometrics",
        }),
    ).toHaveLength(0);
    expect(
        renderer?.root.findByProps({
            accessibilityLabel:
                "Selected vault Second vault. Choose another vault",
        }),
    ).toBeDefined();
});

it("keeps A selected while its biometric unlock is busy", async () => {
    let finishSave: (() => void) | undefined;
    mockSave.mockImplementationOnce(
        () =>
            new Promise<void>((resolve) => {
                finishSave = resolve;
            }),
    );
    await pressBiometric();
    if (!renderer) throw new Error("Unlock screen is not mounted.");
    const picker = renderer.root.findByProps({
        accessibilityLabel: "Selected vault Stored vault. Choose another vault",
    });
    const otherVault = renderer.root.findByProps({
        accessibilityLabel: "Select vault Second vault",
    });
    expect(picker.props.disabled).toBe(true);
    expect(otherVault.props.disabled).toBe(true);
    await act(async () => {
        picker.props.onPress();
        otherVault.props.onPress();
    });
    expect(
        renderer.root.findByProps({
            accessibilityLabel:
                "Selected vault Stored vault. Choose another vault",
        }),
    ).toBeDefined();
    expect(
        renderer.root
            .findAllByType("Dialog" as never)
            .every((dialog) => !dialog.props.open),
    ).toBe(true);
    expect(getVaultDEKFromSession().isErr()).toBe(true);
    if (!finishSave) throw new Error("Sync-key save has not started.");
    await act(async () => finishSave?.());
    const key = getVaultDEKFromSession();
    expect(key.isOk() && key.value).toBe(mockDek);
    expect(vaultStore.get(unlockedVaultMetadataAtom)).toBe(mockMetadata);
    expect(router.replace).toHaveBeenCalledWith("/(app)/(tabs)/vault");
});

it.each(["session replacement", "lock", "unmount"])(
    "does not publish a saved biometric vault after %s",
    async (interruption) => {
        let finishSave: (() => void) | undefined;
        mockSave.mockImplementationOnce(
            () =>
                new Promise<void>((resolve) => {
                    finishSave = resolve;
                }),
        );
        await pressBiometric();
        expect(mockSave).toHaveBeenCalledWith(expect.any(Vault), mockDek);

        const replacementVault = new Vault();
        const replacementMetadata = Object.assign(new VaultMetadata(), {
            DBIndex: 8,
            Name: "New session",
        });
        const replacementKey = await crypto.subtle.importKey(
            "raw",
            new Uint8Array(32).fill(1),
            "AES-GCM",
            false,
            ["encrypt", "decrypt"],
        );
        if (interruption === "session replacement") {
            setVaultDEKInSessionForMetadata(
                replacementMetadata,
                replacementKey,
            );
            await act(async () => {
                vaultStore.set(unlockedVaultAtom, replacementVault);
                vaultStore.set(unlockedVaultMetadataAtom, replacementMetadata);
            });
        } else if (interruption === "lock") {
            clearVaultDEKFromSession();
        } else {
            await act(async () => renderer?.unmount());
            renderer = undefined;
        }
        const generation = getVaultSessionGeneration();
        const metadata = vaultStore.get(unlockedVaultMetadataAtom);
        const vault = vaultStore.get(unlockedVaultAtom);
        if (!finishSave) throw new Error("Sync-key save has not started.");
        await act(async () => finishSave?.());

        const key = getVaultDEKFromSession();
        if (interruption === "session replacement") {
            expect(key.isOk() && key.value).toBe(replacementKey);
        } else {
            expect(key.isErr()).toBe(true);
            expect(isVaultTimeoutSessionActive()).toBe(false);
        }
        expect(getVaultSessionGeneration()).toBe(generation);
        expect(vaultStore.get(unlockedVaultMetadataAtom)).toBe(metadata);
        expect(vaultStore.get(unlockedVaultAtom)).toBe(vault);
        expect(router.replace).not.toHaveBeenCalled();
    },
);
