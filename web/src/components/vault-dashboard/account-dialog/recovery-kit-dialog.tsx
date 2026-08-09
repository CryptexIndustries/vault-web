"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, Download, Printer, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

import {
    buildRecoveryKitCopyText,
    downloadRecoveryKitHtml,
    printRecoveryKit,
    splitRecoveryPhrase,
} from "./recovery-kit-utils";
import { copyToClipboard } from "./utils";

export type RecoveryKitData = {
    userId: string;
    recoveryPhrase: string;
};

type RecoveryKitDialogProps = {
    open: boolean;
    kit: RecoveryKitData | null;
    onComplete: () => void;
    title?: string;
    description?: string;
};

export function RecoveryKitDialog({
    open,
    kit,
    onComplete,
    title = "Save your Recovery Kit",
    description = "Without your User ID and recovery phrase you cannot recover your Online Services account. Store them offline — this is the only time the phrase is shown.",
}: RecoveryKitDialogProps) {
    const [acknowledged, setAcknowledged] = useState(false);
    const [savedActionTaken, setSavedActionTaken] = useState(false);

    const resetState = useCallback(() => {
        setAcknowledged(false);
        setSavedActionTaken(false);
    }, []);

    const handleComplete = () => {
        onComplete();
        resetState();
    };

    const markSaved = () => setSavedActionTaken(true);

    const handleDownload = () => {
        if (!kit) return;
        downloadRecoveryKitHtml(kit.userId, kit.recoveryPhrase);
        markSaved();
        toast.success("Recovery Kit downloaded.");
    };

    const handlePrint = () => {
        if (!kit) return;
        if (!printRecoveryKit(kit.userId, kit.recoveryPhrase)) {
            toast.error("Could not open print dialog.");
            return;
        }
        markSaved();
    };

    const handleCopyAll = async () => {
        if (!kit) return;
        await copyToClipboard(
            buildRecoveryKitCopyText(kit.userId, kit.recoveryPhrase),
            "Recovery Kit",
        );
        markSaved();
    };

    const words = kit ? splitRecoveryPhrase(kit.recoveryPhrase) : [];
    const canContinue = acknowledged && savedActionTaken;

    useEffect(() => {
        if (!open) {
            resetState();
        }
    }, [open, resetState]);

    const copyKitField = async (text: string, label: string) => {
        await copyToClipboard(text, label);
        markSaved();
    };

    return (
        <Dialog
            open={open}
            onOpenChange={(nextOpen) => {
                if (!nextOpen) return;
            }}
        >
            <DialogContent
                className="max-h-[min(92vh,100dvh)] overflow-y-auto sm:max-w-lg [&>button]:hidden"
                onInteractOutside={(event) => event.preventDefault()}
                onEscapeKeyDown={(event) => event.preventDefault()}
            >
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <ShieldAlert className="h-5 w-5 text-amber-600" />
                        {title}
                    </DialogTitle>
                    <DialogDescription>{description}</DialogDescription>
                </DialogHeader>

                {kit ? (
                    <div className="space-y-4">
                        <Alert className="border-amber-500/50 bg-amber-500/10 text-amber-950 dark:text-amber-100">
                            <AlertTitle className="text-amber-950 dark:text-amber-50">
                                Shown once
                            </AlertTitle>
                            <AlertDescription className="text-amber-950/90 dark:text-amber-50/90">
                                Recovery needs{" "}
                                <strong>
                                    both your User ID and this phrase
                                </strong>
                                . Anyone with both can take over your Online
                                Services account.
                            </AlertDescription>
                        </Alert>

                        <div className="space-y-2">
                            <Label className="text-xs text-muted-foreground">
                                User ID
                            </Label>
                            <div className="flex flex-wrap items-center gap-2">
                                <p className="min-w-0 flex-1 break-all rounded-md border bg-muted/40 px-3 py-2 font-mono text-xs">
                                    {kit.userId}
                                </p>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="shrink-0 gap-2"
                                    onClick={() =>
                                        void copyKitField(kit.userId, "User ID")
                                    }
                                >
                                    <Copy className="h-3.5 w-3.5" />
                                    Copy
                                </Button>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label className="text-xs text-muted-foreground">
                                Recovery phrase
                            </Label>
                            <ol
                                className={cn(
                                    "grid gap-2 rounded-md border bg-muted/20 p-3",
                                    words.length > 12
                                        ? "grid-cols-3 sm:grid-cols-4"
                                        : "grid-cols-2 sm:grid-cols-3",
                                )}
                            >
                                {words.map((word, index) => (
                                    <li
                                        key={`${index}-${word}`}
                                        className="rounded border bg-background px-2 py-1.5 font-mono text-xs"
                                    >
                                        <span className="mr-1 text-muted-foreground">
                                            {index + 1}.
                                        </span>
                                        {word}
                                    </li>
                                ))}
                            </ol>
                            <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="gap-2"
                                onClick={() =>
                                    void copyKitField(
                                        kit.recoveryPhrase,
                                        "Recovery phrase",
                                    )
                                }
                            >
                                <Copy className="h-3.5 w-3.5" />
                                Copy phrase
                            </Button>
                        </div>

                        <div className="flex flex-wrap gap-2">
                            <Button
                                type="button"
                                size="sm"
                                variant="secondary"
                                className="gap-2"
                                onClick={handleDownload}
                            >
                                <Download className="h-3.5 w-3.5" />
                                Download kit
                            </Button>
                            <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="gap-2"
                                onClick={handlePrint}
                            >
                                <Printer className="h-3.5 w-3.5" />
                                Print
                            </Button>
                            <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="gap-2"
                                onClick={() => void handleCopyAll()}
                            >
                                <Copy className="h-3.5 w-3.5" />
                                Copy all
                            </Button>
                        </div>

                        <div className="space-y-3 rounded-lg border p-3">
                            <div className="flex items-start gap-3">
                                <Checkbox
                                    id="recovery-kit-ack"
                                    checked={acknowledged}
                                    onCheckedChange={(checked) =>
                                        setAcknowledged(checked === true)
                                    }
                                />
                                <Label
                                    htmlFor="recovery-kit-ack"
                                    className="cursor-pointer text-sm font-normal leading-snug"
                                >
                                    I saved my User ID and recovery phrase in a
                                    secure offline location.
                                </Label>
                            </div>
                            {!savedActionTaken ? (
                                <p className="text-xs text-muted-foreground">
                                    Download, print, or copy the kit before
                                    continuing.
                                </p>
                            ) : !acknowledged ? (
                                <p className="text-xs text-muted-foreground">
                                    Confirm you saved the kit offline to
                                    continue.
                                </p>
                            ) : null}
                        </div>
                    </div>
                ) : null}

                <DialogFooter>
                    <Button
                        type="button"
                        disabled={!canContinue}
                        onClick={handleComplete}
                    >
                        Continue
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
