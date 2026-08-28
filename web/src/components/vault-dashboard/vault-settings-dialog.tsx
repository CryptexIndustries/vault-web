import { FileJson, ShieldCheck, Upload } from "lucide-react";
import { useAtom, useAtomValue } from "jotai/react";
import { useState } from "react";
import { toast } from "sonner";
import * as ImportExport from "@cryptex-industries/vault-core/vault-utils/import-export";
import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { VaultSecurityDialog } from "@/components/vault-dashboard/vault-security-dialog";
import { ImportWizard } from "@/components/vault-import/import-wizard";
import { unlockedVaultAtom, unlockedVaultMetadataAtom } from "@/utils/atoms";
import { vaultLog, vaultLogger } from "@/utils/logging";
import { MISSING_VAULT_SECRET_ERROR } from "@/utils/vault-session";
import { persistVaultMutation } from "@/utils/vault-mutations";
import {
    VAULT_AUTO_LOCK_TIMEOUT_OPTIONS,
    vaultAutoLockTimeoutAtom,
} from "@/utils/vault-auto-lock";

type VaultSettingsDialogProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onOpenLogInspector: () => void;
};

export function VaultSettingsDialog({
    open,
    onOpenChange,
    onOpenLogInspector,
}: VaultSettingsDialogProps) {
    const vaultMetadata = useAtomValue(unlockedVaultMetadataAtom);
    const unlockedVault = useAtomValue(unlockedVaultAtom);
    const [autoLockTimeoutMs, setAutoLockTimeoutMs] = useAtom(
        vaultAutoLockTimeoutAtom,
    );
    const [isSecurityDialogOpen, setIsSecurityDialogOpen] = useState(false);
    const [isImportWizardOpen, setIsImportWizardOpen] = useState(false);

    const logCount = Object.values(vaultLogger.getLogCounts()).reduce(
        (count, value) => count + value,
        0,
    );

    const importCredentials = async (result: ImportExport.ImportResult) => {
        const mutationResult = await persistVaultMutation(
            "credentials.import",
            async (currentVault) => {
                const applied = await ImportExport.applyImportToVault(
                    currentVault,
                    result,
                );
                return { vault: applied.vault, result: applied };
            },
        );
        if (mutationResult.isErr()) {
            if (mutationResult.error === "VAULT_DEK_NOT_FOUND") {
                toast.error(MISSING_VAULT_SECRET_ERROR);
                return;
            }
            if (mutationResult.error === "VAULT_METADATA_MISSING") {
                toast.error("Vault metadata is unavailable.");
                return;
            }
            throw new Error("VAULT_SAVE_FAILED");
        }

        const applied = mutationResult.value;
        toast.success(
            `Imported ${applied.importedCredentials} items${
                applied.importedDirectories
                    ? ` and ${applied.importedDirectories} directories`
                    : ""
            }.`,
        );
    };

    const handleExportData = () => {
        try {
            ImportExport.vaultToJSON(unlockedVault);
            toast.success("Vault exported as JSON.");
        } catch (error) {
            vaultLog.error("Failed to export vault JSON", { error });
            toast.error("Failed to export vault data.");
        }
    };

    const sectionCardClassName = "vault-settings-card min-w-0 shadow-sm";
    const actionButtonClassName =
        "vault-settings-action-button h-auto w-full justify-start gap-2 whitespace-normal break-words py-2 text-left";

    return (
        <>
            <Dialog open={open} onOpenChange={onOpenChange}>
                <DialogContent className="vault-settings-dialog flex h-[88vh] w-[96vw] max-w-5xl flex-col gap-0 overflow-hidden p-0 shadow-2xl">
                    <DialogHeader className="vault-settings-header border-b px-4 py-4 sm:px-6">
                        <DialogTitle className="text-xl tracking-tight">
                            Vault Settings
                        </DialogTitle>
                        <DialogDescription>
                            Manage vault behavior, import/export, encryption,
                            and diagnostics.
                        </DialogDescription>
                    </DialogHeader>

                    <ScrollArea className="flex-1">
                        <div className="grid grid-cols-1 gap-4 p-3 sm:p-6 md:grid-cols-2">
                            <Card className={sectionCardClassName}>
                                <CardHeader className="pb-3">
                                    <CardTitle className="text-base">
                                        Vault Info
                                    </CardTitle>
                                    <CardDescription>
                                        Current vault metadata.
                                    </CardDescription>
                                </CardHeader>
                                <CardContent className="space-y-3 text-sm">
                                    <div className="flex items-center justify-between gap-3">
                                        <span className="text-muted-foreground">
                                            Name
                                        </span>
                                        <span className="max-w-[70%] truncate text-right font-medium">
                                            {vaultMetadata?.Name ||
                                                "Unknown Vault"}
                                        </span>
                                    </div>
                                    <div className="flex items-center justify-between gap-3">
                                        <span className="text-muted-foreground">
                                            Created
                                        </span>
                                        <span className="font-medium">
                                            {vaultMetadata?.CreatedAt
                                                ? new Date(
                                                      vaultMetadata.CreatedAt,
                                                  ).toLocaleDateString()
                                                : "Unknown"}
                                        </span>
                                    </div>
                                </CardContent>
                            </Card>

                            <Card className={sectionCardClassName}>
                                <CardHeader className="pb-3">
                                    <CardTitle className="text-base">
                                        Auto-lock
                                    </CardTitle>
                                    <CardDescription>
                                        Lock this vault after a period of
                                        inactivity.
                                    </CardDescription>
                                </CardHeader>
                                <CardContent className="space-y-2">
                                    <label
                                        className="text-sm font-medium"
                                        htmlFor="vault-auto-lock-timeout"
                                    >
                                        Inactivity timeout
                                    </label>
                                    <Select
                                        value={String(autoLockTimeoutMs)}
                                        onValueChange={(value) =>
                                            setAutoLockTimeoutMs(Number(value))
                                        }
                                    >
                                        <SelectTrigger id="vault-auto-lock-timeout">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {VAULT_AUTO_LOCK_TIMEOUT_OPTIONS.map(
                                                (option) => (
                                                    <SelectItem
                                                        key={option.value}
                                                        value={String(
                                                            option.value,
                                                        )}
                                                    >
                                                        {option.label}
                                                    </SelectItem>
                                                ),
                                            )}
                                        </SelectContent>
                                    </Select>
                                    <p className="text-xs text-muted-foreground">
                                        Saved for this browser. Activity resets
                                        the timer.
                                    </p>
                                </CardContent>
                            </Card>

                            <Card className={sectionCardClassName}>
                                <CardHeader className="pb-3">
                                    <CardTitle className="text-base">
                                        Import
                                    </CardTitle>
                                    <CardDescription>
                                        Import from password managers and
                                        browsers.
                                    </CardDescription>
                                </CardHeader>
                                <CardContent className="space-y-2">
                                    <Button
                                        variant="outline"
                                        className={actionButtonClassName}
                                        onClick={() =>
                                            setIsImportWizardOpen(true)
                                        }
                                    >
                                        <Upload className="h-4 w-4" />
                                        Import Passwords
                                    </Button>
                                </CardContent>
                            </Card>

                            <Card className={sectionCardClassName}>
                                <CardHeader className="pb-3">
                                    <CardTitle className="text-base">
                                        Export
                                    </CardTitle>
                                    <CardDescription>
                                        Export clear-text JSON for migration.
                                    </CardDescription>
                                </CardHeader>
                                <CardContent className="space-y-2">
                                    <div className="vault-settings-warning rounded-md border p-3 text-xs">
                                        Exported JSON is unencrypted. Store it
                                        safely.
                                    </div>
                                    <Button
                                        variant="outline"
                                        className={actionButtonClassName}
                                        onClick={handleExportData}
                                    >
                                        <FileJson className="h-4 w-4" />
                                        Export Data
                                    </Button>
                                </CardContent>
                            </Card>

                            <Card className={sectionCardClassName}>
                                <CardHeader className="pb-3">
                                    <CardTitle className="text-base">
                                        Encryption &amp; Security
                                    </CardTitle>
                                    <CardDescription>
                                        Master password, additional key
                                        protection, and recovery code.
                                    </CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <Button
                                        variant="outline"
                                        className={actionButtonClassName}
                                        onClick={() =>
                                            setIsSecurityDialogOpen(true)
                                        }
                                    >
                                        <ShieldCheck className="h-4 w-4" />
                                        Manage Encryption &amp; Security
                                    </Button>
                                </CardContent>
                            </Card>

                            <Card className={sectionCardClassName}>
                                <CardHeader className="pb-3">
                                    <CardTitle className="text-base">
                                        Developer Tools
                                    </CardTitle>
                                    <CardDescription>
                                        Inspect and manage diagnostic logs.
                                    </CardDescription>
                                </CardHeader>
                                <CardContent className="space-y-2">
                                    <p className="text-xs text-muted-foreground">
                                        Available logs:{" "}
                                        <span className="font-mono text-foreground">
                                            {logCount}
                                        </span>
                                    </p>
                                    <Separator />
                                    <Button
                                        variant="outline"
                                        className={actionButtonClassName}
                                        onClick={onOpenLogInspector}
                                    >
                                        <FileJson className="h-4 w-4" />
                                        Open Log Inspector
                                    </Button>
                                </CardContent>
                            </Card>
                        </div>
                    </ScrollArea>

                    <DialogFooter className="vault-settings-footer border-t px-4 py-4 sm:px-6">
                        <DialogClose asChild>
                            <Button
                                variant="outline"
                                className="vault-settings-action-button"
                            >
                                Close
                            </Button>
                        </DialogClose>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <VaultSecurityDialog
                open={isSecurityDialogOpen}
                onOpenChange={setIsSecurityDialogOpen}
            />
            <ImportWizard
                open={isImportWizardOpen}
                onOpenChange={setIsImportWizardOpen}
                onConfirm={importCredentials}
            />
        </>
    );
}
