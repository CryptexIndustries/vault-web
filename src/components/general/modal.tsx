import { Dialog, Transition } from "@headlessui/react";
import { Dispatch, Fragment, SetStateAction } from "react";

export type ModalProps = {
    visibleState: [boolean, Dispatch<SetStateAction<boolean>>];
    titleText?: string;
    confirmButtonText?: string;
    cancelButtonText?: string;
    onHide?: () => void;
    onConfirm?: () => void;
    onCancel?: () => void;
    childrenTitle?: React.ReactNode;
    children?: React.ReactNode;
    childrenFooter?: React.ReactNode;
};

export const GenericModal: React.FC<ModalProps> = ({
    visibleState,
    confirmButtonText = "Submit",
    cancelButtonText = "Cancel",
    onHide = () => {
        // Default function
    },
    onConfirm = () => {
        // Default function
    },
    onCancel = () => {
        // Default function
    },
    childrenTitle,
    children,
    childrenFooter,
}) => {
    const [isVisible, setIsVisible] = visibleState;

    const hideModal = () => setIsVisible(false);

    /**
     * This function is triggered on modal hide.
     */
    const _onHide = () => {
        hideModal();
        onHide();
    };

    /**
     * This function is triggered on cancel button click
     */
    const _onCancel = () => {
        hideModal();
        onCancel();
    };

    return (
        <Transition.Root show={isVisible} as={Fragment}>
            <Dialog as="div" className="relative z-10" onClose={_onHide}>
                <Transition.Child
                    as={Fragment}
                    enter="ease-out duration-300"
                    enterFrom="opacity-0"
                    enterTo="opacity-100"
                    leave="ease-in duration-200"
                    leaveFrom="opacity-100"
                    leaveTo="opacity-0"
                >
                    <div className="fixed inset-0 bg-black backdrop-blur-sm bg-opacity-10 transition-opacity duration-150" />
                </Transition.Child>

                <div className="fixed inset-0 z-10 overflow-y-auto">
                    <div className="flex min-h-full sm:items-center justify-center p-4 text-center sm:p-0">
                        <Transition.Child
                            as={Fragment}
                            enter="ease-out duration-300"
                            enterFrom="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
                            enterTo="opacity-100 translate-y-0 sm:scale-100"
                            leave="ease-in duration-200"
                            leaveFrom="opacity-100 translate-y-0 sm:scale-100"
                            leaveTo="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
                        >
                            <Dialog.Panel className="relative transform overflow-hidden rounded-lg text-left shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-lg">
                                {childrenTitle ? (
                                    <div className="bg-gray-50 flex px-4 py-3 justify-center sm:justify-start py-6">
                                        {childrenTitle}
                                    </div>
                                ) : null}
                                <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                                    {/* <div className="mx-auto flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-red-100 sm:mx-0 sm:h-10 sm:w-10">
                                            <ExclamationTriangleIcon
                                                className="h-6 w-6 text-red-600"
                                                aria-hidden="true"
                                            />
                                        </div> */}
                                    {children}
                                </div>
                                <div className="bg-gray-50 px-4 py-3 sm:flex sm:flex-row-reverse sm:px-6">
                                    <button
                                        type="button"
                                        className="inline-flex w-full justify-center rounded-md border border-transparent bg-colorPrimary px-4 py-2 text-base font-medium text-white shadow-sm hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 sm:ml-3 sm:w-auto sm:text-sm"
                                        onClick={onConfirm}
                                    >
                                        {confirmButtonText}
                                    </button>
                                    <button
                                        type="button"
                                        className="mt-3 inline-flex w-full justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-base font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
                                        onClick={_onCancel}
                                    >
                                        {cancelButtonText}
                                    </button>
                                    {childrenFooter}
                                </div>
                            </Dialog.Panel>
                        </Transition.Child>
                    </div>
                </div>
            </Dialog>
        </Transition.Root>
    );
};

export type TitleProps = {
    children: React.ReactNode;
};

export const Title: React.FC<TitleProps> = ({ children }) => (
    <Dialog.Title
        as="h2"
        className="text-2xl font-medium leading-6 text-gray-900"
    >
        {children}
    </Dialog.Title>
);
