import type { AdditionalKeyProtectionSource } from "./additional-key-protection";
import type * as VaultUtilTypes from "../proto/vault";
import type { Vault } from "./vault";

export type VaultCreateAdditionalKeyProtectionOptions = {
    additionalKeyProtection: AdditionalKeyProtectionSource;
};

export type VaultUnlockParams = {
    masterPassword: string;
    useRecovery?: boolean;
    recoveryCode?: string;
    protectionPhrase?: string;
};

/** Shown once after create or migration. */
export type VaultRevealSecrets = {
    recoveryCode: string;
    protectionPhrase?: string;
    /** Lets the reveal UI explain how the selected protection is restored. */
    additionalKeyProtectionKind?: VaultUtilTypes.AdditionalKeyProtectionKind;
};

/** Unlock deferred until the reveal dialog is acknowledged. */
export type VaultPendingUnlock<TMetadata extends VaultUtilTypes.VaultMetadata> =
    {
        metadata: TMetadata;
        vault: Vault;
        dek: CryptoKey;
    };

/** Result from decrypt/unlock callbacks that may show the reveal dialog. */
export type VaultUnlockFlowResult<
    TMetadata extends VaultUtilTypes.VaultMetadata,
> = {
    revealSecrets?: VaultRevealSecrets;
    pendingUnlock?: VaultPendingUnlock<TMetadata>;
};

export type VaultDecryptSuccess = {
    vault: Vault;
    /** Envelope vaults use a non-extractable CryptoKey. */
    dek: CryptoKey;
    revealSecrets?: VaultRevealSecrets;
};
