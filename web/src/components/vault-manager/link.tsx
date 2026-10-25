import { useEffect, useState } from "react";
import { CheckCircle2, Link2 } from "lucide-react";
import type {
    EncryptionFormGroupSchemaType,
    NewVaultFormSchemaType,
} from "@cryptex-industries/vault-core/vault-utils/form-schemas";
import type { ImportResult } from "@cryptex-industries/vault-core/vault-utils/import-export";
import type { Vault } from "@cryptex-industries/vault-core/vault-utils/vault";
import type { VaultCreateAdditionalKeyProtectionOptions } from "@cryptex-industries/vault-core/vault-utils/vault-unlock-types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ReceiveLinkRequestDialog } from "@/components/vault-dashboard/link";
import CreateVaultTab from "./create";

type CreateCallback = (
    formData: NewVaultFormSchemaType & EncryptionFormGroupSchemaType,
    additionalKeyProtectionOptions?: VaultCreateAdditionalKeyProtectionOptions,
    initialImport?: ImportResult,
    linkedVault?: Vault,
) => ReturnType<React.ComponentProps<typeof CreateVaultTab>["executeCallback"]>;

/** Receives a vault from another device, then saves it under a new master password. */
const LinkVaultTab: React.FC<{
    executeCallback: CreateCallback;
    /** Reports whether a received vault is waiting to be saved. */
    onUnsavedChange: (unsaved: boolean) => void;
}> = ({ executeCallback, onUnsavedChange }) => {
    const [receiveOpen, setReceiveOpen] = useState(false);
    const [linkedVault, setLinkedVault] = useState<Vault | null>(null);
    const [saved, setSaved] = useState(false);

    useEffect(() => {
        onUnsavedChange(!!linkedVault && !saved);
        return () => onUnsavedChange(false);
    }, [linkedVault, saved, onUnsavedChange]);

    if (linkedVault) {
        return (
            <div className="pt-4">
                <Alert>
                    <CheckCircle2 className="h-4 w-4" />
                    <AlertTitle>Vault received</AlertTitle>
                    <AlertDescription>
                        Choose the master password for this browser&apos;s copy,
                        then save it.
                    </AlertDescription>
                </Alert>
                <CreateVaultTab
                    suggestedName="Linked vault"
                    submitLabel="Save vault"
                    executeCallback={async (
                        formData,
                        protection,
                        initialImport,
                    ) => {
                        const result = await executeCallback(
                            formData,
                            protection,
                            initialImport,
                            linkedVault,
                        );
                        if (result) setSaved(true);
                        return result;
                    }}
                />
            </div>
        );
    }

    return (
        <div className="space-y-4 pt-4 text-sm">
            <p className="text-muted-foreground">
                Link this browser to a vault you already use on another device.
                You don&apos;t need a new vault or a second account.
            </p>
            <ol className="list-decimal space-y-2 pl-5 text-muted-foreground">
                <li>
                    On the device that has your vault, create an invitation.
                </li>
                <li>
                    Choose Use invitation below, then scan the QR code or open
                    the invitation file.
                </li>
                <li>Enter the verification words shown on that device.</li>
                <li>Choose a master password for this browser.</li>
            </ol>
            <Button className="w-full" onClick={() => setReceiveOpen(true)}>
                <Link2 className="mr-2 h-4 w-4" />
                Use invitation
            </Button>
            <ReceiveLinkRequestDialog
                open={receiveOpen}
                onOpenChange={setReceiveOpen}
                onVaultReceived={(vault) => {
                    setReceiveOpen(false);
                    setLinkedVault(vault);
                }}
            />
        </div>
    );
};

export default LinkVaultTab;
