import { Dialog, Transition } from "@headlessui/react";
import { Dispatch, Fragment, SetStateAction } from "react";

export type ModalProps = {
    visibleState: [boolean, Dispatch<SetStateAction<boolean>>];
    titleText?: string;
    onHide?: () => void;
    childrenTitle?: React.ReactNode;
    children?: React.ReactNode;
};

export const GenericModal: React.FC<ModalProps> = ({
    visibleState,
    onHide = () => {
        // Default function
    },
    childrenTitle,
    children,
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
                    <div className="flex md:min-h-full sm:items-center justify-center p-4 text-center sm:p-0">
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
                                {children}
                            </Dialog.Panel>
                        </Transition.Child>
                    </div>
                </div>
            </Dialog>
        </Transition.Root>
    );
};

export type GeneralProps = {
    children: React.ReactNode;
    className?: string;
};

export const Title: React.FC<GeneralProps> = ({ children, className }) => (
    <Dialog.Title
        as="h2"
        className={"text-2xl font-medium leading-6 text-gray-900 " + className}
    >
        {children}
    </Dialog.Title>
);

export const Body: React.FC<GeneralProps> = ({ children, className }) => (
    <div className={"bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4 " + className}>
        {children}
    </div>
);

export const Footer: React.FC<GeneralProps> = ({ children, className }) => (
    <div
        className={
            "bg-gray-50 px-4 py-3 sm:flex sm:flex-row-reverse sm:px-6 " +
            className
        }
    >
        {children}
    </div>
);
