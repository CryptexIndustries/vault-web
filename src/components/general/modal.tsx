import { Dialog, Transition } from "@headlessui/react";
import { Dispatch, Fragment, SetStateAction } from "react";

export type ModalProps = {
    /**
     * The state of the modal.
     * @returns [boolean, Dispatch<SetStateAction<boolean>>]
     * @example const modalState = useState(false);
     */
    visibleState: [boolean, Dispatch<SetStateAction<boolean>>];

    /**
     * This only triggers if the modal is dismissed by clicking outside of the modal.
     * Only triggers if inhibitDismissOnClickOutside is false.
     * @returns void
     */
    onDismissed?: () => void;

    /**
     * If true, the modal will not be dismissed when clicking outside of the modal.
     */
    inhibitDismissOnClickOutside?: boolean;

    /**
     * The title of the modal.
     * @returns React.ReactNode
     */
    childrenTitle?: React.ReactNode;

    /**
     * The content of the modal.
     * @returns React.ReactNode
     */
    children?: React.ReactNode;
};

export const GenericModal: React.FC<ModalProps> = ({
    visibleState,
    onDismissed = () => {
        // No-op
    },
    inhibitDismissOnClickOutside = false,
    childrenTitle,
    children,
}) => {
    const [isVisible, setIsVisible] = visibleState;

    const hideModal = () => setIsVisible(false);

    /**
     * This function is triggered when the user clicks outside of the modal.
     */
    const _onDismiss = () => {
        hideModal();
        onDismissed();
    };

    const dummyFn = () => {
        // No-op
    };

    return (
        <Transition.Root show={isVisible} as={Fragment}>
            <Dialog
                as="div"
                className="relative"
                onClose={inhibitDismissOnClickOutside ? dummyFn : _onDismiss}
            >
                <Transition.Child
                    as={Fragment}
                    enter="ease-out duration-300"
                    enterFrom="opacity-0"
                    enterTo="opacity-100"
                    leave="ease-in duration-200"
                    leaveFrom="opacity-100"
                    leaveTo="opacity-0"
                >
                    <div className="fixed inset-0 bg-black bg-opacity-10 backdrop-blur-sm transition-opacity duration-150" />
                </Transition.Child>

                <Transition.Child
                    as={Fragment}
                    enter="ease-out duration-300"
                    enterFrom="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
                    enterTo="opacity-100 translate-y-0 sm:scale-100"
                    leave="ease-in duration-200"
                    leaveFrom="opacity-100 translate-y-0 sm:scale-100"
                    leaveTo="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
                >
                    <div className="fixed inset-0 overflow-y-auto">
                        <div className="mt-4 flex justify-center text-center sm:mt-0 sm:items-center md:min-h-full">
                            <Dialog.Panel className="relative w-full transform overflow-hidden rounded-lg text-left shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-lg">
                                {childrenTitle ? (
                                    <div className="flex justify-center bg-gray-50 px-4 py-3 sm:justify-start">
                                        {childrenTitle}
                                    </div>
                                ) : null}
                                {children}
                            </Dialog.Panel>
                        </div>
                    </div>
                </Transition.Child>
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
    <div
        className={"bg-white px-4 pb-4 pt-5 sm:p-6 sm:pb-4 " + className ?? ""}
    >
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
