import { Download, FileJson, ShieldCheck, Upload } from "lucide-react";
import { useAtomValue, useSetAtom } from "jotai/react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import * as ImportExport from "@/app_lib/vault-utils/import-export";
import * as Storage from "@/app_lib/vault-utils/storage";
import {
    assimilateImportedCredential,
    upsertGroup,
    Vault as VaultInstance,
} from "@/app_lib/vault-utils/vault";
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
import { Separator } from "@/components/ui/separator";
import { VaultSecurityDialog } from "@/components/vault-dashboard/vault-security-dialog";
import {
    unlockedVaultAtom,
    unlockedVaultMetadataAtom,
    unlockedVaultWriteOnlyAtom,
} from "@/utils/atoms";
import { importLog, vaultLog, vaultLogger } from "@/utils/logging";
import {
    MISSING_VAULT_SECRET_ERROR,
    getVaultDEKFromSession,
    saveVaultWithSessionDEK,
} from "@/utils/vault-session";
import { BACKUP_FILE_EXTENSION } from "src/utils/consts";

type VaultSettingsDialogProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onOpenLogInspector: () => void;
};

function buildCsvMapping(columns: string[]): ImportExport.FieldsSchemaType {
    const lookup = new Map(
        columns.map((column) => [column.toLowerCase().trim(), column]),
    );
    const pick = (...aliases: string[]) => {
        for (const alias of aliases) {
            const found = lookup.get(alias.toLowerCase());
            if (found) return found;
        }
        return null;
    };

    return {
        Name: pick("name", "title", "site", "service"),
        Username: pick("username", "user", "email", "login"),
        Password: pick("password", "pass"),
        TOTP: pick("totp", "2fa", "otp", "authenticator"),
        Tags: pick("tags", "tag", "folder"),
        URL: pick("url", "website", "uri", "login_uri"),
        Notes: pick("notes", "note"),
        DateCreatedTimestamp: pick(
            "datecreatedtimestamp",
            "createdat",
            "created",
        ) as unknown as number | null,
        DateModifiedTimestamp: pick(
            "datemodifiedtimestamp",
            "updatedat",
            "updated",
        ) as unknown as number | null,
        DatePasswordChangedTimestamp: pick(
            "datepasswordchangedtimestamp",
            "passwordchangedat",
        ) as unknown as number | null,
        TagDelimiter: ",",
        Deleted: pick("deleted"),
    };
}

export function VaultSettingsDialog({
    open,
    onOpenChange,
    onOpenLogInspector,
}: VaultSettingsDialogProps) {
    const vaultMetadata = useAtomValue(unlockedVaultMetadataAtom);
    const unlockedVault = useAtomValue(unlockedVaultAtom);
    const setUnlockedVault = useSetAtom(unlockedVaultWriteOnlyAtom);
    const [isLoading, setIsLoading] = useState(false);
    const [isSecurityDialogOpen, setIsSecurityDialogOpen] = useState(false);
    const bitwardenInputRef = useRef<HTMLInputElement>(null);
    const csvInputRef = useRef<HTMLInputElement>(null);

    const logCount = Object.values(vaultLogger.getLogCounts()).reduce(
        (count, value) => count + value,
        0,
    );

    const ensureDEK = async () => {
        const dekRes = await getVaultDEKFromSession();
        if (dekRes.isErr()) {
            toast.error(MISSING_VAULT_SECRET_ERROR);
            return null;
        }
        return dekRes.value;
    };

    const importCredentials = async (
        credentials: Awaited<
            ReturnType<typeof ImportExport.BitwardenJSON>
        >["credentials"],
        groups: Awaited<
            ReturnType<typeof ImportExport.BitwardenJSON>
        >["groups"] = [],
    ) => {
        if (!vaultMetadata) {
            toast.error("Vault metadata is unavailable.");
            return;
        }

        const sessionDek = await ensureDEK();
        if (!sessionDek) return;

        const vaultCopy = Object.assign(new VaultInstance(), unlockedVault);

        for (const group of groups) {
            const existing =
                vaultCopy.Groups.find((item) => item.ID === group.ID) ?? null;
            const merged = upsertGroup(existing, group);
            if (!existing) {
                vaultCopy.Groups.push(merged);
            }
        }

        for (const credential of credentials) {
            const assimilated = await assimilateImportedCredential(credential);
            vaultCopy.Credentials.push(assimilated);
        }

        const saveRes = await saveVaultWithSessionDEK(vaultMetadata, vaultCopy);
        if (saveRes.isErr()) {
            if (saveRes.error === "VAULT_DEK_NOT_FOUND") {
                return;
            }
            throw new Error("VAULT_SAVE_FAILED");
        }
        await setUnlockedVault(async () => vaultCopy);
    };

    const handleManualBackup = async () => {
        if (!vaultMetadata?.Blob) {
            toast.error("Vault metadata is unavailable.");
            return;
        }

        const sessionDek = await ensureDEK();
        if (!sessionDek) return;

        setIsLoading(true);
        try {
            const serializedData = await Storage.serializeVault(
                unlockedVault,
                vaultMetadata.Blob,
                sessionDek,
            );
            const blob = new Blob([serializedData], {
                type: "application/octet-stream",
            });
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = `cryptexvault-bk-${Date.now()}.${BACKUP_FILE_EXTENSION}`;
            anchor.click();
            URL.revokeObjectURL(url);
            toast.success("Vault backup complete.");
        } catch (error) {
            vaultLog.error("Failed to backup vault", { error });
            toast.error("Failed to create encrypted backup.");
            return;
        } finally {
            setIsLoading(false);
        }
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

    const handleBitwardenImport: React.ChangeEventHandler<
        HTMLInputElement
    > = async (event) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;

        setIsLoading(true);
        try {
            const { credentials, groups } =
                await ImportExport.BitwardenJSON(file);
            if (!credentials.length) {
                toast.warning("Bitwarden export has no credentials.");
                return;
            }
            await importCredentials(credentials, groups);
            toast.success(`Imported ${credentials.length} credentials.`);
        } catch (error) {
            importLog.error("Bitwarden import failed", {
                fileName: file.name,
                fileSize: file.size,
                error,
            });
            toast.error("Failed to import Bitwarden export.");
        } finally {
            setIsLoading(false);
        }
    };

    const handleCsvImport: React.ChangeEventHandler<HTMLInputElement> = async (
        event,
    ) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;

        setIsLoading(true);
        try {
            const columns = await new Promise<string[]>((resolve, reject) => {
                ImportExport.CSVGetColNames(file, resolve, reject);
            });

            if (!columns.length) {
                toast.warning("CSV file has no headers.");
                return;
            }

            const fieldMapping = buildCsvMapping(columns);

            await new Promise<void>((resolve, reject) => {
                ImportExport.CSV(
                    file,
                    fieldMapping,
                    async (credentials) => {
                        if (!credentials.length) {
                            toast.warning("CSV file has no credentials.");
                            resolve();
                            return;
                        }
                        await importCredentials(credentials);
                        toast.success(
                            `Imported ${credentials.length} credentials.`,
                        );
                        resolve();
                    },
                    reject,
                );
            });
        } catch (error) {
            importLog.error("CSV import failed", {
                fileName: file.name,
                fileSize: file.size,
                error,
            });
            toast.error("Failed to import CSV file.");
        } finally {
            setIsLoading(false);
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
                            Manage backup, import/export, encryption, and
                            diagnostics in one place.
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
                                        Backup
                                    </CardTitle>
                                    <CardDescription>
                                        Download an encrypted backup file.
                                    </CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <Button
                                        variant="outline"
                                        className={actionButtonClassName}
                                        onClick={handleManualBackup}
                                        disabled={isLoading}
                                    >
                                        <Download className="h-4 w-4" />
                                        Manual Backup
                                    </Button>
                                </CardContent>
                            </Card>

                            <Card className={sectionCardClassName}>
                                <CardHeader className="pb-3">
                                    <CardTitle className="text-base">
                                        Import
                                    </CardTitle>
                                    <CardDescription>
                                        Import from Bitwarden JSON or generic
                                        CSV.
                                    </CardDescription>
                                </CardHeader>
                                <CardContent className="space-y-2">
                                    <Button
                                        variant="outline"
                                        className={actionButtonClassName}
                                        onClick={() =>
                                            bitwardenInputRef.current?.click()
                                        }
                                        disabled={isLoading}
                                    >
                                        <Upload className="h-4 w-4" />
                                        Import Bitwarden JSON
                                    </Button>
                                    <Button
                                        variant="outline"
                                        className={actionButtonClassName}
                                        onClick={() =>
                                            csvInputRef.current?.click()
                                        }
                                        disabled={isLoading}
                                    >
                                        <Upload className="h-4 w-4" />
                                        Import Generic CSV
                                    </Button>
                                    <input
                                        ref={bitwardenInputRef}
                                        type="file"
                                        accept=".json"
                                        className="hidden"
                                        onChange={handleBitwardenImport}
                                    />
                                    <input
                                        ref={csvInputRef}
                                        type="file"
                                        accept=".csv"
                                        className="hidden"
                                        onChange={handleCsvImport}
                                    />
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
                                        disabled={isLoading}
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
                                        Master password, second factor, and
                                        recovery code.
                                    </CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <Button
                                        variant="outline"
                                        className={actionButtonClassName}
                                        onClick={() =>
                                            setIsSecurityDialogOpen(true)
                                        }
                                        disabled={isLoading}
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
        </>
    );
}
