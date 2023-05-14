import React from "react";
import { Body, Footer, GenericModal } from "../general/modal";
import { ExclamationTriangleIcon } from "@heroicons/react/20/solid";
import { ButtonFlat, ButtonType } from "../general/buttons";

export type WarningDialogProps = {
    visibleState: [boolean, React.Dispatch<React.SetStateAction<boolean>>];
    descriptionRef: React.MutableRefObject<string | null>;
    confirmButtonTextRef?: React.RefObject<string | null>;
    onConfirmFnRef?: React.MutableRefObject<
        (() => Promise<void>) | (() => void) | null
    >;
    onDismissFnRef?: React.MutableRefObject<
        (() => Promise<void>) | (() => void) | null
    >;
};

export const WarningDialog: React.FC<WarningDialogProps> = ({
    visibleState,
    descriptionRef,
    confirmButtonTextRef,
    onConfirmFnRef,
    onDismissFnRef,
}) => {
    const [isLoadingState, setIsLoadingState] = React.useState(false);

    const hideModal = () => {
        visibleState[1](false);
        if (onDismissFnRef && onDismissFnRef.current) {
            onDismissFnRef.current();
        }
    };

    const onConfirm = async () => {
        setIsLoadingState(true);

        if (onConfirmFnRef && onConfirmFnRef.current) {
            await onConfirmFnRef.current();
        }
        hideModal();

        setIsLoadingState(false);
    };

    return (
        <GenericModal key="warning-modal" visibleState={visibleState}>
            <Body>
                <div className="flex flex-col items-center text-center">
                    <ExclamationTriangleIcon
                        className="h-10 w-10 text-red-500"
                        aria-hidden="true"
                    />
                    <p className="text-2xl font-bold text-gray-900">Warning</p>

                    <br />

                    <p className="mt-2 text-center text-base text-gray-600">
                        {descriptionRef.current}
                        {descriptionRef && descriptionRef.current && <br />}
                        Are you sure you want to continue?
                    </p>
                </div>
            </Body>

            <Footer className="space-y-3 sm:space-x-5 sm:space-y-0">
                {onConfirmFnRef && onConfirmFnRef.current && (
                    <ButtonFlat
                        text={confirmButtonTextRef?.current ?? "Confirm"}
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
