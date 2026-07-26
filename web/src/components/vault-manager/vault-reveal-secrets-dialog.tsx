import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { VaultRevealSecrets } from "@cryptex-industries/vault-core/vault-utils/vault-unlock-types";
import { SecondFactorKind } from "@cryptex-industries/vault-core/proto";
import { useEffect, useState } from "react";

type Props = {
    open: boolean;
    secrets: VaultRevealSecrets | null;
    onAcknowledge: () => void;
};

export function VaultRevealSecretsDialog({
    open,
    secrets,
    onAcknowledge,
}: Props) {
    const isWebAuthn =
        secrets?.secondFactorKind === SecondFactorKind.WEBAUTHN_PRF;

    const [ackRecovery, setAckRecovery] = useState(false);
    const [ackSecondFactor, setAckSecondFactor] = useState(
        !secrets?.secondFactorPassphrase,
    );
    const [ackWebAuthn, setAckWebAuthn] = useState(false);

    useEffect(() => {
        if (!open) return;
        setAckRecovery(false);
        setAckSecondFactor(!secrets?.secondFactorPassphrase);
        setAckWebAuthn(false);
    }, [open, secrets]);

    const canClose =
        ackRecovery &&
        (!secrets?.secondFactorPassphrase || ackSecondFactor) &&
        (!isWebAuthn || ackWebAuthn);

    return (
        <Dialog open={open} onOpenChange={() => undefined}>
            <DialogContent
                className="max-w-md"
                onPointerDownOutside={(e) => e.preventDefault()}
            >
                <DialogHeader>
                    <DialogTitle>Save these secrets now</DialogTitle>
                    <DialogDescription>
                        They are shown once. If you lose them and clear this
                        browser&apos;s data, you need these secrets or the
                        recovery code to restore access.
                    </DialogDescription>
                </DialogHeader>

                <Alert>
                    <AlertDescription className="space-y-3 text-sm">
                        <div>
                            <p className="font-medium">Recovery code</p>
                            <code className="mt-1 block rounded bg-muted p-2 text-xs">
                                {secrets?.recoveryCode}
                            </code>
                            <label className="mt-2 flex items-center gap-2 text-xs">
                                <input
                                    type="checkbox"
                                    checked={ackRecovery}
                                    onChange={(e) =>
                                        setAckRecovery(e.target.checked)
                                    }
                                />
                                I have written down the recovery code
                            </label>
                        </div>
                        {secrets?.secondFactorPassphrase ? (
                            <div>
                                <p className="font-medium">
                                    Second-factor passphrase
                                </p>
                                <code className="mt-1 block rounded bg-muted p-2 text-xs">
                                    {secrets.secondFactorPassphrase}
                                </code>
                                <label className="mt-2 flex items-center gap-2 text-xs">
                                    <input
                                        type="checkbox"
                                        checked={ackSecondFactor}
                                        onChange={(e) =>
                                            setAckSecondFactor(e.target.checked)
                                        }
                                    />
                                    I have written down the second-factor
                                    passphrase
                                </label>
                            </div>
                        ) : null}
                        {isWebAuthn ? (
                            <div>
                                <p className="font-medium">
                                    Security key (WebAuthn) is bound to this
                                    browser
                                </p>
                                <p className="mt-1 text-xs text-muted-foreground">
                                    Your security key can unlock this vault only
                                    where WebAuthn PRF is supported and the same
                                    credential is available. Store the recovery
                                    code somewhere safe.
                                </p>
                                <label className="mt-2 flex items-center gap-2 text-xs">
                                    <input
                                        type="checkbox"
                                        checked={ackWebAuthn}
                                        onChange={(e) =>
                                            setAckWebAuthn(e.target.checked)
                                        }
                                    />
                                    I understand the recovery code is my backup
                                    if this security key is unavailable
                                </label>
                            </div>
                        ) : null}
                    </AlertDescription>
                </Alert>

                <DialogFooter>
                    <Button disabled={!canClose} onClick={onAcknowledge}>
                        Continue
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
