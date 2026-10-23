import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Download, Loader2 } from "lucide-react";
import type { SSHKeyData } from "@cryptex-industries/vault-core/proto";
import { sshKeyFileName } from "@cryptex-industries/vault-core/vault-utils/ssh-key-info";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { downloadTextFile, runSSHKeyTaskInWorker } from "@/utils/ssh-key";

/** Saves the private key as an OpenSSH file, optionally passphrase-protected. */
export function SSHKeyDownloadDialog({
    open,
    onOpenChange,
    name,
    sshKey,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    name: string;
    sshKey: SSHKeyData;
}) {
    const [passphrase, setPassphrase] = useState("");
    const [confirmation, setConfirmation] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const fileName = sshKeyFileName(name);
    const mismatch = confirmation !== "" && passphrase !== confirmation;
    const abortRef = useRef<AbortController | null>(null);

    // Closing the dialog cancels an export that is still running.
    useEffect(() => {
        if (open) return;
        abortRef.current?.abort();
        abortRef.current = null;
        setPassphrase("");
        setConfirmation("");
        setBusy(false);
        setError("");
    }, [open]);

    useEffect(() => () => abortRef.current?.abort(), []);

    const save = async () => {
        if (busy) return;
        if (passphrase !== confirmation) {
            setError("The passphrases don't match.");
            return;
        }
        const controller = new AbortController();
        abortRef.current = controller;
        setBusy(true);
        setError("");
        // Encrypting runs bcrypt, so it runs in a worker.
        const result = await runSSHKeyTaskInWorker(
            {
                kind: "export",
                data: sshKey,
                passphrase: passphrase || undefined,
            },
            { signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        abortRef.current = null;
        if (result.ok && result.kind === "export") {
            downloadTextFile(fileName, result.text);
            onOpenChange(false);
            return;
        }
        setError(result.ok ? "The key could not be exported." : result.message);
        setBusy(false);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Save private key</DialogTitle>
                    <DialogDescription>
                        Add a passphrase to encrypt the file. If you leave it
                        blank, the file is not encrypted.
                    </DialogDescription>
                </DialogHeader>
                <form
                    className="space-y-4"
                    onSubmit={(event) => {
                        event.preventDefault();
                        void save();
                    }}
                >
                    <div className="space-y-2">
                        <Label htmlFor="ssh-download-passphrase">
                            Passphrase
                        </Label>
                        <PasswordInput
                            id="ssh-download-passphrase"
                            secretLabel="passphrase"
                            autoComplete="new-password"
                            value={passphrase}
                            disabled={busy}
                            onChange={(event) => {
                                setPassphrase(event.target.value);
                                setError("");
                            }}
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="ssh-download-passphrase-confirm">
                            Confirm passphrase
                        </Label>
                        <PasswordInput
                            id="ssh-download-passphrase-confirm"
                            secretLabel="passphrase confirmation"
                            autoComplete="new-password"
                            value={confirmation}
                            disabled={busy || !passphrase}
                            onChange={(event) => {
                                setConfirmation(event.target.value);
                                setError("");
                            }}
                        />
                        {(error || mismatch) && (
                            <p
                                className="text-xs text-destructive"
                                role="alert"
                            >
                                {error || "The passphrases don't match."}
                            </p>
                        )}
                    </div>
                    {!passphrase && (
                        <div className="flex gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
                            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                            <p className="text-foreground">
                                Without a passphrase, anyone who gets the file
                                can use the key.
                            </p>
                        </div>
                    )}
                    <p className="text-xs text-muted-foreground">
                        The file is saved as{" "}
                        <span className="font-mono text-foreground">
                            {fileName}
                        </span>
                        . Before using it with ssh, run{" "}
                        <span className="font-mono text-foreground">
                            chmod 600 {fileName}
                        </span>
                        .
                    </p>
                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => onOpenChange(false)}
                        >
                            Cancel
                        </Button>
                        <Button
                            type="submit"
                            disabled={busy || passphrase !== confirmation}
                            className="gap-2"
                        >
                            {busy ? (
                                <>
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    {passphrase ? "Encrypting..." : "Saving..."}
                                </>
                            ) : (
                                <>
                                    <Download className="h-4 w-4" />
                                    Save
                                </>
                            )}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
