import {
    Download,
    FileJson,
    Settings,
    ShieldCheck,
    Upload,
} from "lucide-react";
import { useAtom, useAtomValue } from "jotai/react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import * as ImportExport from "@cryptex-industries/vault-core/vault-utils/import-export";
import { Button } from "@/components/ui/button";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { DashboardScreen } from "@/components/vault-dashboard/dashboard-screen";
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

type VaultSettingsViewProps = {
    onBack: () => void;
    onOpenLogInspector: () => void;
};

export function VaultSettingsView({
    onBack,
    onOpenLogInspector,
}: VaultSettingsViewProps) {
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

    return (
        <>
            <DashboardScreen
                icon={Settings}
                title="Vault Settings"
                description="Manage vault behavior, import/export, encryption, and diagnostics."
                onBack={onBack}
            >
                <SettingsSection title="Vault">
                    <SettingsRow title="Name">
                        <span className="max-w-[60vw] truncate text-sm font-medium sm:max-w-xs">
                            {vaultMetadata?.Name || "Unknown Vault"}
                        </span>
                    </SettingsRow>
                    <SettingsRow title="Created">
                        <span className="text-sm font-medium">
                            {vaultMetadata?.CreatedAt
                                ? new Date(
                                      vaultMetadata.CreatedAt,
                                  ).toLocaleDateString(undefined, {
                                      dateStyle: "medium",
                                  })
                                : "Unknown"}
                        </span>
                    </SettingsRow>
                    <SettingsRow
                        title="Auto-lock"
                        description="Locks after this long without activity. Saved for this browser."
                    >
                        <Select
                            value={String(autoLockTimeoutMs)}
                            onValueChange={(value) =>
                                setAutoLockTimeoutMs(Number(value))
                            }
                        >
                            <SelectTrigger
                                className="w-32 sm:w-40"
                                aria-label="Inactivity timeout"
                            >
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {VAULT_AUTO_LOCK_TIMEOUT_OPTIONS.map(
                                    (option) => (
                                        <SelectItem
                                            key={option.value}
                                            value={String(option.value)}
                                        >
                                            {option.label}
                                        </SelectItem>
                                    ),
                                )}
                            </SelectContent>
                        </Select>
                    </SettingsRow>
                </SettingsSection>

                <SettingsSection title="Your data">
                    <SettingsRow
                        title="Import passwords"
                        description="From other password managers and browsers."
                    >
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setIsImportWizardOpen(true)}
                        >
                            <Upload className="h-4 w-4" />
                            Import
                        </Button>
                    </SettingsRow>
                    <SettingsRow
                        title="Export as JSON"
                        description={
                            <span className="text-amber-700 dark:text-amber-300">
                                The file isn&apos;t encrypted. Keep it safe and
                                delete it when you&apos;re done.
                            </span>
                        }
                    >
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={handleExportData}
                        >
                            <Download className="h-4 w-4" />
                            Export
                        </Button>
                    </SettingsRow>
                </SettingsSection>

                <SettingsSection title="Security">
                    <SettingsRow
                        title="Encryption & Security"
                        description="Master password, additional key protection and recovery code."
                    >
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setIsSecurityDialogOpen(true)}
                        >
                            <ShieldCheck className="h-4 w-4" />
                            Manage
                        </Button>
                    </SettingsRow>
                </SettingsSection>

                <SettingsSection title="Diagnostics">
                    <SettingsRow
                        title="Log Inspector"
                        description={`${logCount} ${logCount === 1 ? "log" : "logs"} on this device.`}
                    >
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={onOpenLogInspector}
                        >
                            <FileJson className="h-4 w-4" />
                            Open
                        </Button>
                    </SettingsRow>
                </SettingsSection>
            </DashboardScreen>

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

function SettingsSection({
    title,
    children,
}: {
    title: string;
    children: ReactNode;
}) {
    return (
        <section className="mb-8 last:mb-0">
            <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {title}
            </h2>
            <div className="divide-y divide-border rounded-lg border border-border">
                {children}
            </div>
        </section>
    );
}

function SettingsRow({
    title,
    description,
    children,
}: {
    title: string;
    description?: ReactNode;
    children: ReactNode;
}) {
    return (
        <div className="flex items-center gap-4 px-4 py-3">
            <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{title}</p>
                {description ? (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                        {description}
                    </p>
                ) : null}
            </div>
            <div className="shrink-0">{children}</div>
        </div>
    );
}
