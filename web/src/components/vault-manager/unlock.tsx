import { VaultMetadata } from "@/app_lib/vault-utils/storage";
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from "@/components/ui/accordion";
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
import { Edit2, LoaderCircle, Trash2, Unlock } from "lucide-react";
import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";

import { enumToRecord } from "@/utils/consts";
import { Err, Ok } from "neverthrow";
import {
    EncryptionAlgorithm,
    KeyDerivationFunction,
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

const UnlockTab: React.FC<{
    vaults: VaultMetadata[] | undefined;
    executeCallback: (
        metadata: VaultMetadata,
        formData: EncryptionFormGroupSchemaType,
    ) => Promise<
        | Err<
              never,
              | "VAULT_BLOB_NULL"
              | "VAULT_BLOB_INVALID_TYPE"
              | "KEY_DERIVATION_FN_CONFIG_UNDEFINED"
              | "KEY_DERIVATION_FN_INVALID"
              | "DECRYPTION_FAILED"
              | "ENCRYPTION_ALGORITHM_INVALID"
          >
        | Ok<void, never>
    >;
    deleteVaultCallback: (dbIndex: number) => Promise<void>;
}> = ({ vaults, executeCallback, deleteVaultCallback }) => {
    const [selectedVault, _setSelectedVault] = useState("");
    const [isDecrypting, setIsDecrypting] = useState(false);
    const [selectedVaultDisplayName, setSelectedVaultDisplayName] =
        useState("");
    const [isVaultDeleting, setIsVaultDeleting] = useState(false);
    const [isVaultDeletingError, setIsVaultDeletingError] = useState(false);
    const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
    const [isVaultUpdating, setIsVaultUpdating] = useState(false);
    const [isVaultUpdatingError, setIsVaultUpdatingError] = useState(false);

    const {
        handleSubmit,
        register,
        control,
        formState: { errors },
        reset: resetForm,
        watch,
        setFocus,
        setValue,
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

    const {
        handleSubmit: handleEditSubmit,
        register: registerEdit,
        formState: { errors: editErrors },
        reset: resetEditForm,
        setValue: setEditValue,
    } = useForm<EditVaultFormSchemaType>({
        resolver: zodResolver(editVaultFormSchema),
        defaultValues: {
            Name: "",
            Description: "",
        },
    });

    const openEditDialog = () => {
        const selectedVaultData = vaults?.find(
            (i) => i.DBIndex?.toString() === selectedVault,
        );

        if (!selectedVaultData) return;

        // Set the form values to the current vault data
        setEditValue("Name", selectedVaultData.Name);
        setEditValue("Description", selectedVaultData.Description);

        setIsEditDialogOpen(true);
    };

    const handleVaultUpdate = async (formData: EditVaultFormSchemaType) => {
        if (isVaultUpdating) return;

        const selectedVaultData = vaults?.find(
            (i) => i.DBIndex?.toString() === selectedVault,
        );

        if (!selectedVaultData) return;

        setIsVaultUpdating(true);
        setIsVaultUpdatingError(false);

        try {
            // Update the vault metadata
            selectedVaultData.Name = formData.Name;
            selectedVaultData.Description = formData.Description;

            // Save the updated metadata (passing null as vault instance to only update metadata)
            await selectedVaultData.save(null);

            // Update the display name
            setSelectedVaultDisplayName(formData.Name);

            // Close the dialog
            setIsEditDialogOpen(false);

            // Reset the form
            resetEditForm();
        } catch (e) {
            console.error("Error updating vault:", e);
            setIsVaultUpdatingError(true);
        } finally {
            setIsVaultUpdating(false);
        }
    };

    const setSelectedVault = (value: string) => {
        _setSelectedVault(value);

        // Set all the form fields
        const selectedVaultData = vaults?.find(
            (i) => i.DBIndex?.toString() === value,
        );

        if (!selectedVaultData) return;

        // Set the DBIndex to LocalStorage so we can load it later on first load
        localStorage.setItem(LOCAL_STORAGE_LAST_SELECTED_VAULT, value);

        const encryptionFormDefaultValues: EncryptionFormGroupSchemaType = {
            Secret: "",
            Encryption: selectedVaultData?.Blob?.Algorithm ?? 0,
            EncryptionKeyDerivationFunction:
                selectedVaultData?.Blob?.KeyDerivationFunc ?? 0,
            EncryptionConfig: {
                iterations:
                    selectedVaultData?.Blob?.KDFConfigPBKDF2?.iterations ??
                    KeyDerivationConfig_PBKDF2.DEFAULT_ITERATIONS,
                memLimit:
                    selectedVaultData?.Blob?.KDFConfigArgon2ID?.memLimit ??
                    KeyDerivationConfig_Argon2ID.DEFAULT_MEM_LIMIT,
                opsLimit:
                    selectedVaultData?.Blob?.KDFConfigArgon2ID?.opsLimit ??
                    KeyDerivationConfig_Argon2ID.DEFAULT_OPS_LIMIT,
            },
        };

        resetForm(encryptionFormDefaultValues);
    };

    const tryUnlock = async (formData: EncryptionFormGroupSchemaType) => {
        const selectedVaultData = vaults?.find(
            (i) => i.DBIndex?.toString() === selectedVault,
        );

        if (!selectedVaultData) return;

        setIsDecrypting(true);
        const decryptRes = await executeCallback(selectedVaultData, formData);
        setIsDecrypting(false);

        // Time the form reset so that it doesn't disturb the UX
        if (decryptRes.isErr()) {
            console.error("Decryption failed:", decryptRes.error);
            return;
        }

        setTimeout(() => {
            resetForm();
        }, 200);
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

            // Remove the last selected vault from LocalStorage because it is no longer valid
            localStorage.removeItem(LOCAL_STORAGE_LAST_SELECTED_VAULT);
        } catch (e) {
            console.error("Error deleting vault:", e);
            setIsVaultDeletingError(true);
            return;
        } finally {
            setIsVaultDeleting(false);
        }

        // Reset the form
        resetForm();
    };

    useEffect(() => {
        // Update the selected vault name after the vault has been selected
        const selectedVaultData = vaults?.find(
            (i) => i.DBIndex?.toString() === selectedVault,
        );

        if (!selectedVaultData) return;

        setSelectedVaultDisplayName(selectedVaultData.Name);
    }, [selectedVault]);

    useEffect(() => {
        if (vaults?.length) {
            // Try to load the last selected vault from LocalStorage
            const lastSelectedVault = localStorage.getItem(
                LOCAL_STORAGE_LAST_SELECTED_VAULT,
            );

            // Make sure the last selected vault still exists in the vaults array
            const exists =
                vaults.findIndex(
                    (v) => v.DBIndex && v.DBIndex === Number(lastSelectedVault),
                ) !== -1;

            // Set the last selected vault or default to the first one
            if (lastSelectedVault && exists) {
                setSelectedVault(lastSelectedVault);
            } else {
                setSelectedVault(vaults[0]!.DBIndex?.toString() ?? "UNKNOWN");
            }
        }
        setFocus("Secret");
    }, [vaults]);

    if (vaults == null) return null;

    return (
        <div className="space-y-4 pt-4">
            <div className="space-y-2">
                <Label htmlFor="vault-select">Select Vault *</Label>
                <div className="flex items-center gap-2">
                    <Select
                        value={selectedVault}
                        onValueChange={setSelectedVault}
                    >
                        <SelectTrigger id="vault-select">
                            <SelectValue placeholder="Select a vault" />
                        </SelectTrigger>
                        <SelectContent>
                            {vaults.map((vault) => (
                                <SelectItem
                                    key={vault.DBIndex}
                                    value={
                                        vault.DBIndex?.toString() ?? "UNKNOWN"
                                    }
                                >
                                    <span className="line-clamp-2 max-w-56 text-ellipsis text-start">
                                        {vault.Name}
                                    </span>
                                    <span className="line-clamp-2 max-w-60 text-ellipsis text-start text-xs text-muted-foreground">
                                        {vault.Description.length > 0
                                            ? vault.Description
                                            : "No description provided"}
                                    </span>
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Button
                        size="sm"
                        variant="ghost"
                        onClick={openEditDialog}
                        disabled={isVaultDeleting || isDecrypting || isVaultUpdating}
                        className="h-8 w-8 p-0"
                    >
                        <Edit2 className="h-4 w-4" />
                        <span className="sr-only">Edit vault "{selectedVaultDisplayName}"</span>
                    </Button>
                    <AlertDialog>
                        <AlertDialogTrigger asChild>
                            <Button
                                size="sm"
                                variant="ghost"
                                disabled={isVaultDeleting || isDecrypting}
                                className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                            >
                                <Trash2 className="h-4 w-4" />
                                <span className="sr-only">
                                    Delete vault &quot;
                                    {selectedVaultDisplayName}&quot;
                                </span>
                            </Button>
                        </AlertDialogTrigger>
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
                                    ? This action cannot be undone and will
                                    permanently remove all vault data.
                                    {isVaultDeletingError && (
                                        <p className="text-destructive-foreground">
                                            There was an error deleting the
                                            vault. Please try again. There is
                                            more information in the console.
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
                                            <LoaderCircle className="-ml-1 mr-2 h-4 w-4 animate-spin text-white" />
                                            Deleting...
                                        </span>
                                    ) : (
                                        "Delete Vault"
                                    )}
                                </AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>
                </div>

                <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
                    <DialogContent className="sm:max-w-[425px]">
                        <DialogHeader>
                            <DialogTitle>Edit Vault</DialogTitle>
                            <DialogDescription>
                                Make changes to your vault information here. Click save when you're done.
                            </DialogDescription>
                        </DialogHeader>
                        <form onSubmit={handleEditSubmit(handleVaultUpdate)}>
                            <div className="flex flex-col gap-4 py-4">
                                <div className="flex items-center gap-4">
                                    <Label htmlFor="edit-name" className="w-24 text-right flex-shrink-0">
                                        Name *
                                    </Label>
                                    <div className="w-full">
                                    <FormInput
                                        id="edit-name"
                                        type="text"
                                        placeholder="Vault name"
                                        className="flex-1 w-full"
                                        {...registerEdit("Name")}
                                    />
                                    </div>
                                </div>
                                {editErrors.Name && (
                                    <p className="text-destructive-foreground ml-28">
                                        {editErrors.Name.message}
                                    </p>
                                )}
                                <div className="flex items-start gap-4">
                                    <Label htmlFor="edit-description" className="w-24 text-right flex-shrink-0 mt-2">
                                        Description
                                    </Label>
                                    <Textarea
                                        id="edit-description"
                                        placeholder="Vault description (optional)"
                                        className="w-full pr-10"
                                        {...registerEdit("Description")}
                                    />
                                </div>
                                {editErrors.Description && (
                                    <p className="text-destructive-foreground ml-28">
                                        {editErrors.Description.message}
                                    </p>
                                )}
                                {isVaultUpdatingError && (
                                    <p className="text-destructive-foreground ml-28">
                                        There was an error updating the vault. Please try again. There is more information in the console.
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
                                <Button
                                    type="submit"
                                    disabled={isVaultUpdating}
                                >
                                    {isVaultUpdating ? (
                                        <span className="flex items-center">
                                            <LoaderCircle className="-ml-1 mr-2 h-4 w-4 animate-spin text-white" />
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
            </div>

            <div className="space-y-2">
                <Label htmlFor="secret-key">Secret Key *</Label>
                <FormInput
                    id="secret-key"
                    type="password"
                    placeholder="Enter your secret key"
                    className="pr-10"
                    {...register("Secret")}
                    setValue={(value) => setValue("Secret", value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") {
                            handleSubmit(tryUnlock)();
                        }
                    }}
                />
                {errors.Secret && (
                    <p className="text-destructive-foreground">
                        {errors.Secret.message}
                    </p>
                )}
            </div>

            <div className="space-y-2">
                <Accordion
                    type="single"
                    collapsible
                    className="w-full rounded-md border"
                >
                    <AccordionItem value="decryption-config">
                        <AccordionTrigger className="px-4">
                            Decryption Configuration
                        </AccordionTrigger>
                        <AccordionContent className="space-y-4 px-4 pb-4">
                            <div className="space-y-2">
                                <Label htmlFor="decryption-algorithm">
                                    Decryption Algorithm
                                </Label>
                                <Controller
                                    name="Encryption"
                                    control={control}
                                    render={({ field }) => (
                                        <Select
                                            value={field.value.toString()}
                                            onValueChange={(value) => {
                                                field.onChange(Number(value));
                                            }}
                                        >
                                            <SelectTrigger id="decryption-algorithm">
                                                <SelectValue placeholder="Select algorithm" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {Object.entries(
                                                    enumToRecord(
                                                        EncryptionAlgorithm,
                                                    ),
                                                ).map(([value, label]) => (
                                                    <SelectItem
                                                        key={label}
                                                        value={String(value)}
                                                    >
                                                        {label}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    )}
                                />
                                {errors.Encryption && (
                                    <p className="text-destructive-foreground">
                                        {errors.Encryption.message}
                                    </p>
                                )}
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="key-derivation-function">
                                    Key Derivation Function
                                </Label>
                                <Controller
                                    name="EncryptionKeyDerivationFunction"
                                    control={control}
                                    render={({ field }) => (
                                        <Select
                                            value={field.value.toString()}
                                            onValueChange={(value) => {
                                                field.onChange(Number(value));
                                            }}
                                        >
                                            <SelectTrigger id="key-derivation-function">
                                                <SelectValue placeholder="Select function" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {Object.entries(
                                                    enumToRecord(
                                                        KeyDerivationFunction,
                                                    ),
                                                ).map(([value, label]) => (
                                                    <SelectItem
                                                        key={label}
                                                        value={String(value)}
                                                    >
                                                        {label}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    )}
                                />
                                {errors.EncryptionKeyDerivationFunction && (
                                    <p className="text-destructive-foreground">
                                        {
                                            errors
                                                .EncryptionKeyDerivationFunction
                                                .message
                                        }
                                    </p>
                                )}
                            </div>

                            {watch(
                                "EncryptionKeyDerivationFunction",
                            ).toString() ===
                                KeyDerivationFunction.Argon2ID.toString() && (
                                <>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <Label htmlFor="memory-limit">
                                                Memory Limit (MiB)
                                            </Label>
                                            <Input
                                                id="memory-limit"
                                                type="number"
                                                min={
                                                    KeyDerivationConfig_Argon2ID.MIN_MEM_LIMIT
                                                }
                                                {...register(
                                                    "EncryptionConfig.memLimit",
                                                )}
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label htmlFor="operations-limit">
                                                Operations Limit
                                            </Label>
                                            <Input
                                                id="operations-limit"
                                                type="number"
                                                min={
                                                    KeyDerivationConfig_Argon2ID.MIN_OPS_LIMIT
                                                }
                                                max={
                                                    KeyDerivationConfig_Argon2ID.MAX_OPS_LIMIT
                                                }
                                                {...register(
                                                    "EncryptionConfig.opsLimit",
                                                )}
                                            />
                                        </div>
                                    </div>
                                </>
                            )}

                            {watch(
                                "EncryptionKeyDerivationFunction",
                            ).toString() ===
                                KeyDerivationFunction.PBKDF2.toString() && (
                                <>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <Label htmlFor="memory-limit">
                                                Iterations
                                            </Label>
                                            <Input
                                                id="pkdf-iterations"
                                                type="number"
                                                min={2}
                                                {...register(
                                                    "EncryptionConfig.iterations",
                                                )}
                                            />
                                        </div>
                                    </div>
                                </>
                            )}
                            {errors.EncryptionConfig && (
                                <p className="text-destructive-foreground">
                                    {errors.EncryptionConfig.message}
                                </p>
                            )}

                            {/* <div className="space-y-2"> */}
                            {/*     <Label htmlFor="additional-config"> */}
                            {/*         Additional Configuration (JSON) */}
                            {/*     </Label> */}
                            {/*     <Textarea */}
                            {/*         id="additional-config" */}
                            {/*         value={decryptionConfig} */}
                            {/*         onChange={(e) => */}
                            {/*             setDecryptionConfig(e.target.value) */}
                            {/*         } */}
                            {/*         placeholder="Enter additional configuration as JSON" */}
                            {/*         rows={3} */}
                            {/*     /> */}
                            {/* </div> */}
                            {/* --------------------- */}
                        </AccordionContent>
                    </AccordionItem>
                </Accordion>
            </div>

            <Button
                className="w-full"
                variant="link"
                onClick={handleSubmit(tryUnlock)}
                disabled={isDecrypting || selectedVault.length === 0}
            >
                {isDecrypting ? (
                    <span className="flex items-center">
                        <LoaderCircle className="-ml-1 mr-2 h-4 w-4 animate-spin text-white" />
                        Decrypting Vault...
                    </span>
                ) : (
                    <span className="flex items-center">
                        <Unlock className="mr-2 h-4 w-4" />
                        Unlock Vault
                    </span>
                )}
            </Button>
        </div>
    );
};

export default UnlockTab;
