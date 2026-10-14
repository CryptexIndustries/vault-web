import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo-modules-core";
import { isAutoLockDue } from "@/utils/session-timeout";

export type PendingAndroidCredentialRequest = {
    id: string;
    kind:
        | "autofill-get"
        | "autofill-save"
        | "accessibility-get"
        | "accessibility-save"
        | "provider-unlock"
        | "provider-password-get"
        | "provider-password-create"
        | "provider-passkey-get"
        | "provider-passkey-create";
    credentialId?: string | null;
    packageName?: string | null;
    applicationLabel?: string | null;
    webDomain?: string | null;
    webScheme?: string | null;
    warningType?: "unverified-app" | "untrusted-web-context" | "unverified-web-scheme" | "unverified-field-origin" | null;
    requestJson?: string | null;
    clientDataHash?: string | null;
    username?: string | null;
    email?: string | null;
    password?: string | null;
};

export type AndroidBrowserAutofillIntegration = {
    packageName: string;
    label: string;
    channel: string;
    available: boolean;
    enabled: boolean;
};

export type AndroidProviderCredential = {
    vaultId: string;
    name: string;
    username?: string;
    rpId?: string;
    passkeyCredentialId?: string;
    passkeyDiscoverable?: boolean;
    passkeyUsername?: string;
    passkeyDisplayName?: string;
};

export type PasskeyOriginResolution = {
    origin: string | null;
    callerType: "browser" | "app" | "unknown";
    errorCode: string | null;
};

type AndroidCredentialsModule = {
    addListener(
        eventName: "onCredentialRequest",
        listener: (event: { id: string }) => void,
    ): { remove(): void };
    isAutofillEnabled(): boolean;
    openAutofillSettings(): void;
    isAccessibilityAutofillEnabled(): boolean;
    openAccessibilityAutofillSettings(): void;
    isInlineSuggestionsEnabled(): boolean;
    setInlineSuggestionsEnabled(enabled: boolean): void;
    getBrowserAutofillIntegrations(): AndroidBrowserAutofillIntegration[];
    openBrowserAutofillSettings(packageName: string): boolean;
    isCredentialProviderAvailable(): boolean;
    openCredentialProviderSettings(): boolean;
    getPendingRequest(): PendingAndroidCredentialRequest | null;
    setProviderCredentials(
        credentials: AndroidProviderCredential[],
        timeoutMinutes: number,
    ): void;
    clearProviderCredentials(): void;
    refreshProviderSession(timeoutMinutes: number): void;
    backgroundProviderSession(timeoutMinutes: number): void;
    resumeProviderSession(timeoutMinutes: number): void;
    setSensitiveClipboardString(text: string): Promise<void>;
    clearSensitiveClipboardIfOwned(): void;
    expireSensitiveClipboard(): void;
    resolvePendingPasskeyOrigin(rpId: string): Promise<PasskeyOriginResolution>;
    resolvePendingWebOrigin(): Promise<string | null>;
    completeAutofill(
        requestId: string,
        username: string,
        email: string,
        password: string,
    ): boolean;
    completeAccessibilityAutofill(
        requestId: string,
        username: string,
        email: string,
        password: string,
        totp: string,
    ): boolean;
    completeProviderPassword(
        requestId: string,
        username: string,
        password: string,
    ): boolean;
    completeProviderUnlock(requestId: string): boolean;
    completeProviderPasskeyGet(requestId: string, responseJson: string): boolean;
    completeProviderPasskeyCreate(requestId: string, responseJson: string): boolean;
    completeProviderPasswordCreate(requestId: string): boolean;
    rejectExcludedPasskeyCreate(requestId: string): boolean;
    dismissRequest(requestId: string | null): void;
};

const native =
    Platform.OS === "android"
        ? requireOptionalNativeModule<AndroidCredentialsModule>(
              "CryptexAndroidCredentials",
          )
        : null;

export const androidCredentials = {
    available: native != null,
    addCredentialRequestListener: (listener: (event: { id: string }) => void) =>
        native?.addListener("onCredentialRequest", listener) ?? {
            remove: () => undefined,
        },
    isAutofillEnabled: () => native?.isAutofillEnabled() ?? false,
    openAutofillSettings: () => native?.openAutofillSettings(),
    isAccessibilityAutofillEnabled: () =>
        native?.isAccessibilityAutofillEnabled() ?? false,
    openAccessibilityAutofillSettings: () =>
        native?.openAccessibilityAutofillSettings(),
    isInlineSuggestionsEnabled: () =>
        native?.isInlineSuggestionsEnabled() ?? true,
    setInlineSuggestionsEnabled: (enabled: boolean) =>
        native?.setInlineSuggestionsEnabled(enabled),
    getBrowserAutofillIntegrations: () =>
        native?.getBrowserAutofillIntegrations() ?? [],
    openBrowserAutofillSettings: (packageName: string) =>
        native?.openBrowserAutofillSettings(packageName) ?? false,
    isCredentialProviderAvailable: () =>
        native?.isCredentialProviderAvailable() ?? false,
    openCredentialProviderSettings: () =>
        native?.openCredentialProviderSettings() ?? false,
    getPendingRequest: () => native?.getPendingRequest() ?? null,
    setProviderCredentials: (
        credentials: AndroidProviderCredential[],
        timeoutMinutes: number,
    ) => {
        if (!isAutoLockDue()) native?.setProviderCredentials(credentials, timeoutMinutes);
    },
    clearProviderCredentials: () => native?.clearProviderCredentials(),
    refreshProviderSession: (timeoutMinutes: number) =>
        !isAutoLockDue() && native?.refreshProviderSession(timeoutMinutes),
    backgroundProviderSession: (timeoutMinutes: number) =>
        native?.backgroundProviderSession(timeoutMinutes),
    resumeProviderSession: (timeoutMinutes: number) =>
        !isAutoLockDue() && native?.resumeProviderSession(timeoutMinutes),
    setSensitiveClipboardString: (text: string) => {
        if (!native)
            return Promise.reject(
                new Error("Android clipboard is unavailable"),
            );
        return native.setSensitiveClipboardString(text);
    },
    clearSensitiveClipboardIfOwned: () => native?.clearSensitiveClipboardIfOwned(),
    expireSensitiveClipboard: () => native?.expireSensitiveClipboard(),
    resolvePendingPasskeyOrigin: (rpId: string) =>
        native?.resolvePendingPasskeyOrigin(rpId) ??
        Promise.resolve({
            origin: null,
            callerType: "unknown" as const,
            errorCode: "ANDROID_CREDENTIAL_MODULE_UNAVAILABLE",
        }),
    resolvePendingWebOrigin: () =>
        native?.resolvePendingWebOrigin() ?? Promise.resolve(null),
    completeAutofill: (
        requestId: string,
        username: string,
        email: string,
        password: string,
    ) =>
        native?.completeAutofill(requestId, username, email, password) ?? false,
    completeAccessibilityAutofill: (
        requestId: string,
        username: string,
        email: string,
        password: string,
        totp: string,
    ) =>
        native?.completeAccessibilityAutofill(
            requestId,
            username,
            email,
            password,
            totp,
        ) ?? false,
    completeProviderPassword: (
        requestId: string,
        username: string,
        password: string,
    ) => native?.completeProviderPassword(requestId, username, password) ?? false,
    completeProviderUnlock: (requestId: string) =>
        native?.completeProviderUnlock(requestId) ?? false,
    completeProviderPasskeyGet: (requestId: string, responseJson: string) =>
        native?.completeProviderPasskeyGet(requestId, responseJson) ?? false,
    completeProviderPasskeyCreate: (requestId: string, responseJson: string) =>
        native?.completeProviderPasskeyCreate(requestId, responseJson) ?? false,
    completeProviderPasswordCreate: (requestId: string) =>
        native?.completeProviderPasswordCreate(requestId) ?? false,
    rejectExcludedPasskeyCreate: (requestId: string) =>
        native?.rejectExcludedPasskeyCreate(requestId) ?? false,
    dismissRequest: (requestId?: string) => native?.dismissRequest(requestId ?? null),
};
