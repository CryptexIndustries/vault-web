import React from "react";
import { Body, Footer, GenericModal } from "../general/modal";
import { ExclamationTriangleIcon } from "@heroicons/react/20/solid";
import { ButtonFlat, ButtonType } from "../general/buttons";

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

    return (
        <GenericModal
            key="warning-modal"
            visibleState={[dialogVisible, setDialogVisible]}
        >
            <Body>
                <div className="flex flex-col items-center text-center">
                    <ExclamationTriangleIcon
                        className="h-10 w-10 text-orange-500"
                        aria-hidden="true"
                    />
                    <p className="text-2xl font-bold text-slate-900">Warning</p>

                    <br />

                    <p className="mt-2 text-center text-base text-slate-600">
                        {descriptionRef.current}
                        {descriptionRef && descriptionRef.current && <br />}
                    </p>
                    <p className="mt-2 text-center text-base text-slate-600">
                        {descriptionSecondPart ??
                            "Are you sure you want to continue?"}
                    </p>
                </div>
            </Body>

            <Footer className="space-y-3 sm:space-x-5 sm:space-y-0">
                {onConfirmFnRef && onConfirmFnRef.current && (
                    <ButtonFlat
                        text={
                            countdown !== null
                                ? `${confirmationButtonText ?? "Confirm"} (${countdown}s)`
                                : (confirmationButtonText ?? "Confirm")
                        }
                        className="sm:ml-2"
                        onClick={onConfirm}
                        disabled={isLoadingState}
                        loading={isLoadingState}
                    />
                )}
                <ButtonFlat
                    text={onDismissFnRef ? "Cancel" : "Close"}
                    type={ButtonType.Secondary}
                    onClick={() => hideModal()}
                    disabled={isLoadingState}
                />
            </Footer>
        </GenericModal>
    );
};
