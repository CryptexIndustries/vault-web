import React from "react";
import { ExclamationTriangleIcon } from "@heroicons/react/20/solid";
import { Loader2 } from "lucide-react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "../ui/dialog";
import { Button } from "../ui/button";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Badge } from "../ui/badge";

export type WarningDialogShowFn = (
    description: string,
    onConfirm: (() => void) | null,
    onDismiss: (() => void) | null,
    confirmationButtonText?: string,
    descriptionSecondPart?: string,
    autoConfirmCountdown?: number,
) => void;

export const WarningDialog: React.FC<{
    showFnRef: React.RefObject<WarningDialogShowFn | null>;
}> = ({ showFnRef }) => {
    const [dialogVisible, setDialogVisible] = React.useState(false);
    const [isLoadingState, setIsLoadingState] = React.useState(false);
    const [countdown, setCountdown] = React.useState<number | null>(null);

    const [confirmationButtonText, setConfirmationButtonText] = React.useState<
        string | undefined
    >();
    const [descriptionSecondPart, setDescriptionSecondPart] = React.useState<
        string | undefined
    >();

    const countdownIntervalRef = React.useRef<NodeJS.Timeout | null>(null);

    const clearCountdownInterval = () => {
        if (countdownIntervalRef.current) {
            clearInterval(countdownIntervalRef.current);
            countdownIntervalRef.current = null;
        }
    };

    showFnRef.current = (
        description: string,
        onConfirm: (() => void) | null,
        onDismiss: (() => void) | null,
        confirmationButtonText?: string,
        descriptionSecondPart?: string,
        autoConfirmCountdown?: number,
    ) => {
        descriptionRef.current = description;
        onConfirmFnRef.current = onConfirm;

        onDismissFnRef.current = onDismiss;

        setConfirmationButtonText(confirmationButtonText);
        setDescriptionSecondPart(descriptionSecondPart);
        initialCountdownRef.current = autoConfirmCountdown ?? null;
        setCountdown(autoConfirmCountdown ?? null);

        setDialogVisible(true);
    };

    const descriptionRef = React.useRef<string | null>(null);
    const onDismissFnRef = React.useRef<
        (() => Promise<void>) | (() => void) | null
    >(null);
    const onConfirmFnRef = React.useRef<
        (() => Promise<void>) | (() => void) | null
    >(null);

    const initialCountdownRef = React.useRef<number | null>(null);

    // Handle countdown timer - only set up once when dialog opens
    React.useEffect(() => {
        if (!dialogVisible) {
            clearCountdownInterval();
            return;
        }

        if (initialCountdownRef.current === null) {
            return;
        }

        countdownIntervalRef.current = setInterval(() => {
            setCountdown((prev) => {
                if (prev === null || prev <= 1) {
                    clearCountdownInterval();
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);

        return () => clearCountdownInterval();
    }, [dialogVisible]);

    // Handle auto-confirm when countdown reaches zero
    React.useEffect(() => {
        if (countdown === 0 && dialogVisible) {
            onConfirm();
        }
    }, [countdown]);

    const hideModal = () => {
        clearCountdownInterval();
        initialCountdownRef.current = null;
        setCountdown(null);
        setDialogVisible(false);
        if (onDismissFnRef && onDismissFnRef.current) {
            onDismissFnRef.current();
        }
    };

    const onConfirm = async () => {
        clearCountdownInterval();
        initialCountdownRef.current = null;
        setCountdown(null);
        setIsLoadingState(true);

        await new Promise((resolve) => setTimeout(resolve, 100));

        if (onConfirmFnRef && onConfirmFnRef.current) {
            await onConfirmFnRef.current();
        }
        hideModal();

        setIsLoadingState(false);
    };

    const confirmLabel =
        countdown !== null
            ? `${confirmationButtonText ?? "Confirm"} (${countdown}s)`
            : (confirmationButtonText ?? "Confirm");

    return (
        <Dialog
            open={dialogVisible}
            onOpenChange={(open) => !open && hideModal()}
        >
            <DialogContent className="w-[92vw] max-w-md">
                <DialogHeader className="space-y-2 text-left">
                    <div className="flex items-center gap-2">
                        <ExclamationTriangleIcon
                            className="h-5 w-5 text-amber-500"
                            aria-hidden="true"
                        />
                        <DialogTitle>Warning</DialogTitle>
                    </div>
                    <DialogDescription>
                        Please confirm before continuing.
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                    <Alert className="min-w-0 border-amber-500/40 bg-amber-50 text-amber-900">
                        <ExclamationTriangleIcon className="h-4 w-4" />
                        <AlertTitle>Action required</AlertTitle>
                        <AlertDescription className="min-w-0 [overflow-wrap:anywhere]">
                            <p>{descriptionRef.current}</p>
                            {/* <p>
                                {descriptionSecondPart ??
                                    "Are you sure you want to continue?"}
                            </p> */}
                        </AlertDescription>
                    </Alert>
                    {countdown !== null && (
                        <Badge variant="secondary">
                            Auto-confirm in {countdown}s
                        </Badge>
                    )}
                </div>
                <DialogFooter className="gap-2 sm:gap-3">
                    <Button
                        variant="secondary"
                        onClick={hideModal}
                        disabled={isLoadingState}
                    >
                        {onDismissFnRef ? "Cancel" : "Close"}
                    </Button>
                    {onConfirmFnRef && onConfirmFnRef.current && (
                        <Button
                            onClick={onConfirm}
                            disabled={isLoadingState}
                            className="sm:min-w-[140px]"
                        >
                            {isLoadingState ? (
                                <>
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    Working...
                                </>
                            ) : (
                                confirmLabel
                            )}
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
