import { requireOptionalNativeModule } from "expo-modules-core";

/** A login without its password or TOTP secret. */
export type IosIdentityLogin = {
    id: string;
    name: string;
    username: string;
    hasPassword: boolean;
    hasTotp: boolean;
    /** The primary URL first, with CredentialURLMatchMode values. */
    urls: { url: string; matchMode: number }[];
};

type IosCredentialsModule = {
    /** App Group shared with the AutoFill extension. */
    appGroup: string | null;
    /** Builds the identities in Swift, shared with the extension. */
    replaceVaultIdentities(
        vaultDbIndex: number,
        logins: IosIdentityLogin[],
    ): Promise<void>;
    clearVaultIdentities(vaultDbIndex: number): Promise<void>;
    /** Keeps the AutoFill extension from saving logins until unlockAutofillInbox. */
    lockAutofillInbox(): Promise<void>;
    unlockAutofillInbox(): void;
    isProviderEnabled(): Promise<boolean>;
    /** iOS's prompt to turn the provider on. Null before iOS 18. */
    requestProviderEnabled(): Promise<boolean | null>;
    getAutoCopyTotp(): Promise<boolean>;
    setAutoCopyTotp(enabled: boolean): Promise<void>;
    /** False before iOS 17, which has no direct link to the setting. */
    openProviderSettings(): Promise<boolean>;
};

/** Only iOS builds include the module. */
export const iosCredentials = requireOptionalNativeModule<IosCredentialsModule>(
    "CryptexIosCredentials",
);
