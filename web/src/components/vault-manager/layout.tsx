import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { useEffect, useMemo, useState } from "react";

import {
    EncryptionFormGroupSchemaType,
    NewVaultFormSchemaType,
    VaultRestoreFormSchema,
} from "@/app_lib/vault-utils/form-schemas";
import { Err, Ok } from "neverthrow";
import * as Storage from "../../app_lib/vault-utils/storage";
import CreateVaultTab from "./create";
import { VaultRevealSecretsDialog } from "./vault-reveal-secrets-dialog";
import type {
    VaultCreateSecondFactorOptions,
    VaultPendingUnlock,
    VaultRevealSecrets,
    VaultUnlockFlowResult,
} from "@/app_lib/vault-utils/vault-unlock-types";
import RestoreTab from "./restore";
import UnlockTab from "./unlock";
import { ChangelogDialog } from "../changelog";
import * as Vault from "../../app_lib/vault-utils/vault";

type OperationStatus = {
    status: "idle" | "loading" | "success" | "error";
    message?: string;
};

const VaultManager: React.FC<{
    tryDecryptVaultCallback: (
        metadata: Storage.VaultMetadata,
        formData: EncryptionFormGroupSchemaType,
        unlockExtras?: {
            useRecovery?: boolean;
            recoveryCode?: string;
            secondFactorPassphrase?: string;
        },
    ) => Promise<Err<never, string> | Ok<VaultUnlockFlowResult, never>>;
    tryCreateVaultCallback: (
        formData: NewVaultFormSchemaType & EncryptionFormGroupSchemaType,
        secondFactorOptions?: VaultCreateSecondFactorOptions,
    ) => Promise<
        | false
        | {
              ok: true;
              revealSecrets: VaultRevealSecrets;
              pendingUnlock: VaultPendingUnlock;
          }
    >;
    finalizeVaultUnlockCallback: (
        metadata: Storage.VaultMetadata,
        vault: Vault.Vault,
        dek: CryptoKey,
    ) => void;
    tryRestoreVaultCallback: (
        formData: VaultRestoreFormSchema,
    ) => Promise<boolean>;
}> = ({
    tryDecryptVaultCallback,
    tryCreateVaultCallback,
    finalizeVaultUnlockCallback,
    tryRestoreVaultCallback,
}) => {
    const [activeTab, setActiveTab] = useState("loading");
    const [operationStatus, setOperationStatus] = useState<OperationStatus>({
        status: "idle",
    });
    const [pendingReveal, setPendingReveal] =
        useState<VaultRevealSecrets | null>(null);
    const [pendingUnlock, setPendingUnlock] =
        useState<VaultPendingUnlock | null>(null);

    const resetForm = () => {
        setOperationStatus({ status: "idle" });
        // Don't reset algorithm selections and their parameters to preserve user preferences
    };

    const handleTabChange = (value: string) => {
        setActiveTab(value);
        resetForm();
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

        console.debug("[VaultManager] Encrypted Vaults found:", encVaults);
        return encVaults;
    }, [_encryptedVaults]);
    const isLoading = encryptedVaults == null;

    const unlockCallback = async (
        metadata: Storage.VaultMetadata,
        formData: EncryptionFormGroupSchemaType,
        unlockExtras?: {
            useRecovery?: boolean;
            recoveryCode?: string;
            secondFactorPassphrase?: string;
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
        secondFactorOptions?: VaultCreateSecondFactorOptions,
    ) => {
        const success = await tryCreateVaultCallback(
            formData,
            secondFactorOptions,
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
        const success = await tryRestoreVaultCallback(formData);

        if (success) {
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

        return success;
    };

    const deleteVaultCallback = async (dbIndex: number) => {
        await Storage.db.vaults.delete(dbIndex);

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
                <div className="flex items-center space-x-2">
                    <Shield className="h-6 w-6 text-primary" />
                    <CardTitle>Vault Manager</CardTitle>
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
                    <TabsList className="grid w-full grid-cols-3">
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
                                {/* <TabsTrigger value="link">Link</TabsTrigger> */}
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
                        <CreateVaultTab executeCallback={createVaultCallback} />
                    </TabsContent>

                    {/* Restore Vault Tab */}
                    <TabsContent value="restore">
                        <RestoreTab executeCallback={restoreVaultCallback} />
                    </TabsContent>

                    {/* Link Vault Tab */}
                    {/* <TabsContent value="link">
                        <LinkTab
                            onLinkingSuccess={() => {
                                setOperationStatus({
                                    status: "success",
                                    message: "Vault linked successfully",
                                });
                                setActiveTab("unlock");
                            }}
                        />
                    </TabsContent> */}
                </Tabs>

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
