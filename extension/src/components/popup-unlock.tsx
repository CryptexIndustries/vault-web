import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLiveQuery } from "dexie-react-hooks";
import { Err, Ok } from "neverthrow";
import { LoaderCircle, Lock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";

import {
    EncryptionAlgorithm,
    KeyDerivationFunction,
    AdditionalKeyProtectionKind,
} from "@cryptex-industries/vault-core/proto";
import {
    KeyDerivationConfig_Argon2ID,
    KeyDerivationConfig_PBKDF2,
} from "@cryptex-industries/vault-core/vault-utils/encryption";
import {
    EncryptionFormGroupSchemaType,
    encryptionFormGroupSchema,
} from "@cryptex-industries/vault-core/vault-utils/form-schemas";
import * as Storage from "@/app_lib/vault-utils/storage";
import { uiLog, vaultLog } from "../utils/ext-logging";

const LAST_SELECTED_VAULT_KEY = "extension-last-selected-vault";

type DecryptResult =
    | Err<
          never,
          | "VAULT_BLOB_NULL"
          | "VAULT_BLOB_INVALID_TYPE"
          | "KEY_DERIVATION_FN_CONFIG_UNDEFINED"
          | "KEY_DERIVATION_FN_INVALID"
          | "DECRYPTION_FAILED"
          | "ENCRYPTION_ALGORITHM_INVALID"
      >
    | Ok<void, never>;

export type PopupUnlockProps = {
    onUnlock: (
        metadata: Storage.VaultMetadata,
        formData: EncryptionFormGroupSchemaType,
        protectionPhrase?: string,
    ) => Promise<DecryptResult>;
};

const PopupUnlock: React.FC<PopupUnlockProps> = ({ onUnlock }) => {
    const [selectedVaultId, setSelectedVaultId] = useState<string>("");
    const [isDecrypting, setIsDecrypting] = useState(false);
    const [showSecret, setShowSecret] = useState(false);
    const [protectionPhrase, setProtectionPhrase] = useState("");
    const [showProtectionPhrase, setShowProtectionPhrase] = useState(false);
    const [decryptError, setDecryptError] = useState<string | null>(null);

    const rawVaults = useLiveQuery(() => Storage.db.vaults.toArray());

    const vaults = useMemo<Storage.VaultMetadata[] | undefined>(() => {
        if (!rawVaults) return undefined;
        return rawVaults.map((row: Storage.VaultMetadataInterface) =>
            Storage.VaultMetadata.deserializeMetadataBinary(row.data, row.id),
        );
    }, [rawVaults]);

    const selectedVault = useMemo<Storage.VaultMetadata | null>(
        () =>
            vaults?.find(
                (vault: Storage.VaultMetadata) =>
                    vault.DBIndex?.toString() === selectedVaultId,
            ) ?? null,
        [vaults, selectedVaultId],
    );

    const isSingleVault = (vaults?.length ?? 0) === 1;
    const needsProtectionPhrase =
        selectedVault?.Blob?.Envelope?.PrimaryProtectionKind ===
            AdditionalKeyProtectionKind.PROTECTION_PHRASE_128 ||
        selectedVault?.Blob?.Envelope?.PrimaryProtectionKind ===
            AdditionalKeyProtectionKind.PROTECTION_PHRASE_256;

    const {
        register,
        handleSubmit,
        reset: resetForm,
        setFocus,
        setValue,
        formState: { errors },
    } = useForm<EncryptionFormGroupSchemaType>({
        resolver: zodResolver(encryptionFormGroupSchema),
        defaultValues: {
            Secret: "",
            Encryption: EncryptionAlgorithm.XChaCha20Poly1305,
            EncryptionKeyDerivationFunction: KeyDerivationFunction.Argon2ID,
            EncryptionConfig: {
                iterations: KeyDerivationConfig_PBKDF2.DEFAULT_ITERATIONS,
                memLimit: KeyDerivationConfig_Argon2ID.DEFAULT_MEM_LIMIT,
                opsLimit: KeyDerivationConfig_Argon2ID.DEFAULT_OPS_LIMIT,
            },
        },
    });

    useEffect(() => {
        if (!vaults?.length) return;

        const lastSelected = localStorage.getItem(LAST_SELECTED_VAULT_KEY);
        const exists = vaults.some(
            (vault: Storage.VaultMetadata) =>
                vault.DBIndex?.toString() === lastSelected,
        );
        const next =
            lastSelected && exists
                ? lastSelected
                : (vaults[0]?.DBIndex?.toString() ?? "");

        setSelectedVaultId(next);
        uiLog.debug("Hydrated vault selector", {
            selected: next,
            available: vaults.length,
        });
    }, [vaults]);

    useEffect(() => {
        if (!selectedVault) return;

        setShowSecret(false);
        setShowProtectionPhrase(false);
        setProtectionPhrase("");
        localStorage.setItem(
            LAST_SELECTED_VAULT_KEY,
            selectedVault.DBIndex?.toString() ?? "",
        );
        setValue(
            "Encryption",
            selectedVault.Blob?.Algorithm ??
                EncryptionAlgorithm.XChaCha20Poly1305,
        );
        setValue(
            "EncryptionKeyDerivationFunction",
            selectedVault.Blob?.KeyDerivationFunc ??
                KeyDerivationFunction.Argon2ID,
        );
        setValue("EncryptionConfig", {
            iterations:
                selectedVault.Blob?.KDFConfigPBKDF2?.iterations ??
                KeyDerivationConfig_PBKDF2.DEFAULT_ITERATIONS,
            memLimit:
                selectedVault.Blob?.KDFConfigArgon2ID?.memLimit ??
                KeyDerivationConfig_Argon2ID.DEFAULT_MEM_LIMIT,
            opsLimit:
                selectedVault.Blob?.KDFConfigArgon2ID?.opsLimit ??
                KeyDerivationConfig_Argon2ID.DEFAULT_OPS_LIMIT,
        });

        setFocus("Secret");
    }, [selectedVault, setValue, setFocus]);

    const tryUnlock = async (formData: EncryptionFormGroupSchemaType) => {
        if (!selectedVault) return;

        setIsDecrypting(true);
        setDecryptError(null);
        await new Promise((resolve) => setTimeout(resolve, 100));

        const result = await onUnlock(
            selectedVault,
            formData,
            protectionPhrase.trim() || undefined,
        );
        setIsDecrypting(false);

        if (result.isErr()) {
            vaultLog.warn("Vault unlock failed", {
                error: result.error,
                vaultId: selectedVault.DBIndex,
            });
            setDecryptError(
                "Decryption failed. Check the password and try again.",
            );
            return;
        }

        resetForm(undefined, { keepDefaultValues: true });
        setShowSecret(false);
        setShowProtectionPhrase(false);
        setProtectionPhrase("");
    };

    if (vaults == null) {
        return (
            <div className="flex h-full items-center justify-center p-4">
                <LoaderCircle className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (!vaults.length) return null;

    return (
        <form
            onSubmit={handleSubmit(tryUnlock)}
            className="flex h-full flex-col p-4"
        >
            {isSingleVault ? (
                <div className="flex flex-col items-center gap-3 pb-5 pt-6 text-center">
                    <span className="rounded-full bg-primary/15 p-3 text-primary">
                        <Lock className="h-6 w-6" />
                    </span>
                    <div className="space-y-0.5">
                        <h1 className="text-base font-semibold leading-tight">
                            {selectedVault?.Name || "Vault"}
                        </h1>
                        <p className="text-[11px] text-muted-foreground">
                            Vault locked. Unlock to access credentials.
                        </p>
                    </div>
                </div>
            ) : (
                <>
                    <header className="flex items-start gap-2 pb-3">
                        <span className="rounded-md bg-primary/15 p-1.5 text-primary">
                            <Lock className="h-4 w-4" />
                        </span>
                        <div className="min-w-0">
                            <h1 className="text-sm font-semibold">
                                Unlock vault
                            </h1>
                            <p className="text-[11px] leading-snug text-muted-foreground">
                                Enter your vault password to access credentials.
                            </p>
                        </div>
                    </header>

                    <div className="space-y-1.5 pb-3">
                        <Label htmlFor="vault-select" className="text-xs">
                            Vault
                        </Label>
                        <Select
                            value={selectedVaultId}
                            onValueChange={setSelectedVaultId}
                        >
                            <SelectTrigger
                                id="vault-select"
                                className="text-xs"
                            >
                                <SelectValue placeholder="Select a vault" />
                            </SelectTrigger>
                            <SelectContent>
                                {vaults.map((vault: Storage.VaultMetadata) => (
                                    <SelectItem
                                        key={vault.DBIndex}
                                        value={vault.DBIndex?.toString() ?? ""}
                                    >
                                        <span className="line-clamp-1 max-w-56 text-start">
                                            {vault.Name || "Untitled vault"}
                                        </span>
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </>
            )}

            <div className="space-y-1.5">
                <Label htmlFor="vault-secret" className="text-xs">
                    Password
                </Label>
                <PasswordInput
                    id="vault-secret"
                    revealed={showSecret}
                    onRevealedChange={setShowSecret}
                    autoComplete="current-password"
                    className="text-xs"
                    placeholder="Vault password"
                    {...register("Secret")}
                />
                {errors.Secret ? (
                    <p className="text-[11px] text-destructive">
                        {errors.Secret.message}
                    </p>
                ) : null}
            </div>

            {needsProtectionPhrase ? (
                <div className="mt-3 space-y-1.5">
                    <Label
                        htmlFor="vault-protection-phrase"
                        className="text-xs"
                    >
                        Protection phrase
                    </Label>
                    <PasswordInput
                        id="vault-protection-phrase"
                        revealed={showProtectionPhrase}
                        onRevealedChange={setShowProtectionPhrase}
                        autoComplete="off"
                        className="font-mono text-xs"
                        placeholder="Only needed after restore or cleared data"
                        value={protectionPhrase}
                        onChange={(event) =>
                            setProtectionPhrase(event.target.value)
                        }
                    />
                    <p className="text-[11px] text-muted-foreground">
                        Leave blank when this browser profile already has its
                        device-local protection.
                    </p>
                </div>
            ) : null}

            {decryptError ? (
                <p className="pt-2 text-xs text-destructive" role="alert">
                    {decryptError}
                </p>
            ) : null}

            <div className="mt-auto pt-4">
                <Button
                    type="submit"
                    size="sm"
                    className="w-full"
                    disabled={isDecrypting || !selectedVault}
                >
                    {isDecrypting ? (
                        <span className="flex items-center gap-2">
                            <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                            Unlocking…
                        </span>
                    ) : (
                        "Unlock"
                    )}
                </Button>
            </div>
        </form>
    );
};

export default PopupUnlock;
