import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    jest,
} from "@jest/globals";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { Provider } from "jotai";
import {
    Vault,
    VaultCredential,
} from "@cryptex-industries/vault-core/vault-utils/vault";
import { ItemType } from "@cryptex-industries/vault-core/proto";
import CredentialRequestScreen from "../app/credential-request";
import {
    vaultStore,
    unlockedVaultAtom,
    unlockedVaultMetadataAtom,
} from "@/utils/atoms";
import {
    clearVaultDEKFromSession,
    setVaultDEKInSession,
} from "@/utils/vault-session";
import { lockUnlockedVault, vaultLockStateAtom } from "@/utils/vault-lock";
import {
    resetClipboardStateForTests,
    getPendingClipboardSecretForTests,
} from "@/utils/clipboard";
const mockListeners = new Set<(s: string) => void>();
const mockRequest = {
    id: "request-1",
    kind: "autofill-get",
    webDomain: "example.com",
    webScheme: "https",
    packageName: "com.android.chrome",
};
const mockCompleted: Array<{
    username: string;
    password: string;
    lockState: string;
}> = [];
let mockLoadSetting = async () => true;
jest.mock("react-native", () => ({
    View: "View",
    Pressable: "Pressable",
    ActivityIndicator: "ActivityIndicator",
    AppState: {
        currentState: "active",
        addEventListener: (_event: string, cb: (s: string) => void) => {
            mockListeners.add(cb);
            return { remove: () => mockListeners.delete(cb) };
        },
    },
}));
jest.mock("expo-router", () => ({
    Redirect: "Redirect",
    router: { replace: jest.fn() },
    useFocusEffect: (callback: () => void) => {
        const { useEffect } = require("react");
        useEffect(callback, [callback]);
    },
}));
jest.mock("expo-router/react-navigation", () => ({ useIsFocused: () => true }));
jest.mock("expo-local-authentication", () => ({
    authenticateAsync: async () => ({ success: true }),
}));
jest.mock("lucide-react-native", () => ({
    Fingerprint: "Fingerprint",
    Plus: "Plus",
}));
jest.mock("@/components/unlocked/unlocked-ui", () => ({
    UnlockedButton: "Button",
    UnlockedText: "Text",
}));
jest.mock("@/components/inline-notice", () => ({ InlineNotice: "Notice" }));
jest.mock("@/components/vault/credential-form", () => ({
    CredentialForm: "CredentialForm",
}));
jest.mock("@/components/unlocked/confirmation-sheet", () => ({
    UnlockedConfirmationProvider: "ConfirmationProvider",
}));
jest.mock("@/components/autofill/request-ui", () => ({
    AssociationConsentScreen: "AssociationConsentScreen",
    AutofillPicker: "AutofillPicker",
    AutofillRequestShell: "AutofillRequestShell",
    FillDecisionScreen: "FillDecisionScreen",
    RequestDestination: "RequestDestination",
    SaveFailureSheet: "SaveFailureSheet",
}));
jest.mock("@/utils/vault-mutations", () => ({
    persistVaultMutation: jest.fn(),
}));
const mockRevoked: string[] = [];
jest.mock("@/utils/android-credentials", () => ({
    androidCredentials: {
        available: false,
        clearProviderCredentials: jest.fn(),
        revokeProviderSession: () => {
            const { vaultStore } = require("@/utils/atoms");
            const { vaultLockStateAtom } = require("@/utils/vault-lock");
            mockRevoked.push(vaultStore.get(vaultLockStateAtom));
        },
        getPendingRequest: () => mockRequest,
        addCredentialRequestListener: () => ({ remove: () => {} }),
        completeAutofill: (
            _id: string,
            username: string,
            _email: string,
            password: string,
        ) => {
            const { vaultStore } = require("@/utils/atoms");
            const { vaultLockStateAtom } = require("@/utils/vault-lock");
            mockCompleted.push({
                username,
                password,
                lockState: vaultStore.get(vaultLockStateAtom),
            });
            return true;
        },
        dismissRequest: jest.fn(),
    },
}));
jest.mock("@/utils/autofill-settings", () => ({
    loadAutoCopyTotp: () => mockLoadSetting(),
}));
jest.mock("@/utils/auto-lock-settings", () => ({
    getCachedAutoLockMinutes: () => 0,
}));
jest.mock("@/hooks/use-auto-lock", () => ({
    isAutoLockDue: () => {
        const m = jest.requireActual("@/utils/session-timeout") as any;
        return m.isAutoLockDue();
    },
    useAutoLock: () => ({ onInteraction: () => {} }),
}));
jest.mock("@/app_lib/auth-session", () => ({
    logoutOnlineServicesSession: async () => {},
}));
jest.mock("@/app_lib/managed-backup-hooks", () => ({
    flushManagedBackupBeforeLock: async () => {},
    stopManagedBackup: () => {},
}));
jest.mock("@/utils/active-sync-controllers", () => ({
    teardownActiveSyncControllers: () => {},
}));
jest.mock("@/utils/secret-temp-files", () => ({
    purgeSecretTempFiles: async () => {},
}));
jest.mock("@/utils/logging", () => ({
    vaultLog: { error: jest.fn() },
    vaultLogger: { clearAll: jest.fn() },
    passkeyLog: { info: jest.fn(), error: jest.fn() },
}));
let renderer: ReactTestRenderer | undefined;
let metadata: any;
let credential: VaultCredential;
const settle = async () => {
    await act(async () => {
        await new Promise((r) => setTimeout(r, 5));
    });
};
function held<T>() {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((r) => (resolve = r));
    return { promise, resolve };
}
function lock() {
    return lockUnlockedVault({
        unlockedVaultMetadata: metadata,
        setUnlockedVault: (v: any) => {
            if (typeof v !== "function") vaultStore.set(unlockedVaultAtom, v);
        },
        setUnlockedVaultMetadata: (m: any) =>
            vaultStore.set(unlockedVaultMetadataAtom, m),
    });
}
async function render() {
    await act(async () => {
        renderer = create(
            createElement(
                Provider,
                { store: vaultStore },
                createElement(CredentialRequestScreen),
            ),
        );
    });
}
async function choose() {
    await act(async () =>
        renderer!.root
            .findByType("AutofillPicker" as never)
            .props.onChoose(credential),
    );
    const review = renderer!.root.findAllByType("FillDecisionScreen" as never);
    if (review.length) await act(async () => review[0].props.onFillOnce());
}
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    mockCompleted.length = 0;
    mockRevoked.length = 0;
    mockLoadSetting = async () => true;
    resetClipboardStateForTests();
    clearVaultDEKFromSession();
    setVaultDEKInSession({ type: "secret" } as CryptoKey);
    vaultStore.set(vaultLockStateAtom, "idle");
    credential = Object.assign(new VaultCredential(), {
        ID: "credential-a",
        Type: ItemType.Credentials,
        Name: "Vault A login",
        Username: "alice-a",
        Password: "vault-A-password",
        URL: "https://example.com",
        TOTP: {
            Secret: "JBSWY3DPEHPK3PXP",
            Period: 30,
            Digits: 6,
            Algorithm: 0,
        },
    });
    const vault = new Vault();
    vault.Credentials = [credential];
    metadata = { Blob: {}, save: async () => {} };
    vaultStore.set(unlockedVaultAtom, vault);
    vaultStore.set(unlockedVaultMetadataAtom, metadata);
});
afterEach(async () => {
    await act(async () => renderer?.unmount());
    renderer = undefined;
    resetClipboardStateForTests();
    clearVaultDEKFromSession();
});
describe("credential requests stop when a lock starts", () => {
    it("neither fills nor copies the TOTP once a manual lock starts, even while its save is pending", async () => {
        const setting = held<boolean>();
        let entered = false;
        mockLoadSetting = () => {
            entered = true;
            return setting.promise;
        };
        await render();
        await choose();
        expect(entered).toBe(true);
        const save = held<void>();
        metadata.save = () => save.promise;
        let locking!: ReturnType<typeof lock>;
        await act(async () => {
            locking = lock();
        });
        await settle();
        expect(vaultStore.get(vaultLockStateAtom)).toBe("locking");
        // The native provider stopped releasing before the save started.
        expect(mockRevoked).toEqual(["idle"]);
        await act(async () => setting.resolve(true));
        await settle();
        expect(mockCompleted).toEqual([]);
        expect(getPendingClipboardSecretForTests()).toBeNull();
        save.resolve();
        await act(async () => {
            await locking;
        });
    });
    it("does not complete a fill that resumes after the request screen unmounted", async () => {
        const setting = held<boolean>();
        let entered = false;
        mockLoadSetting = () => {
            entered = true;
            return setting.promise;
        };
        await render();
        await choose();
        expect(entered).toBe(true);
        await act(async () => renderer!.unmount());
        renderer = undefined;
        await act(async () => setting.resolve(true));
        await settle();
        expect(mockCompleted).toEqual([]);
        expect(getPendingClipboardSecretForTests()).toBeNull();
    });
    it("does not complete a fill begun before a lock, even after the vault unlocks again", async () => {
        const setting = held<boolean>();
        mockLoadSetting = () => setting.promise;
        await render();
        await choose();
        await act(async () => {
            await lock();
        });
        await act(async () =>
            setVaultDEKInSession({ type: "secret" } as CryptoKey),
        );
        const vault = new Vault();
        vault.Credentials = [credential];
        await act(async () => {
            vaultStore.set(unlockedVaultAtom, vault);
            vaultStore.set(unlockedVaultMetadataAtom, metadata);
        });
        await act(async () => setting.resolve(true));
        await settle();
        expect(mockCompleted).toEqual([]);
    });
    it("fills and copies the TOTP while the session lasts", async () => {
        await render();
        await choose();
        await settle();
        expect(mockCompleted).toEqual([
            {
                username: "alice-a",
                password: "vault-A-password",
                lockState: "idle",
            },
        ]);
        expect(getPendingClipboardSecretForTests()).toMatch(/^\d{6}$/);
    });
});
