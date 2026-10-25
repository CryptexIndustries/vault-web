import { Alert, AlertDescription } from "@/components/ui/alert";
import {
    AlertDialog,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardFooter,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { useLiveQuery } from "dexie-react-hooks";
import { AlertCircle, CheckCircle, LoaderCircle, Shield } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/router";

import {
    EncryptionFormGroupSchemaType,
    NewVaultFormSchemaType,
    VaultRestoreFormSchema,
} from "@cryptex-industries/vault-core/vault-utils/form-schemas";
import { Err, Ok } from "neverthrow";
import * as Storage from "../../app_lib/vault-utils/storage";
import CreateVaultTab from "./create";
import { VaultRevealSecretsDialog } from "./vault-reveal-secrets-dialog";
import type {
    VaultCreateAdditionalKeyProtectionOptions,
    VaultPendingUnlock,
    VaultRevealSecrets,
    VaultUnlockFlowResult,
} from "@cryptex-industries/vault-core/vault-utils/vault-unlock-types";
import type { ImportResult } from "@cryptex-industries/vault-core/vault-utils/import-export";
import RestoreTab from "./restore";
import LinkVaultTab from "./link";
import UnlockTab from "./unlock";
import { ChangelogDialog } from "../changelog";
import * as Vault from "@cryptex-industries/vault-core/vault-utils/vault";
import { clearDeviceAdditionalKeyProtection } from "@/app_lib/vault-utils/vault-key-store";
import type { PurchasePlan } from "@/utils/purchase-onboarding";

type OperationStatus = {
    status: "idle" | "loading" | "success" | "error";
    message?: string;
};

const VaultManager: React.FC<{
    purchasePlan?: PurchasePlan | null;
    tryDecryptVaultCallback: (
        metadata: Storage.VaultMetadata,
        formData: EncryptionFormGroupSchemaType,
        unlockExtras?: {
            useRecovery?: boolean;
            recoveryCode?: string;
            protectionPhrase?: string;
        },
    ) => Promise<
        | Err<never, string>
        | Ok<VaultUnlockFlowResult<Storage.VaultMetadata>, never>
    >;
    tryCreateVaultCallback: (
        formData: NewVaultFormSchemaType & EncryptionFormGroupSchemaType,
        additionalKeyProtectionOptions?: VaultCreateAdditionalKeyProtectionOptions,
        initialImport?: ImportResult,
        linkedVault?: Vault.Vault,
    ) => Promise<
        | false
        | {
              ok: true;
              revealSecrets: VaultRevealSecrets;
              pendingUnlock: VaultPendingUnlock<Storage.VaultMetadata>;
          }
    >;
    finalizeVaultUnlockCallback: (
        metadata: Storage.VaultMetadata,
        vault: Vault.Vault,
        dek: CryptoKey,
    ) => void;
    tryRestoreVaultCallback: (
        formData: VaultRestoreFormSchema,
    ) => Promise<{ dbIndex: number } | false>;
}> = ({
    purchasePlan,
    tryDecryptVaultCallback,
    tryCreateVaultCallback,
    finalizeVaultUnlockCallback,
    tryRestoreVaultCallback,
}) => {
    const router = useRouter();
    const [activeTab, setActiveTab] = useState("loading");
    const [unsavedLinkedVault, setUnsavedLinkedVault] = useState(false);
    const [pendingLeave, setPendingLeave] = useState<
        { tab: string } | { history: true } | null
    >(null);
    const leavingRef = useRef(false);
    const [operationStatus, setOperationStatus] = useState<OperationStatus>({
        status: "idle",
    });
    const [pendingReveal, setPendingReveal] =
        useState<VaultRevealSecrets | null>(null);
    const [pendingUnlock, setPendingUnlock] =
        useState<VaultPendingUnlock<Storage.VaultMetadata> | null>(null);

    const resetForm = () => {
        setOperationStatus({ status: "idle" });
        // Don't reset algorithm selections and their parameters to preserve user preferences
    };

    const handleTabChange = (value: string) => {
        if (unsavedLinkedVault && value !== "link") {
            setPendingLeave({ tab: value });
            return;
        }
        setActiveTab(value);
        resetForm();
    };

    // A received vault lives only in this tab until it's saved.
    useEffect(() => {
        if (!unsavedLinkedVault) return;
        const onBeforeUnload = (event: BeforeUnloadEvent) => {
            event.preventDefault();
            event.returnValue = "";
        };
        window.addEventListener("beforeunload", onBeforeUnload);

        // Back and Forward stay inside the app, so beforeunload never sees them.
        const appState: unknown = window.history.state;
        const appPath = router.asPath;
        router.beforePopState(() => {
            if (leavingRef.current) return true;
            window.history.pushState(appState, "", appPath);
            setPendingLeave({ history: true });
            return false;
        });

        return () => {
            window.removeEventListener("beforeunload", onBeforeUnload);
            router.beforePopState(() => true);
        };
    }, [unsavedLinkedVault, router]);

    const leaveWithoutSaving = () => {
        setPendingLeave(null);
        if (pendingLeave && "tab" in pendingLeave) {
            setActiveTab(pendingLeave.tab);
            resetForm();
        } else {
            leavingRef.current = true;
            window.history.back();
        }
    };

    const _encryptedVaults = useLiveQuery(() => Storage.db.vaults.toArray());

    // Run the mapping but only if _encryptedVaults changes
    const encryptedVaults = useMemo(() => {
        const encVaults = _encryptedVaults?.map((metadata) =>
            Storage.VaultMetadata.deserializeMetadataBinary(
                metadata.data,
                metadata.id,
            ),
        );

        return encVaults;
    }, [_encryptedVaults]);
    const isLoading = encryptedVaults == null;

    const unlockCallback = async (
        metadata: Storage.VaultMetadata,
        formData: EncryptionFormGroupSchemaType,
        unlockExtras?: {
            useRecovery?: boolean;
            recoveryCode?: string;
            protectionPhrase?: string;
        },
    ) => {
        const success = await tryDecryptVaultCallback(
            metadata,
            formData,
            unlockExtras,
        );
        if (success.isOk()) {
            const reveal = success.value.revealSecrets;
            if (reveal) {
                setPendingReveal(reveal);
                if (success.value.pendingUnlock) {
                    setPendingUnlock(success.value.pendingUnlock);
                }
            } else {
                setOperationStatus({
                    status: "success",
                    message: "Vault unlocked successfully",
                });
            }
        } else {
            setOperationStatus({
                status: "error",
                message: "Failed to decrypt vault",
            });
        }

        return success;
    };

    const createVaultCallback = async (
        formData: NewVaultFormSchemaType & EncryptionFormGroupSchemaType,
        additionalKeyProtectionOptions?: VaultCreateAdditionalKeyProtectionOptions,
        initialImport?: ImportResult,
        linkedVault?: Vault.Vault,
    ) => {
        const success = await tryCreateVaultCallback(
            formData,
            additionalKeyProtectionOptions,
            initialImport,
            linkedVault,
        );

        if (typeof success === "object" && success.ok) {
            setPendingReveal(success.revealSecrets);
            setPendingUnlock(success.pendingUnlock);
        } else {
            setOperationStatus({
                status: "error",
                message: "Failed to create the vault",
            });
        }

        return success;
    };

    const restoreVaultCallback = async (formData: VaultRestoreFormSchema) => {
        const result = await tryRestoreVaultCallback(formData);

        if (result) {
            setActiveTab("unlock");
            setOperationStatus({
                status: "success",
                message: "Vault restored successfully",
            });
        } else {
            setOperationStatus({
                status: "error",
                message: "Failed to restore the vault",
            });
        }

        return result;
    };

    const deleteVaultCallback = async (dbIndex: number) => {
        await Storage.db.vaults.delete(dbIndex);
        await clearDeviceAdditionalKeyProtection(dbIndex);

        const newVaultCount = await Storage.db.vaults.count();

        // If we just deleted the last vault, change the view to the Create tab
        if (newVaultCount === 0) {
            setActiveTab("create");
        }

        setOperationStatus({
            status: "success",
            message: "Vault successfully deleted",
        });
    };

    useEffect(() => {
        if (!isLoading) {
            if (encryptedVaults?.length) {
                setActiveTab("unlock");
            } else {
                setActiveTab("create");
            }
        }
    }, [encryptedVaults?.length, isLoading]);

    return (
        <Card className="rounded-none border-none shadow-none sm:rounded-md sm:border-solid sm:shadow-xl">
            <CardHeader>
                <div className="flex items-center text-2xl">
                    <CardTitle>
                        Cryptex <span className="text-primary">Vault</span>
                    </CardTitle>
                </div>
                <CardDescription>
                    Securely manage your encrypted vaults
                </CardDescription>
            </CardHeader>
            <CardContent>
                <Tabs
                    value={activeTab}
                    onValueChange={handleTabChange}
                    className="w-full max-w-sm sm:w-96"
                >
                    <TabsList className="flex w-full [&>button]:flex-auto">
                        {isLoading ? (
                            <TabsTrigger
                                value="loading"
                                className="col-span-4"
                                disabled
                            >
                                Loading
                            </TabsTrigger>
                        ) : (
                            <>
                                <TabsTrigger
                                    value="unlock"
                                    disabled={!encryptedVaults?.length}
                                >
                                    Unlock
                                </TabsTrigger>
                                <TabsTrigger value="create">Create</TabsTrigger>
                                <TabsTrigger value="restore">
                                    Restore
                                </TabsTrigger>
                                <TabsTrigger value="link">
                                    Use invitation
                                </TabsTrigger>
                            </>
                        )}
                    </TabsList>

                    {/* Loading Tab */}
                    <TabsContent value="loading">
                        <div className="flex flex-col items-center justify-center space-y-4 py-12">
                            <div className="relative h-16 w-16">
                                <LoaderCircle className="h-16 w-16 animate-spin text-primary" />
                                <Shield className="absolute left-1/2 top-1/2 h-8 w-8 -translate-x-1/2 -translate-y-1/2 transform text-background" />
                            </div>
                            <div className="space-y-2 text-center">
                                <h3 className="text-lg font-medium">
                                    Loading Vaults
                                </h3>
                                <p className="text-sm text-muted-foreground">
                                    Loading encrypted vaults from memory...
                                </p>
                            </div>
                        </div>
                    </TabsContent>

                    {/* Unlock Vault Tab */}
                    <TabsContent value="unlock">
                        <UnlockTab
                            vaults={encryptedVaults}
                            executeCallback={unlockCallback}
                            deleteVaultCallback={deleteVaultCallback}
                        />
                    </TabsContent>

                    {/* Create Vault Tab */}
                    <TabsContent value="create">
                        <CreateVaultTab
                            executeCallback={createVaultCallback}
                            suggestedName={
                                purchasePlan ? "Main vault" : undefined
                            }
                            onUseInvitation={() => handleTabChange("link")}
                        />
                    </TabsContent>

                    {/* Restore Vault Tab */}
                    <TabsContent value="restore">
                        <RestoreTab executeCallback={restoreVaultCallback} />
                    </TabsContent>

                    <TabsContent value="link">
                        <LinkVaultTab
                            executeCallback={createVaultCallback}
                            onUnsavedChange={setUnsavedLinkedVault}
                        />
                    </TabsContent>
                </Tabs>

                <AlertDialog
                    open={pendingLeave !== null}
                    onOpenChange={(open) => {
                        if (!open) setPendingLeave(null);
                    }}
                >
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>
                                Leave without saving this vault?
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                                The vault from your other device isn&apos;t
                                saved in this browser yet. If you leave now,
                                it&apos;s discarded, and linking this browser
                                needs a new invitation.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel>Stay</AlertDialogCancel>
                            <Button
                                variant="destructive"
                                onClick={leaveWithoutSaving}
                            >
                                Leave without saving
                            </Button>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>

                {/* Operation Status */}
                {operationStatus.status !== "idle" && (
                    <div className="mt-4">
                        <Alert
                            className={cn(
                                "flex items-center",
                                operationStatus.status === "success"
                                    ? "border-green-500 text-green-500"
                                    : "",
                                operationStatus.status === "error"
                                    ? "border-destructive text-destructive"
                                    : "",
                                operationStatus.status === "loading"
                                    ? "border-muted-foreground text-muted-foreground"
                                    : "",
                            )}
                        >
                            {operationStatus.status === "success" && (
                                <CheckCircle className="mr-2 h-4 w-4" />
                            )}
                            {operationStatus.status === "error" && (
                                <AlertCircle className="mr-2 h-4 w-4" />
                            )}
                            <AlertDescription>
                                {operationStatus.message}
                            </AlertDescription>
                        </Alert>
                    </div>
                )}
            </CardContent>

            <VaultRevealSecretsDialog
                open={pendingReveal != null}
                secrets={pendingReveal}
                onAcknowledge={() => {
                    if (pendingUnlock) {
                        finalizeVaultUnlockCallback(
                            pendingUnlock.metadata,
                            pendingUnlock.vault,
                            pendingUnlock.dek,
                        );
                        setPendingUnlock(null);
                    }
                    setPendingReveal(null);
                    setOperationStatus({
                        status: "success",
                        message: "Vault ready",
                    });
                }}
            />

            <CardFooter className="flex justify-start border-t pt-4">
                <ChangelogDialog />
            </CardFooter>
        </Card>
    );
};

export default VaultManager;
