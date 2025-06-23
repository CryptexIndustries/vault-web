import { Label } from "../ui/label";
import { Input } from "../ui/input";
import { cn } from "@/lib/utils";
import { CheckCircle, LoaderCircle, UploadCloud } from "lucide-react";
import { Button } from "../ui/button";
import { FormInput } from "../general/input-fields";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
    vaultRestoreFormSchema,
    VaultRestoreFormSchema,
} from "@/app_lib/vault-utils/form-schemas";
import { Textarea } from "../ui/textarea";

const RestoreTab: React.FC<{
    executeCallback: (formData: VaultRestoreFormSchema) => Promise<boolean>;
}> = ({ executeCallback }) => {
    const {
        handleSubmit,
        control,
        register,
        formState: { errors, isSubmitting },
        watch,
        setValue,
        resetField,
    } = useForm<VaultRestoreFormSchema>({
        resolver: zodResolver(vaultRestoreFormSchema),
        defaultValues: {
            Name: `Restored Vault ${new Date().toLocaleString()}`,
            Description: "",
            Secret: "",
            BackupFile: undefined,
        },
    });

    const tryRestore = async (formData: VaultRestoreFormSchema) =>
        await executeCallback(formData);

    return (
        <div className="space-y-4 pt-4">
            <div className="space-y-2">
                <Label htmlFor="restore-vault-name">Vault Name</Label>
                <Input
                    id="restore-vault-name"
                    placeholder="Enter a name for the restored vault"
                    {...register("Name")}
                />
                {errors.Name && (
                    <p className="text-destructive-foreground">
                        {errors.Name.message}
                    </p>
                )}
            </div>

            <div className="space-y-2">
                <Label htmlFor="restore-vault-description">
                    Vault Description
                </Label>
                <Textarea
                    id="restore-vault-description"
                    placeholder="Enter a description for the restored vault"
                    className="max-h-20 pr-10"
                    {...register("Description")}
                />
                {errors.Description && (
                    <p className="text-destructive-foreground">
                        {errors.Description.message}
                    </p>
                )}
            </div>

            <div className="space-y-2">
                <Label htmlFor="restore-backup-file">Backup File (.cryx)</Label>
                <div
                    className={cn(
                        "relative rounded-lg border-2 border-dashed p-6 transition-colors",
                        watch("BackupFile")! instanceof File
                            ? "border-green-500 bg-green-50 dark:bg-green-950/20"
                            : "border-muted-foreground/25 hover:border-muted-foreground/50",
                        "focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20",
                    )}
                    onDragOver={(e) => {
                        e.preventDefault();
                        e.currentTarget.classList.add(
                            "border-primary",
                            "bg-primary/5",
                        );
                    }}
                    onDragLeave={(e) => {
                        e.preventDefault();
                        e.currentTarget.classList.remove(
                            "border-primary",
                            "bg-primary/5",
                        );
                    }}
                    onDrop={(e) => {
                        e.preventDefault();
                        e.currentTarget.classList.remove(
                            "border-primary",
                            "bg-primary/5",
                        );

                        const files = Array.from(e.dataTransfer.files);
                        const cryxFile = files.find((file) =>
                            file.name.endsWith(".cryx"),
                        );

                        if (cryxFile) setValue("BackupFile", cryxFile);
                    }}
                >
                    <Controller
                        name="BackupFile"
                        control={control}
                        render={({ field }) => (
                            <input
                                id="restore-backup-file"
                                type="file"
                                accept=".cryx"
                                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                                onChange={(e) => {
                                    field.onChange(e.target.files?.[0] ?? null);
                                }}
                            />
                        )}
                    />
                    <div className="flex flex-col items-center justify-center text-center">
                        {watch("BackupFile")! instanceof File ? (
                            <>
                                <CheckCircle className="mb-2 h-8 w-8 text-green-500" />
                                <p className="text-sm font-medium text-green-700 dark:text-green-400">
                                    File Selected
                                </p>
                                <p className="mt-1 break-all text-xs text-green-600 dark:text-green-500">
                                    {watch("BackupFile")?.name ??
                                        "File with no name"}
                                </p>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="z-10 mt-2 text-xs"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        resetField("BackupFile");

                                        // Set the backup-file input value to ""
                                        const input = document.getElementById(
                                            "restore-backup-file",
                                        ) as HTMLInputElement;

                                        if (input) input.value = "";
                                    }}
                                >
                                    Remove file
                                </Button>
                            </>
                        ) : (
                            <>
                                <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                                    <UploadCloud className="h-6 w-6 text-muted-foreground" />
                                </div>
                                <p className="mb-1 text-sm font-medium text-foreground">
                                    Drop your .cryx file here, or click to
                                    browse
                                </p>
                                <p className="text-xs text-muted-foreground">
                                    Only .cryx vault backup files are supported
                                </p>
                            </>
                        )}
                    </div>
                </div>
                {errors.BackupFile && (
                    <p className="text-destructive-foreground">
                        {errors.BackupFile.message}
                    </p>
                )}
            </div>

            <div className="space-y-2">
                <Label htmlFor="restore-secret-key">Secret Key</Label>
                <FormInput
                    id="restore-secret-key"
                    type="password"
                    placeholder="Enter the vault's secret key"
                    className="pr-10"
                    {...register("Secret")}
                />
                {errors.Secret && (
                    <p className="text-destructive-foreground">
                        {errors.Secret.message}
                    </p>
                )}
            </div>

            <Button
                className="w-full"
                variant="link"
                onClick={handleSubmit(tryRestore)}
                disabled={isSubmitting}
            >
                {isSubmitting ? (
                    <span className="flex items-center">
                        <LoaderCircle className="-ml-1 mr-2 h-4 w-4 animate-spin text-white" />
                        Restoring...
                    </span>
                ) : (
                    "Restore Vault"
                )}
            </Button>
        </div>
    );
};

export default RestoreTab;
