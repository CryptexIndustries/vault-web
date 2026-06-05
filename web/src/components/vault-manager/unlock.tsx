import { VaultMetadata } from "@/app_lib/vault-utils/storage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { zodResolver } from "@hookform/resolvers/zod";
import {
    Edit2,
    LifeBuoy,
    LoaderCircle,
    Quote,
    Trash2,
    Unlock,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Err, Ok } from "neverthrow";
import type { VaultUnlockFlowResult } from "@/app_lib/vault-utils/vault-unlock-types";
import {
    EncryptionAlgorithm,
    KeyDerivationFunction,
    SecondFactorKind,
} from "../../app_lib/proto/vault";
import {
    KeyDerivationConfig_Argon2ID,
    KeyDerivationConfig_PBKDF2,
} from "../../app_lib/vault-utils/encryption";
import {
    EditVaultFormSchemaType,
    editVaultFormSchema,
    EncryptionFormGroupSchemaType,
    encryptionFormGroupSchema,
} from "../../app_lib/vault-utils/form-schemas";
import { FormInput } from "../general/input-fields";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "../ui/alert-dialog";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "../ui/dialog";
import { Textarea } from "../ui/textarea";

const LOCAL_STORAGE_LAST_SELECTED_VAULT = "last-selected-vault";

type UnlockTabProps = {
    vaults: VaultMetadata[] | undefined;
    executeCallback: (
        metadata: VaultMetadata,
        formData: EncryptionFormGroupSchemaType,
        unlockExtras?: {
            useRecovery?: boolean;
            recoveryCode?: string;
            secondFactorPassphrase?: string;
        },
    ) => Promise<Err<never, string> | Ok<VaultUnlockFlowResult, never>>;
    deleteVaultCallback: (dbIndex: number) => Promise<void>;
};

/**
 * Encapsulates the unlock / edit / delete behaviour so the presentation layer
 * stays focused on layout.
 */
function useUnlockController({
    vaults,
    executeCallback,
    deleteVaultCallback,
}: UnlockTabProps) {
    const [selectedVault, _setSelectedVault] = useState("");
    const [isDecrypting, setIsDecrypting] = useState(false);
    const [selectedVaultDisplayName, setSelectedVaultDisplayName] =
        useState("");
    const [isVaultDeleting, setIsVaultDeleting] = useState(false);
    const [isVaultDeletingError, setIsVaultDeletingError] = useState(false);
    const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
    const [isVaultUpdating, setIsVaultUpdating] = useState(false);
    const [isVaultUpdatingError, setIsVaultUpdatingError] = useState(false);
    const [useRecovery, setUseRecovery] = useState(false);
    const [recoveryCode, setRecoveryCode] = useState("");
    const [secondFactorPassphrase, setSecondFactorPassphrase] = useState("");

    const form = useForm<EncryptionFormGroupSchemaType>({
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
    const { handleSubmit, reset: resetForm, setFocus, getValues } = form;

    const editForm = useForm<EditVaultFormSchemaType>({
        resolver: zodResolver(editVaultFormSchema),
        defaultValues: { Name: "", Description: "" },
    });

    const findVault = (dbIndex: string) =>
        vaults?.find((i) => i.DBIndex?.toString() === dbIndex);

    const setSelectedVault = (value: string) => {
        _setSelectedVault(value);
        setSecondFactorPassphrase("");
        const data = findVault(value);
        if (!data) return;

        localStorage.setItem(LOCAL_STORAGE_LAST_SELECTED_VAULT, value);

        resetForm({
            Secret: "",
            Encryption: data?.Blob?.Algorithm ?? 0,
            EncryptionKeyDerivationFunction: data?.Blob?.KeyDerivationFunc ?? 0,
            EncryptionConfig: {
                iterations:
                    data?.Blob?.KDFConfigPBKDF2?.iterations ??
                    KeyDerivationConfig_PBKDF2.DEFAULT_ITERATIONS,
                memLimit:
                    data?.Blob?.KDFConfigArgon2ID?.memLimit ??
                    KeyDerivationConfig_Argon2ID.DEFAULT_MEM_LIMIT,
                opsLimit:
                    data?.Blob?.KDFConfigArgon2ID?.opsLimit ??
                    KeyDerivationConfig_Argon2ID.DEFAULT_OPS_LIMIT,
            },
        });
    };

    const openEditDialog = () => {
        const data = findVault(selectedVault);
        if (!data) return;
        editForm.setValue("Name", data.Name);
        editForm.setValue("Description", data.Description);
        setIsEditDialogOpen(true);
    };

    const handleVaultUpdate = async (formData: EditVaultFormSchemaType) => {
        if (isVaultUpdating) return;
        const data = findVault(selectedVault);
        if (!data) return;

        setIsVaultUpdating(true);
        setIsVaultUpdatingError(false);
        try {
            data.Name = formData.Name;
            data.Description = formData.Description;
            await data.save(null, new Uint8Array(0));
            setSelectedVaultDisplayName(formData.Name);
            setIsEditDialogOpen(false);
            editForm.reset();
        } catch (e) {
            console.error("Error updating vault:", e);
            setIsVaultUpdatingError(true);
        } finally {
            setIsVaultUpdating(false);
        }
    };

    const tryUnlock = async (formData: EncryptionFormGroupSchemaType) => {
        const data = findVault(selectedVault);
        if (!data) return;

        setIsDecrypting(true);
        // Give the UI breathing room to paint the loading state since unlock is heavy on the main thread.
        await new Promise((resolve) => setTimeout(resolve, 100));

        const decryptRes = await executeCallback(data, formData, {
            useRecovery,
            recoveryCode: useRecovery ? recoveryCode.trim() : undefined,
            secondFactorPassphrase:
                !useRecovery && secondFactorPassphrase.trim().length > 0
                    ? secondFactorPassphrase.trim()
                    : undefined,
        });
        setIsDecrypting(false);

        if (decryptRes.isErr()) {
            console.error("Decryption failed:", decryptRes.error);
            return;
        }
        setTimeout(() => resetForm(), 200);
    };

    const handleVaultDelete = async () => {
        if (isVaultDeleting) return;
        const dbIndex = Number(selectedVault);
        if (dbIndex == null || isNaN(dbIndex)) {
            setIsVaultDeletingError(true);
            return;
        }
        setIsVaultDeleting(true);
        try {
            await deleteVaultCallback(dbIndex);
            localStorage.removeItem(LOCAL_STORAGE_LAST_SELECTED_VAULT);
        } catch (e) {
            console.error("Error deleting vault:", e);
            setIsVaultDeletingError(true);
            return;
        } finally {
            setIsVaultDeleting(false);
        }
        resetForm();
    };

    useEffect(() => {
        const data = vaults?.find(
            (i) => i.DBIndex?.toString() === selectedVault,
        );
        if (!data) return;
        setSelectedVaultDisplayName(data.Name);
    }, [selectedVault, vaults]);

    useEffect(() => {
        if (vaults?.length) {
            const last = localStorage.getItem(
                LOCAL_STORAGE_LAST_SELECTED_VAULT,
            );
            const exists =
                vaults.findIndex(
                    (v) => v.DBIndex && v.DBIndex === Number(last),
                ) !== -1;
            if (last && exists) {
                setSelectedVault(last);
            } else {
                setSelectedVault(vaults[0]!.DBIndex?.toString() ?? "UNKNOWN");
            }
        }
        setFocus("Secret");
        // setSelectedVault/setFocus are stable for the lifetime of this hook;
        // we only want to re-run vault initialization when the vault list changes.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [vaults]);

    const selectedVaultData = findVault(selectedVault);
    const selectedRequiresPassphrase =
        !useRecovery &&
        (selectedVaultData?.Blob?.Envelope?.PrimaryFactorKind ===
            SecondFactorKind.PASSPHRASE_128 ||
            selectedVaultData?.Blob?.Envelope?.PrimaryFactorKind ===
                SecondFactorKind.PASSPHRASE_256);

    return {
        form,
        editForm,
        selectedVault,
        setSelectedVault,
        selectedVaultDisplayName,
        isDecrypting,
        isVaultDeleting,
        isVaultDeletingError,
        isEditDialogOpen,
        setIsEditDialogOpen,
        isVaultUpdating,
        isVaultUpdatingError,
        useRecovery,
        setUseRecovery,
        recoveryCode,
        setRecoveryCode,
        secondFactorPassphrase,
        setSecondFactorPassphrase,
        selectedRequiresPassphrase,
        openEditDialog,
        handleVaultUpdate,
        handleVaultDelete,
        // In recovery mode the secret key is unused, so skip the form's
        // zod validation (which requires a non-empty secret) and unlock directly.
        submitUnlock: () =>
            useRecovery ? tryUnlock(getValues()) : handleSubmit(tryUnlock)(),
    };
}

type Controller = ReturnType<typeof useUnlockController>;

const EditVaultDialog: React.FC<{ ctrl: Controller }> = ({ ctrl }) => {
    const {
        editForm,
        isEditDialogOpen,
        setIsEditDialogOpen,
        isVaultUpdating,
        isVaultUpdatingError,
        handleVaultUpdate,
    } = ctrl;
    const {
        register,
        handleSubmit,
        formState: { errors },
    } = editForm;

    return (
        <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>Edit Vault</DialogTitle>
                    <DialogDescription>
                        Make changes to your vault information here. Click save
                        when you&apos;re done.
                    </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleSubmit(handleVaultUpdate)}>
                    <div className="flex flex-col gap-4 py-4">
                        <div className="space-y-2">
                            <Label htmlFor="edit-name">Name *</Label>
                            <FormInput
                                id="edit-name"
                                type="text"
                                placeholder="Vault name"
                                {...register("Name")}
                            />
                            {errors.Name && (
                                <p className="text-destructive-foreground">
                                    {errors.Name.message}
                                </p>
                            )}
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="edit-description">
                                Description
                            </Label>
                            <Textarea
                                id="edit-description"
                                placeholder="Vault description (optional)"
                                {...register("Description")}
                            />
                            {errors.Description && (
                                <p className="text-destructive-foreground">
                                    {errors.Description.message}
                                </p>
                            )}
                        </div>
                        {isVaultUpdatingError && (
                            <p className="text-destructive-foreground">
                                There was an error updating the vault. Please
                                try again. There is more information in the
                                console.
                            </p>
                        )}
                    </div>
                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => setIsEditDialogOpen(false)}
                        >
                            Cancel
                        </Button>
                        <Button type="submit" disabled={isVaultUpdating}>
                            {isVaultUpdating ? (
                                <span className="flex items-center">
                                    <LoaderCircle className="-ml-1 mr-2 h-4 w-4 animate-spin" />
                                    Saving...
                                </span>
                            ) : (
                                "Save Changes"
                            )}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
};

const DeleteVaultDialog: React.FC<{
    ctrl: Controller;
    children: React.ReactNode;
}> = ({ ctrl, children }) => {
    const {
        selectedVaultDisplayName,
        isVaultDeleting,
        isVaultDeletingError,
        handleVaultDelete,
    } = ctrl;
    return (
        <AlertDialog>
            <AlertDialogTrigger asChild>{children}</AlertDialogTrigger>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle className="text-foreground">
                        Delete Vault
                    </AlertDialogTitle>
                    <AlertDialogDescription className="text-foreground">
                        Are you sure you want to delete vault{" "}
                        <span className="font-bold">
                            {selectedVaultDisplayName}
                        </span>
                        ? This action cannot be undone and will permanently
                        remove all vault data.
                        {isVaultDeletingError && (
                            <p className="text-destructive-foreground">
                                There was an error deleting the vault. Please
                                try again. There is more information in the
                                console.
                            </p>
                        )}
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel className="text-foreground">
                        Cancel
                    </AlertDialogCancel>
                    <AlertDialogAction
                        onClick={handleVaultDelete}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                        {isVaultDeleting ? (
                            <span className="flex items-center">
                                <LoaderCircle className="-ml-1 mr-2 h-4 w-4 animate-spin" />
                                Deleting...
                            </span>
                        ) : (
                            "Delete Vault"
                        )}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};

const SecretField: React.FC<{ ctrl: Controller; id: string }> = ({
    ctrl,
    id,
}) => {
    const {
        register,
        setValue,
        formState: { errors },
    } = ctrl.form;
    return (
        <>
            <FormInput
                id={id}
                type="password"
                placeholder={
                    ctrl.useRecovery
                        ? "Optional when using recovery"
                        : "Enter your secret key"
                }
                className="pr-16"
                {...register("Secret", { required: !ctrl.useRecovery })}
                setValue={(value) => setValue("Secret", value)}
                onKeyDown={(e) => {
                    if (e.key === "Enter") ctrl.submitUnlock();
                }}
            />
            {errors.Secret && !ctrl.useRecovery && (
                <p className="text-destructive-foreground">
                    {errors.Secret.message}
                </p>
            )}
        </>
    );
};

/**
 * Minimal, single-column unlock screen. Vault picker on top, secret key
 * centre-stage, with recovery and advanced decryption options demoted to quiet
 * toggles so the common case stays uncluttered.
 */
const UnlockTab: React.FC<UnlockTabProps> = (props) => {
    const ctrl = useUnlockController(props);
    const [showRecovery, setShowRecovery] = useState(false);

    if (props.vaults == null) return null;

    const selectedVaultData = props.vaults.find(
        (v) => v.DBIndex?.toString() === ctrl.selectedVault,
    );
    const selectedDescription = selectedVaultData?.Description?.trim();

    return (
        <div className="space-y-2 pt-6">
            <div className="flex items-center gap-2">
                <Select
                    value={ctrl.selectedVault}
                    onValueChange={ctrl.setSelectedVault}
                >
                    <SelectTrigger id="vault-select" className="h-11">
                        <SelectValue placeholder="Select a vault" />
                    </SelectTrigger>
                    <SelectContent>
                        {props.vaults.map((vault) => (
                            <SelectItem
                                key={vault.DBIndex}
                                value={vault.DBIndex?.toString() ?? "UNKNOWN"}
                            >
                                <span className="line-clamp-1 max-w-56 text-start">
                                    {vault.Name}
                                </span>
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <Button
                    size="sm"
                    variant="ghost"
                    onClick={ctrl.openEditDialog}
                    disabled={ctrl.isVaultDeleting || ctrl.isDecrypting}
                    className="h-9 w-9 shrink-0 p-0"
                >
                    <Edit2 className="h-4 w-4" />
                    <span className="sr-only">
                        Edit vault &quot;{ctrl.selectedVaultDisplayName}&quot;
                    </span>
                </Button>
                <DeleteVaultDialog ctrl={ctrl}>
                    <Button
                        size="sm"
                        variant="ghost"
                        disabled={ctrl.isVaultDeleting || ctrl.isDecrypting}
                        className="h-9 w-9 shrink-0 p-0 text-destructive hover:text-destructive"
                    >
                        <Trash2 className="h-4 w-4" />
                        <span className="sr-only">
                            Delete vault &quot;
                            {ctrl.selectedVaultDisplayName}&quot;
                        </span>
                    </Button>
                </DeleteVaultDialog>
            </div>

            {selectedDescription && (
                <div className="relative overflow-hidden rounded-lg border-l-2 border-primary/30 bg-gradient-to-r from-primary/5 to-transparent px-3.5 py-2.5">
                    <Quote className="absolute right-1.5 h-6 w-6 rotate-180 text-primary/40" />
                    <p
                        className="relative line-clamp-2 max-h-24 overflow-y-hidden whitespace-pre-line pr-6 text-sm italic leading-relaxed text-muted-foreground"
                        title={selectedDescription}
                    >
                        {selectedDescription}
                    </p>
                </div>
            )}

            <div className="space-y-2">
                <Label
                    htmlFor="secret-key"
                    className="text-xs text-muted-foreground"
                >
                    {ctrl.useRecovery ? "Recovery code" : "Secret key"}
                </Label>
                {showRecovery ? (
                    <Input
                        id="recovery-code"
                        placeholder="Recovery code"
                        value={ctrl.recoveryCode}
                        onChange={(e) => ctrl.setRecoveryCode(e.target.value)}
                        className="font-mono text-xs"
                    />
                ) : (
                    <SecretField ctrl={ctrl} id="secret-key" />
                )}
            </div>

            {ctrl.selectedRequiresPassphrase && (
                <div className="space-y-2">
                    <Label
                        htmlFor="second-factor-passphrase"
                        className="text-xs text-muted-foreground"
                    >
                        Second-factor passphrase
                    </Label>
                    <Input
                        id="second-factor-passphrase"
                        type="password"
                        placeholder="Optional on this device, required after restore"
                        value={ctrl.secondFactorPassphrase}
                        onChange={(e) =>
                            ctrl.setSecondFactorPassphrase(e.target.value)
                        }
                        className="font-mono text-xs"
                    />
                </div>
            )}

            <Button
                className="h-11 w-full"
                onClick={ctrl.submitUnlock}
                disabled={ctrl.isDecrypting || ctrl.selectedVault.length === 0}
            >
                {ctrl.isDecrypting ? (
                    <span className="flex items-center">
                        <LoaderCircle className="-ml-1 mr-2 h-4 w-4 animate-spin" />
                        Decrypting Vault...
                    </span>
                ) : (
                    <span className="flex items-center">
                        <Unlock className="mr-2 h-4 w-4" />
                        Unlock Vault
                    </span>
                )}
            </Button>

            <div className="flex items-center text-xs">
                <button
                    type="button"
                    className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
                    onClick={() => {
                        const next = !showRecovery;
                        setShowRecovery(next);
                        ctrl.setUseRecovery(next);
                    }}
                >
                    <LifeBuoy className="h-3.5 w-3.5" />
                    {showRecovery
                        ? "Use password instead"
                        : "Use recovery code"}
                </button>
            </div>

            <EditVaultDialog ctrl={ctrl} />
        </div>
    );
};

export default UnlockTab;
