import { useEffect, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { useAtomValue } from "jotai/react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { unlockedVaultMetadataAtom } from "@/utils/atoms";
import {
    isVaultMigrationNoticeAcknowledged,
    needsVaultMigrationNotice,
    rememberVaultMigrationNoticeAcknowledged,
} from "@/utils/vault-migration-notice-storage";

// TODO: Remove VaultMigrationNoticeDialog after December 31, 2026.
export function VaultMigrationNoticeDialog() {
    const vaultMetadata = useAtomValue(unlockedVaultMetadataAtom);
    const dbIndex = vaultMetadata?.DBIndex;
    const createdAt = vaultMetadata?.CreatedAt;

    const [open, setOpen] = useState(false);
    const [acknowledged, setAcknowledged] = useState(false);

    useEffect(() => {
        if (dbIndex == null || !needsVaultMigrationNotice(createdAt)) {
            setOpen(false);
            return;
        }

        setAcknowledged(false);
        setOpen(!isVaultMigrationNoticeAcknowledged(dbIndex));
    }, [dbIndex, createdAt]);

    const handleContinue = () => {
        if (dbIndex != null) {
            rememberVaultMigrationNoticeAcknowledged(dbIndex);
        }
        setOpen(false);
    };

    return (
        <Dialog open={open} onOpenChange={() => undefined}>
            <DialogContent
                className="max-w-md"
                onPointerDownOutside={(event) => event.preventDefault()}
            >
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <ShieldAlert className="h-5 w-5 text-amber-500" />
                        Action required
                    </DialogTitle>
                    <DialogDescription>
                        If this vault is older than <u>22nd of June 2026</u>,
                        please complete these steps to keep sync and backups
                        working reliably.
                    </DialogDescription>
                </DialogHeader>

                <Alert className="border-amber-500/40 bg-amber-50 text-amber-900">
                    <AlertDescription className="space-y-3 text-sm">
                        <ol className="list-decimal space-y-2 pl-4">
                            <li>
                                Re-link all devices. Post-quantum cryptography
                                upgrades require fresh device links so sync and
                                linking use the new key exchange.
                            </li>
                            <li>
                                Create a new encrypted backup file. Older
                                backups may no longer restore in roughly six
                                months when legacy format support ends.
                            </li>
                        </ol>
                    </AlertDescription>
                </Alert>

                <label className="flex items-start gap-2 text-xs">
                    <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={acknowledged}
                        onChange={(event) =>
                            setAcknowledged(event.target.checked)
                        }
                    />
                    I understand these steps
                </label>

                <DialogFooter>
                    <Button disabled={!acknowledged} onClick={handleContinue}>
                        Continue
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
