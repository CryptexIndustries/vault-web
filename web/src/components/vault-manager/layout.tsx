import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { useEffect, useMemo, useState } from "react";

import {
    EncryptionFormGroupSchemaType,
    NewVaultFormSchemaType,
    VaultRestoreFormSchema,
} from "@/app_lib/vault-utils/form-schemas";
import { Err, Ok } from "neverthrow";
import * as Storage from "../../app_lib/vault-utils/storage";
import CreateVaultTab from "./create";
import LinkTab from "./link";
import RestoreTab from "./restore";
import UnlockTab from "./unlock";
import { ChangelogDialog } from "../changelog";

type OperationStatus = {
    status: "idle" | "loading" | "success" | "error";
    message?: string;
};

const VaultManager: React.FC<{
    tryDecryptVaultCallback: (
        metadata: Storage.VaultMetadata,
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
    tryCreateVaultCallback: (
        formData: NewVaultFormSchemaType & EncryptionFormGroupSchemaType,
    ) => Promise<boolean>;
    tryRestoreVaultCallback: (
        formData: VaultRestoreFormSchema,
    ) => Promise<boolean>;
}> = ({
    tryDecryptVaultCallback,
    tryCreateVaultCallback,
    tryRestoreVaultCallback,
}) => {
    const [activeTab, setActiveTab] = useState("loading");
    const [operationStatus, setOperationStatus] = useState<OperationStatus>({
        status: "idle",
    });

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
    ) => {
        const success = await tryDecryptVaultCallback(metadata, formData);
        if (success.isOk()) {
            setOperationStatus({
                status: "success",
                message: "Vault unlocked successfully",
            });
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
    ) => {
        const success = await tryCreateVaultCallback(formData);

        if (success) {
            setActiveTab("unlock");
            setOperationStatus({
                status: "success",
                message: "Vault created successfully",
            });
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
    }, [isLoading]);

    return (
        <Card className="rounded-none border-none shadow-none sm:rounded-md sm:border-solid sm:shadow-xl">
            <CardHeader>
                <div className="flex items-center space-x-2">
                    <Shield className="text-primary h-6 w-6" />
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
                    <TabsList className="grid w-full grid-cols-4">
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
                                <TabsTrigger value="link">Link</TabsTrigger>
                            </>
                        )}
                    </TabsList>

                    {/* Loading Tab */}
                    <TabsContent value="loading">
                        <div className="flex flex-col items-center justify-center space-y-4 py-12">
                            <div className="relative h-16 w-16">
                                <LoaderCircle className="text-primary h-16 w-16 animate-spin" />
                                <Shield className="text-background absolute left-1/2 top-1/2 h-8 w-8 -translate-x-1/2 -translate-y-1/2 transform" />
                            </div>
                            <div className="space-y-2 text-center">
                                <h3 className="text-lg font-medium">
                                    Loading Vaults
                                </h3>
                                <p className="text-muted-foreground text-sm">
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
                    <TabsContent value="link">
                        <LinkTab
                            onLinkingSuccess={() => {
                                setOperationStatus({
                                    status: "success",
                                    message: "Vault linked successfully",
                                });
                                setActiveTab("unlock");
                            }}
                        />
                    </TabsContent>
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
            <CardFooter className="flex justify-start border-t pt-4">
                <ChangelogDialog />
            </CardFooter>
        </Card>
    );
};

export default VaultManager;
