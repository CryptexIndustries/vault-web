import type { SecondFactorSource } from "./second-factor";
import type * as VaultUtilTypes from "../proto/vault";
import type { Vault } from "./vault";

export type VaultCreateSecondFactorOptions = {
    secondFactor: SecondFactorSource;
};

export type VaultUnlockParams = {
    masterPassword: string;
    useRecovery?: boolean;
    recoveryCode?: string;
    secondFactorPassphrase?: string;
};

/** Shown once after create or migration. */
export type VaultRevealSecrets = {
    recoveryCode: string;
    secondFactorPassphrase?: string;
    /** Primary 2FA kind, so the reveal UI can warn about device-bound factors. */
    secondFactorKind?: VaultUtilTypes.SecondFactorKind;
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
