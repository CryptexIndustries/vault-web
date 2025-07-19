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
) => void;

export const WarningDialog: React.FC<{
    showFnRef: React.MutableRefObject<WarningDialogShowFn | null>;
}> = ({ showFnRef }) => {
    const [dialogVisible, setDialogVisible] = React.useState(false);
    const [isLoadingState, setIsLoadingState] = React.useState(false);

    const [confirmationButtonText, setConfirmationButtonText] = React.useState<
        string | undefined
    >();
    const [descriptionSecondPart, setDescriptionSecondPart] = React.useState<
        string | undefined
    >();

    showFnRef.current = (
        description: string,
        onConfirm: (() => void) | null,
        onDismiss: (() => void) | null,
        confirmationButtonText?: string,
        descriptionSecondPart?: string,
    ) => {
        descriptionRef.current = description;
        onConfirmFnRef.current = onConfirm;

        onDismissFnRef.current = onDismiss;

        setConfirmationButtonText(confirmationButtonText);
        setDescriptionSecondPart(descriptionSecondPart);

        setDialogVisible(true);
    };

    const descriptionRef = React.useRef<string | null>(null);
    const onDismissFnRef = React.useRef<
        (() => Promise<void>) | (() => void) | null
    >(null);
    const onConfirmFnRef = React.useRef<
        (() => Promise<void>) | (() => void) | null
    >(null);

    const hideModal = () => {
        setDialogVisible(false);
        if (onDismissFnRef && onDismissFnRef.current) {
            onDismissFnRef.current();
        }
    };

    const onConfirm = async () => {
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
                        text={confirmationButtonText ?? "Confirm"}
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
