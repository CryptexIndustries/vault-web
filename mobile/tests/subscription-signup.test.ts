import { afterEach, beforeEach, expect, it, jest } from "@jest/globals";
import { createElement } from "react";
import { randomUUID } from "node:crypto";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { Provider } from "jotai";
import { err, ok } from "neverthrow";
import * as Sharing from "expo-sharing";
import { router } from "expo-router";
import {
    OnlineServices,
    Vault,
} from "@cryptex-industries/vault-core/vault-utils/vault";

import { SubscriptionSignup } from "@/components/account/subscription-signup";
import { RecoveryKitDialog } from "@/components/account/recovery-kit-dialog";
import type { PaymentStatusState } from "@/components/account/payment-status";
import {
    AccountControllerProvider,
    useAccountController,
} from "@/components/account/account-controller";
import { copySecretToClipboard } from "@/utils/clipboard";
import {
    onlineServicesAuthConnectionStatusAtom,
    onlineServicesDataAtom,
    onlineServicesStore,
    unlockedVaultAtom,
    vaultStore,
} from "@/utils/atoms";

jest.mock("react-native", () => ({
    useWindowDimensions: () => ({ fontScale: 1 }),
    View: "View",
    Pressable: "Pressable",
    Platform: { OS: "android" },
    AccessibilityInfo: {},
    Alert: { alert: jest.fn() },
}));
jest.mock("lucide-react-native", () => ({ Check: "Check", X: "X" }));
jest.mock("expo-router", () => ({
    router: { push: jest.fn(), dismissTo: jest.fn() },
}));
jest.mock("expo-router/react-navigation", () => ({
    usePreventRemove: (enabled: boolean, leave: () => void) => {
        mockNavigationGuard = enabled;
        mockLeave = leave;
    },
}));
jest.mock("@/components/unlocked/unlocked-ui", () => ({
    UnlockedButton: "Button",
    UnlockedCheckbox: "Checkbox",
    UnlockedDialogTitle: "DialogTitle",
    UnlockedText: "Text",
}));
jest.mock("@/components/ui/dialog", () => ({
    Dialog: ({
        open,
        children,
        footer,
        ...props
    }: {
        open: boolean;
        children: React.ReactNode;
        footer?: React.ReactNode;
    }) => (open ? createElement("Dialog", props, children, footer) : null),
    DialogContent: "DialogContent",
    DialogDescription: "DialogDescription",
    DialogFooter: "DialogFooter",
    DialogHeader: "DialogHeader",
}));
jest.mock("@/components/inline-notice", () => ({ InlineNotice: "Notice" }));
jest.mock("@/components/account/payment-status", () => ({
    PaymentStatus: "PaymentStatus",
}));
jest.mock("@/components/account/membership-benefits", () => ({
    MembershipBenefits: "MembershipBenefits",
}));
jest.mock("@/components/account/turnstile-challenge", () => ({
    useTurnstileTokenRequest: () => ({
        requestToken: mockRequestToken,
        dialog: null,
    }),
}));
jest.mock("@/components/account/device-topology", () => ({
    buildDeviceRelationshipMap: () => ({}),
}));
jest.mock("@/utils/online-services-api-url", () => ({
    isCloudServicesEnabled: () => true,
}));
jest.mock("@/utils/atoms", () => {
    const { atom, createStore } =
        jest.requireActual<typeof import("jotai")>("jotai");
    const onlineServicesDataAtom = atom(null);
    const onlineServicesStore = createStore();
    return {
        onlineServicesDataAtom,
        onlineServicesStore,
        unlockedVaultAtom: atom({ OnlineServices: null }),
        vaultStore: createStore(),
        onlineServicesAuthConnectionStatusAtom: atom({
            statusDescription: "Connected",
        }),
        onlineServicesAuthenticationStatus: {
            disconnected: () => ({ statusDescription: "Disconnected" }),
        },
        setOnlineServicesData: (value: never) =>
            onlineServicesStore.set(onlineServicesDataAtom, value),
    };
});
jest.mock("@cryptex-industries/vault-core/vault-utils/vault", () => ({
    Vault: class {
        static isOnlineServicesBound(vault: { OnlineServices?: unknown }) {
            return !!vault.OnlineServices;
        }
        static bindOnlineServices(
            vault: { OnlineServices?: unknown },
            binding: unknown,
        ) {
            vault.OnlineServices = binding;
        }
        static unbindOnlineServices(vault: { OnlineServices?: unknown }) {
            vault.OnlineServices = null;
        }
    },
    OnlineServices: class {
        constructor(
            public DeviceId: string,
            public UserID: string,
            public PublicKeyJWK: string,
            public PrivateKeyJWK: string,
        ) {}
    },
}));
jest.mock(
    "@cryptex-industries/vault-core/vault-utils/device-signing-key",
    () => ({
        generateKeyPair: async () => ({ publicKey: {}, privateKey: {} }),
        publicKeyJwkToString: () => "test-public-key",
        privateKeyJwkToString: () => "test-private-key",
        parseJwkFromString: () => ({}),
        signChallenge: async () => "test-signature",
    }),
);
jest.mock("@/utils/vault-mutations", () => ({
    persistVaultMutation: (...args: unknown[]) => mockPersist(...args),
}));
jest.mock("@/utils/vault-session", () => ({
    getVaultSessionGeneration: () => mockVaultGeneration,
    isSameActiveVaultSession: (generation: number) =>
        generation === mockVaultGeneration,
    captureVaultSession: () => ({
        generation: mockVaultGeneration,
        lockEpoch: 0,
    }),
    isVaultSessionCurrent: (session: { generation: number }) =>
        session.generation === mockVaultGeneration,
    missingVaultSecretError: () => "Unlock the vault again.",
}));
jest.mock("@/utils/logging", () => ({
    onlineServicesLog: { error: jest.fn() },
}));
jest.mock("@/app_lib/auth-session", () => ({
    establishOnlineServicesSession: (...args: unknown[]) =>
        mockEstablish(...args),
    syncOnlineServicesRemoteConfiguration: () => mockSync(),
    logoutOnlineServicesSession: () => mockLogout(),
}));
jest.mock("@/app_lib/online-services-billing", () => ({
    storeBilling: () => (mockPlayBuild ? "google_play" : null),
    loadStorePlans: () => mockStorePlans(),
}));
jest.mock("@/utils/trpc", () => {
    const mutation = (mutateAsync: (...args: unknown[]) => unknown) => ({
        useMutation: () => ({ mutateAsync, isPending: false }),
    });
    const query = {
        useQuery: () => ({
            data: {
                root: mockRootDevice,
                nonFree: mockNonFree,
                trialEligible: mockTrialEligible,
            },
            refetch: mockRefetch,
            isFetching: false,
        }),
    };
    return {
        trpcReact: {
            v1: {
                auth: {
                    register: mutation((...args) => mockRegister(...args)),
                    recover: mutation((...args) => mockRecover(...args)),
                },
                user: {
                    configuration: query,
                    generateRecoveryToken: mutation(() =>
                        mockGenerateRecovery(),
                    ),
                    rotateRecoveryToken: mutation(() => mockRotateRecovery()),
                    delete: mutation((...args) => mockDeleteUser(...args)),
                    deleteChallenge: mutation(() => mockDeleteChallenge()),
                },
                payment: { subscription: query },
                device: {
                    topology: query,
                    remove: mutation(jest.fn()),
                    setRoot: mutation(jest.fn()),
                },
            },
        },
    };
});
jest.mock("expo-file-system/legacy", () => ({
    EncodingType: { UTF8: "utf8" },
}));
jest.mock("expo-sharing", () => ({
    isAvailableAsync: async () => true,
    shareAsync: jest.fn(),
}));
jest.mock("@/utils/clipboard", () => ({ copySecretToClipboard: jest.fn() }));
jest.mock("@/utils/secret-temp-files", () => ({
    writeSecretTempFile: jest.fn(),
    deleteAppOwnedTempFile: jest.fn(),
}));

const mockRequestToken = jest.fn<() => Promise<string | null>>();
const mockRegister = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockRecover = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockDeleteUser = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockDeleteChallenge = jest.fn<() => Promise<unknown>>();
const mockLogout = jest.fn<() => Promise<void>>();
const mockEstablish = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockSync = jest.fn<() => Promise<void>>();
const mockRefetch = jest.fn<() => Promise<unknown>>();
const mockGenerateRecovery = jest.fn<() => Promise<unknown>>();
const mockRotateRecovery = jest.fn<() => Promise<unknown>>();
/** onPay: the Account screen starts the purchase. */
const mockCheckout = jest.fn();
const mockPersist = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockClosed = jest.fn();
const mockStorePlans = jest.fn<() => Promise<unknown>>();
let mockPlayBuild = false;
let mockNavigationGuard = false;
let mockLeave: () => void = () => {};
let mockVaultGeneration = 1;
let mockRootDevice = false;
let mockNonFree = false;
let mockTrialEligible = false;
const paidTerms = { trialEligible: false, trial: false };
let renderer: ReactTestRenderer | undefined;
let mockRecoveryPhrase: string;
const originalFromBase64 = Object.getOwnPropertyDescriptor(
    Uint8Array,
    "fromBase64",
);

function ControllerHarness() {
    return createElement("Controller", { account: useAccountController() });
}

async function renderController() {
    await act(async () => {
        renderer = create(
            createElement(
                Provider,
                { store: vaultStore },
                createElement(
                    AccountControllerProvider,
                    null,
                    createElement(ControllerHarness),
                ),
            ),
        );
    });
}

function account(): ReturnType<typeof useAccountController> {
    if (!renderer) throw new Error("Controller is not mounted.");
    return renderer.root.findByType("Controller" as never).props.account;
}

function replaceVaultSession() {
    mockVaultGeneration += 1;
    const vault = Object.assign(new Vault(), {
        OnlineServices: new OnlineServices(
            "next-device",
            "next-user",
            "next-public",
            "next-private",
        ),
    });
    const session = {
        deviceId: "next-device",
        sessionToken: randomUUID(),
        remoteData: null,
    };
    const status = {
        status: "CONNECTED" as const,
        statusDescription: "Connected to next vault",
    };
    vaultStore.set(unlockedVaultAtom, vault);
    onlineServicesStore.set(onlineServicesDataAtom, session);
    onlineServicesStore.set(onlineServicesAuthConnectionStatusAtom, status);
    return { vault, session, status };
}

function expectCurrentSession(next: ReturnType<typeof replaceVaultSession>) {
    expect(vaultStore.get(unlockedVaultAtom)).toBe(next.vault);
    expect(onlineServicesStore.get(onlineServicesDataAtom)).toBe(next.session);
    expect(
        onlineServicesStore.get(onlineServicesAuthConnectionStatusAtom),
    ).toBe(next.status);
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((r) => {
        resolve = r;
    });
    return { promise, resolve };
}

async function renderSignup(
    open = true,
    payment: { state: PaymentStatusState; trial?: boolean } | null = null,
) {
    await act(async () => {
        const tree = createElement(
            Provider,
            { store: vaultStore },
            createElement(SubscriptionSignup, {
                open,
                onOpenChange: mockClosed,
                payment,
                paymentPanel:
                    payment && payment.state !== "offerChanged"
                        ? createElement("PaymentPanel")
                        : null,
                onPay: mockCheckout,
            }),
        );
        if (renderer) renderer.update(tree);
        else renderer = create(tree);
    });
}

function button(label: string) {
    return renderer!.root
        .findAllByType("Button" as never)
        .find(
            (node) =>
                (Array.isArray(node.props.children)
                    ? node.props.children.join("")
                    : node.props.children) === label,
        )!;
}

async function press(label: string) {
    const target = button(label);
    expect(target).toBeDefined();
    expect(target.props.disabled).not.toBe(true);
    await act(async () => target.props.onPress());
}

async function chooseYearly() {
    await act(async () => {
        renderer!.root
            .findAllByType("Pressable" as never)
            .find((node) => node.props.accessibilityLabel.startsWith("Yearly"))!
            .props.onPress();
    });
}

beforeEach(() => {
    mockPlayBuild = false;
    mockStorePlans.mockReset().mockResolvedValue([
        { tier: "premiumMonthly", price: "$4.99", trial: false },
        { tier: "premiumYearly", price: "$49.99", trial: false },
    ]);
    Object.defineProperty(Uint8Array, "fromBase64", {
        configurable: true,
        value: (value: string) => Uint8Array.from(Buffer.from(value, "base64")),
    });
    (
        globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    (
        globalThis as { IS_REACT_NATIVE_TEST_ENVIRONMENT?: boolean }
    ).IS_REACT_NATIVE_TEST_ENVIRONMENT = true;
    mockRecoveryPhrase = Array.from(
        { length: 24 },
        (_, index) => `example${index}`,
    ).join(" ");
    vaultStore.set(unlockedVaultAtom, { OnlineServices: null } as never);
    onlineServicesStore.set(onlineServicesDataAtom, null);
    mockRequestToken.mockReset().mockResolvedValue(randomUUID());
    mockRegister
        .mockReset()
        .mockResolvedValue({ deviceId: "device-test", userId: "user-test" });
    mockRecover.mockReset().mockResolvedValue({ deviceId: "recovered-device" });
    mockDeleteUser.mockReset().mockResolvedValue(true);
    mockDeleteChallenge.mockReset().mockResolvedValue({
        challengeId: "challenge-test",
        challenge: "AQ==",
    });
    mockLogout.mockReset().mockResolvedValue(undefined);
    mockEstablish.mockReset().mockImplementation(async () => {
        onlineServicesStore.set(onlineServicesDataAtom, {
            sessionToken: randomUUID(),
            remoteData: { recoveryGenerationNeeded: true },
        } as never);
    });
    mockSync.mockReset().mockResolvedValue(undefined);
    mockRefetch.mockReset().mockResolvedValue({ data: {} });
    mockGenerateRecovery
        .mockReset()
        .mockResolvedValue({ userId: "user-test", token: mockRecoveryPhrase });
    mockRotateRecovery
        .mockReset()
        .mockResolvedValue({ userId: "user-test", token: mockRecoveryPhrase });
    mockCheckout.mockReset();
    mockPersist.mockReset().mockImplementation(async (_kind, mutate) => {
        const result = await (
            mutate as (vault: unknown) => Promise<{ vault: never }>
        )(vaultStore.get(unlockedVaultAtom));
        vaultStore.set(unlockedVaultAtom, result.vault);
        return ok(undefined);
    });
    jest.mocked(copySecretToClipboard).mockReset().mockResolvedValue(true);
    jest.mocked(Sharing.shareAsync).mockReset().mockResolvedValue(undefined);
    mockClosed.mockReset();
    mockNavigationGuard = false;
    mockVaultGeneration = 1;
    mockRootDevice = false;
    mockNonFree = false;
    mockTrialEligible = false;
});

afterEach(async () => {
    if (originalFromBase64)
        Object.defineProperty(Uint8Array, "fromBase64", originalFromBase64);
    else Reflect.deleteProperty(Uint8Array, "fromBase64");
    await act(async () => renderer?.unmount());
    renderer = undefined;
    delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
        .IS_REACT_ACT_ENVIRONMENT;
    delete (globalThis as { IS_REACT_NATIVE_TEST_ENVIRONMENT?: boolean })
        .IS_REACT_NATIVE_TEST_ENVIRONMENT;
});

it("starts with the interval picker and opens the chosen checkout only after saving and confirming the kit", async () => {
    await renderSignup();
    expect(mockRequestToken).not.toHaveBeenCalled();
    await chooseYearly();
    await press("Continue");
    expect(mockRequestToken).toHaveBeenCalledWith("auth_register");
    expect(mockRegister).toHaveBeenCalledTimes(1);
    expect(mockCheckout).not.toHaveBeenCalled();
    expect(renderer!.root.findAllByType("Checkbox" as never)).toHaveLength(0);
    expect(
        [
            ...renderer!.root.findAllByType("Text" as never),
            ...renderer!.root.findAllByType("DialogTitle" as never),
        ].filter((node) => node.props.children === "Save your Recovery Kit"),
    ).toHaveLength(1);
    expect(
        renderer!.root.findByType("DialogTitle" as never).props.children,
    ).toBe("Save your Recovery Kit");
    expect(button("Finish")).toBeUndefined();
    expect(mockNavigationGuard).toBe(true);
    expect(renderer!.root.findByType("Dialog" as never).props.dismissible).toBe(
        false,
    );
    expect(
        button("I've saved my kit. Continue to payment").props.disabled,
    ).toBe(true);
    await press("Copy Recovery Kit");
    expect(renderer!.root.findAllByType("Notice" as never)).toHaveLength(0);
    expect(
        renderer!.root
            .findAllByType("Text" as never)
            .find((node) => node.props.children === "Recovery Kit copied."),
    ).toBeDefined();
    await press("I've saved my kit. Continue to payment");
    expect(mockCheckout).toHaveBeenCalledWith("premiumYearly", paidTerms);
    // The kit is saved, so it leaves the screen as payment starts.
    expect(renderer!.root.findAllByType(RecoveryKitDialog)).toHaveLength(0);
    expect(mockClosed).not.toHaveBeenCalled();
});

it("keeps the selected interval after captcha cancellation", async () => {
    mockRequestToken.mockResolvedValueOnce(null);
    await renderSignup();
    await chooseYearly();
    await press("Continue");
    expect(mockRegister).not.toHaveBeenCalled();
    expect(mockClosed).not.toHaveBeenCalled();
    expect(renderer!.root.findAllByType("Notice" as never)).toHaveLength(0);
    await press("Continue");
    await press("Copy Recovery Kit");
    await press("I've saved my kit. Continue to payment");
    expect(mockCheckout).toHaveBeenCalledWith("premiumYearly", paidTerms);
});

it.each(["session", "configuration", "recovery"])(
    "resumes a bound account after %s fails without creating another account",
    async (step) => {
        const failed = new Error("Temporary service failure");
        if (step === "session") mockEstablish.mockRejectedValueOnce(failed);
        if (step === "configuration") mockSync.mockRejectedValueOnce(failed);
        if (step === "recovery")
            mockGenerateRecovery.mockRejectedValueOnce(failed);
        await renderSignup();
        await chooseYearly();
        await press("Continue");
        expect(mockCheckout).not.toHaveBeenCalled();
        expect(mockNavigationGuard).toBe(false);
        expect(
            renderer!.root.findByType("Dialog" as never).props.dismissible,
        ).toBe(true);
        await press("Continue");
        expect(mockRegister).toHaveBeenCalledTimes(1);
        expect(mockRequestToken).toHaveBeenCalledTimes(1);
        await press("Copy Recovery Kit");
        await press("I've saved my kit. Continue to payment");
        expect(mockCheckout).toHaveBeenCalledWith("premiumYearly", paidTerms);
    },
);

it("can dismiss offline setup and resume the same bound account and interval", async () => {
    mockEstablish.mockRejectedValueOnce(new Error("Offline"));
    await renderSignup();
    await chooseYearly();
    await press("Continue");
    await renderSignup(false);
    expect(mockNavigationGuard).toBe(false);
    await renderSignup(true);
    await press("Continue");
    expect(mockRegister).toHaveBeenCalledTimes(1);
    await press("Copy Recovery Kit");
    await press("I've saved my kit. Continue to payment");
    expect(mockCheckout).toHaveBeenCalledWith("premiumYearly", paidTerms);
});

it("retains a generated kit when the subsequent configuration refresh fails", async () => {
    mockSync
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error("Refresh failed"));
    await renderSignup();
    await press("Continue");
    expect(mockGenerateRecovery).toHaveBeenCalledTimes(1);
    expect(button("Copy Recovery Kit")).toBeDefined();
    await press("Copy Recovery Kit");
    await press("I've saved my kit. Continue to payment");
    expect(mockCheckout).toHaveBeenCalledWith("premiumMonthly", paidTerms);
});

it("shows a generated kit while its subsequent configuration refresh is still pending", async () => {
    const refresh = deferred<void>();
    mockSync
        .mockResolvedValueOnce(undefined)
        .mockReturnValueOnce(refresh.promise);
    await renderSignup();
    await press("Continue");
    expect(button("Copy Recovery Kit")).toBeDefined();
    expect(renderer!.root.findByType("Dialog" as never).props.loading).toBe(
        false,
    );
    await act(async () => refresh.resolve());
});

it("does not continue registration after the unlocked vault session changes during captcha", async () => {
    const captcha = deferred<string | null>();
    mockRequestToken.mockReturnValueOnce(captcha.promise);
    await renderSignup();
    await press("Continue");
    mockVaultGeneration = 2;
    await act(async () => captcha.resolve(randomUUID()));
    expect(mockRegister).not.toHaveBeenCalled();
    expect(mockGenerateRecovery).not.toHaveBeenCalled();
});

it("does not bind, authenticate, or clear another vault session after a stale registration response", async () => {
    const registration = deferred<unknown>();
    mockRegister.mockReturnValueOnce(registration.promise);
    await renderSignup();
    await press("Continue");
    expect(mockRegister).toHaveBeenCalledTimes(1);
    const nextVault = {
        OnlineServices: { DeviceId: "next-device", UserID: "next-user" },
    };
    const nextSession = {
        deviceId: "next-device",
        sessionToken: randomUUID(),
        remoteData: {},
    };
    const nextStatus = { statusDescription: "Connected to next vault" };
    await act(async () => {
        mockVaultGeneration = 2;
        vaultStore.set(unlockedVaultAtom, nextVault as never);
        onlineServicesStore.set(onlineServicesDataAtom, nextSession as never);
        onlineServicesStore.set(
            onlineServicesAuthConnectionStatusAtom,
            nextStatus as never,
        );
        registration.resolve({
            deviceId: "stale-device",
            userId: "stale-user",
        });
    });
    expect(mockPersist).not.toHaveBeenCalled();
    expect(mockEstablish).not.toHaveBeenCalled();
    expect(mockSync).not.toHaveBeenCalled();
    expect(mockGenerateRecovery).not.toHaveBeenCalled();
    expect(vaultStore.get(unlockedVaultAtom)).toBe(nextVault);
    expect(onlineServicesStore.get(onlineServicesDataAtom)).toBe(nextSession);
    expect(
        onlineServicesStore.get(onlineServicesAuthConnectionStatusAtom),
    ).toBe(nextStatus);
});

it("does not clear another vault session when a pending registration rollback finishes", async () => {
    const rollbackAuthentication = deferred<unknown>();
    mockPersist.mockResolvedValueOnce(err("VAULT_METADATA_MISSING"));
    mockEstablish.mockReturnValueOnce(rollbackAuthentication.promise);
    await renderSignup();
    await press("Continue");
    expect(mockEstablish).toHaveBeenCalledTimes(1);
    const nextSession = {
        deviceId: "next-device",
        sessionToken: randomUUID(),
        remoteData: {},
    };
    const nextStatus = { statusDescription: "Connected to next vault" };
    await act(async () => {
        mockVaultGeneration = 2;
        onlineServicesStore.set(onlineServicesDataAtom, nextSession as never);
        onlineServicesStore.set(
            onlineServicesAuthConnectionStatusAtom,
            nextStatus as never,
        );
        rollbackAuthentication.resolve(undefined);
    });
    expect(onlineServicesStore.get(onlineServicesDataAtom)).toBe(nextSession);
    expect(
        onlineServicesStore.get(onlineServicesAuthConnectionStatusAtom),
    ).toBe(nextStatus);
    expect(mockGenerateRecovery).not.toHaveBeenCalled();
});

it("requires a successful kit save or copy before the payment confirmation becomes available", async () => {
    jest.mocked(copySecretToClipboard).mockResolvedValueOnce(false);
    await renderSignup();
    await press("Continue");
    await press("Copy Recovery Kit");
    expect(
        button("I've saved my kit. Continue to payment").props.disabled,
    ).toBe(true);
    expect(mockCheckout).not.toHaveBeenCalled();
    expect(renderer!.root.findByType("Notice" as never).props.tone).toBe(
        "error",
    );
});

it("uses modest text feedback after saving a printable kit", async () => {
    await renderSignup();
    await press("Continue");
    await press("Save printable kit");
    expect(renderer!.root.findAllByType("Notice" as never)).toHaveLength(0);
    expect(
        renderer!.root
            .findAllByType("Text" as never)
            .some(
                (node) =>
                    node.props.children ===
                    "Share sheet opened. Save the kit offline.",
            ),
    ).toBe(true);
});

it("retains a clear share failure and keeps payment confirmation disabled", async () => {
    jest.mocked(Sharing.shareAsync).mockRejectedValueOnce(
        new Error("Sharing failed"),
    );
    await renderSignup();
    await press("Continue");
    await press("Save printable kit");
    const notice = renderer!.root.findByType("Notice" as never);
    expect(notice.props.tone).toBe("error");
    expect(notice.props.message).toBe("Could not share Recovery Kit.");
    expect(
        button("I've saved my kit. Continue to payment").props.disabled,
    ).toBe(true);
});

it("clears a previous controller refresh error on Retry without adding a success message", async () => {
    mockSync.mockRejectedValueOnce(new Error("Temporary connection failure"));
    await act(async () => {
        renderer = create(
            createElement(
                Provider,
                { store: vaultStore },
                createElement(
                    AccountControllerProvider,
                    null,
                    createElement(ControllerHarness),
                ),
            ),
        );
    });
    await act(async () =>
        renderer!.root
            .findByType("Controller" as never)
            .props.account.handleRefresh(),
    );
    expect(
        renderer!.root.findByType("Controller" as never).props.account.message
            .tone,
    ).toBe("error");
    await act(async () =>
        renderer!.root
            .findByType("Controller" as never)
            .props.account.handleRefresh(),
    );
    expect(
        renderer!.root.findByType("Controller" as never).props.account.message,
    ).toBeNull();
});

it("blocks rapid double taps during account creation", async () => {
    const captcha = deferred<string | null>();
    mockRequestToken.mockReturnValueOnce(captcha.promise);
    await renderSignup();
    await act(async () => {
        const onPress = button("Continue").props.onPress;
        onPress();
        onPress();
    });
    expect(mockRequestToken).toHaveBeenCalledTimes(1);
    expect(renderer!.root.findByType("Dialog" as never).props.loading).toBe(
        true,
    );
    await act(async () => captcha.resolve(randomUUID()));
    expect(mockRegister).toHaveBeenCalledTimes(1);
});

it("keeps the checkbox and Finish acknowledgement for standalone recovery kits", async () => {
    await act(async () => {
        renderer = create(
            createElement(RecoveryKitDialog, {
                open: true,
                kit: {
                    userId: "user-test",
                    recoveryPhrase: mockRecoveryPhrase,
                },
                onComplete: mockClosed,
            }),
        );
    });
    expect(renderer!.root.findAllByType("Checkbox" as never)).toHaveLength(1);
    expect(
        renderer!.root
            .findAllByType("Text" as never)
            .find((node) => node.props.children === "Save your Recovery Kit"),
    ).toBeDefined();
    await press("Copy Recovery Kit");
    expect(button("Finish").props.disabled).toBe(true);
    await act(async () =>
        renderer!.root
            .findByType("Checkbox" as never)
            .props.onCheckedChange(true),
    );
    await press("Finish");
    expect(mockClosed).toHaveBeenCalledTimes(1);
    expect(mockCheckout).not.toHaveBeenCalled();
});

it.each(["captcha", "recovery", "persistence", "authentication"])(
    "keeps the new vault session when account recovery completes after a switch during %s",
    async (phase) => {
        const pending = deferred<unknown>();
        const captcha = deferred<string | null>();
        if (phase === "captcha")
            mockRequestToken.mockReturnValueOnce(captcha.promise);
        if (phase === "recovery")
            mockRecover.mockReturnValueOnce(pending.promise);
        if (phase === "persistence")
            mockPersist.mockReturnValueOnce(pending.promise);
        if (phase === "authentication")
            mockEstablish.mockReturnValueOnce(pending.promise);
        await renderController();
        await act(async () => {
            account().setRecoverUserId("recovered-user");
            account().setRecoverPhrase(mockRecoveryPhrase);
        });
        let result: Promise<"recovered" | "kit-missing" | false> | undefined;
        await act(async () => {
            result = account().handleRecover();
        });
        let next: ReturnType<typeof replaceVaultSession> | undefined;
        await act(async () => {
            next = replaceVaultSession();
            captcha.resolve(randomUUID());
            pending.resolve(
                phase === "recovery"
                    ? { deviceId: "recovered-device" }
                    : ok(undefined),
            );
            expect(await result).toBe(false);
        });
        if (!next) throw new Error("Next vault session was not installed.");
        expectCurrentSession(next);
        expect(mockSync).not.toHaveBeenCalled();
        if (phase === "captcha") expect(mockRecover).not.toHaveBeenCalled();
        if (phase === "captcha" || phase === "recovery")
            expect(mockPersist).not.toHaveBeenCalled();
        if (phase !== "authentication")
            expect(mockEstablish).not.toHaveBeenCalled();
    },
);

it.each(["remote deletion", "persistence"])(
    "does not remove the new vault binding after stale account deletion during %s",
    async (phase) => {
        mockRootDevice = true;
        vaultStore.set(
            unlockedVaultAtom,
            Object.assign(new Vault(), {
                OnlineServices: new OnlineServices(
                    "old-device",
                    "old-user",
                    "old-public",
                    "old-private",
                ),
            }),
        );
        const pending = deferred<unknown>();
        if (phase === "remote deletion")
            mockDeleteUser.mockReturnValueOnce(pending.promise);
        else mockPersist.mockReturnValueOnce(pending.promise);
        await renderController();
        await act(async () => account().openDeleteAccount());
        await press("Delete account");
        expect(mockDeleteUser).toHaveBeenCalledWith({
            challengeId: "challenge-test",
            signature: "test-signature",
        });
        let next: ReturnType<typeof replaceVaultSession> | undefined;
        await act(async () => {
            next = replaceVaultSession();
            pending.resolve(phase === "persistence" ? ok(undefined) : true);
            await pending.promise;
        });
        if (!next) throw new Error("Next vault session was not installed.");
        expectCurrentSession(next);
        expect(router.dismissTo).not.toHaveBeenCalled();
        if (phase === "remote deletion")
            expect(mockPersist).not.toHaveBeenCalled();
    },
);

it.each(["logout", "persistence"])(
    "does not remove the new vault binding after stale local removal during %s",
    async (phase) => {
        const pending = deferred<void>();
        if (phase === "logout") mockLogout.mockReturnValueOnce(pending.promise);
        else
            mockPersist.mockImplementationOnce(async () => {
                await pending.promise;
                return ok(undefined);
            });
        await renderController();
        await act(async () => account().openRemoveLocalBinding());
        await press("Disconnect device");
        let next: ReturnType<typeof replaceVaultSession> | undefined;
        await act(async () => {
            next = replaceVaultSession();
            pending.resolve();
            await pending.promise;
        });
        if (!next) throw new Error("Next vault session was not installed.");
        expectCurrentSession(next);
        expect(router.dismissTo).not.toHaveBeenCalled();
        if (phase === "logout") expect(mockPersist).not.toHaveBeenCalled();
    },
);

it("recovers and deletes the account binding when the originating vault session stays active", async () => {
    mockRootDevice = true;
    await renderController();
    await act(async () => {
        account().setRecoverUserId("recovered-user");
        account().setRecoverPhrase(mockRecoveryPhrase);
    });
    await act(async () => {
        expect(await account().handleRecover()).toBe("kit-missing");
    });
    expect(vaultStore.get(unlockedVaultAtom).OnlineServices?.DeviceId).toBe(
        "recovered-device",
    );
    expect(mockEstablish).toHaveBeenCalledWith({
        deviceId: "recovered-device",
        privateKeyJWK: "test-private-key",
    });
    expect(mockSync).toHaveBeenCalledTimes(1);
    await act(async () => account().openDeleteAccount());
    await press("Delete account");
    expect(mockDeleteUser).toHaveBeenCalledWith({
        challengeId: "challenge-test",
        signature: "test-signature",
    });
    expect(vaultStore.get(unlockedVaultAtom).OnlineServices).toBeNull();
    expect(onlineServicesStore.get(onlineServicesDataAtom)).toBeNull();
});

it.each(["rotation", "configuration refresh"])(
    "does not navigate to an old Recovery Kit after a vault switch during %s",
    async (phase) => {
        const rotation = deferred<unknown>();
        const refresh = deferred<void>();
        if (phase === "rotation")
            mockRotateRecovery.mockReturnValueOnce(rotation.promise);
        else mockSync.mockReturnValueOnce(refresh.promise);
        await renderController();
        await act(async () => account().openRotateRecovery());
        await press("Rotate kit");
        expect(mockRotateRecovery).toHaveBeenCalledTimes(1);
        let next: ReturnType<typeof replaceVaultSession> | undefined;
        await act(async () => {
            next = replaceVaultSession();
            rotation.resolve({ userId: "old-user", token: mockRecoveryPhrase });
            refresh.resolve();
        });
        if (!next) throw new Error("Next vault session was not installed.");
        expectCurrentSession(next);
        expect(router.push).not.toHaveBeenCalled();
        if (phase === "rotation") {
            expect(account().recoveryKit).toBeNull();
            expect(mockSync).not.toHaveBeenCalled();
        }
    },
);

it("shows localized Play prices once, then opens the selected payment directly after saving the kit", async () => {
    mockPlayBuild = true;
    await renderSignup();
    expect(mockStorePlans).toHaveBeenCalledTimes(1);
    expect(
        renderer!.root
            .findAllByType("Pressable" as never)
            .some(
                (node) =>
                    node.props.accessibilityLabel === "Yearly, $49.99 per year",
            ),
    ).toBe(true);
    await chooseYearly();
    expect(
        renderer!.root
            .findAllByType("Text" as never)
            .some(
                (node) =>
                    node.props.children ===
                    "$49.99 charged every year. Automatically renews until canceled. Cancel anytime in Google Play Subscriptions. Access continues until the end of the paid period.",
            ),
    ).toBe(true);
    await press("Continue");
    expect(mockCheckout).not.toHaveBeenCalled();
    expect(
        button("I've saved my kit. Continue to payment").props.disabled,
    ).toBe(true);
    await press("Copy Recovery Kit");
    expect(mockStorePlans).toHaveBeenCalledTimes(1);
    await press("I've saved my kit. Continue to payment");
    expect(mockCheckout.mock.calls).toEqual([["premiumYearly", paidTerms]]);
});

it("uses the snackbar for registration failures without exposing server diagnostics", async () => {
    mockRegister.mockRejectedValueOnce(new Error("private SQL failure"));
    await renderSignup();
    await press("Continue");
    expect(renderer!.root.findAllByProps({ testID: "snackbar" })).toHaveLength(
        1,
    );
    expect(
        renderer!.root
            .findAllByType("Text" as never)
            .some(
                (node) =>
                    node.props.children ===
                    "Could not set up Online Services. Please try again.",
            ),
    ).toBe(true);
    expect(renderer!.root.findAllByType("Notice" as never)).toHaveLength(0);
    expect(mockCheckout).not.toHaveBeenCalled();
});

it("holds the sheet while the store payment opens, then lets it close", async () => {
    mockPlayBuild = true;
    await renderSignup();
    await press("Continue");
    await press("Copy Recovery Kit");
    await press("I've saved my kit. Continue to payment");
    await renderSignup(true, { state: "opening" });
    expect(renderer!.root.findAllByType("PaymentPanel" as never)).toHaveLength(
        1,
    );
    expect(renderer!.root.findAllByType("DialogTitle" as never)).toHaveLength(
        0,
    );
    expect(renderer!.root.findByType("Dialog" as never).props.dismissible).toBe(
        false,
    );
    expect(mockNavigationGuard).toBe(true);
    const { Alert } =
        jest.requireMock<typeof import("react-native")>("react-native");
    mockLeave();
    expect(Alert.alert).toHaveBeenCalledWith(
        "Payment in progress",
        "Finish or cancel the payment in Google Play first.",
    );
    await renderSignup(true, { state: "confirming" });
    expect(renderer!.root.findByType("Dialog" as never).props.dismissible).toBe(
        true,
    );
    expect(mockNavigationGuard).toBe(false);
});

it("returns to the plan when the offer changed and pays the new terms on the same account", async () => {
    mockPlayBuild = true;
    mockTrialEligible = true;
    await renderSignup();
    await press("Continue");
    await press("Copy Recovery Kit");
    await press("I've saved my kit. Continue to payment");
    expect(mockCheckout).toHaveBeenLastCalledWith("premiumMonthly", {
        trialEligible: true,
        trial: false,
    });
    await renderSignup(true, { state: "opening" });
    mockStorePlans.mockResolvedValue([
        { tier: "premiumMonthly", price: "$4.99", trial: true },
        { tier: "premiumYearly", price: "$49.99", trial: true },
    ]);
    await renderSignup(true, { state: "offerChanged", trial: true });
    expect(
        renderer!.root.findByType("PaymentStatus" as never).props,
    ).toMatchObject({ state: "offerChanged", trial: true });
    await press("Start 14-day free trial");
    expect(mockCheckout).toHaveBeenLastCalledWith("premiumMonthly", {
        trialEligible: true,
        trial: true,
    });
    expect(mockRegister).toHaveBeenCalledTimes(1);
});
