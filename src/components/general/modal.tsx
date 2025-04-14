import {
    Dialog,
    DialogPanel,
    Transition,
    TransitionChild,
} from "@headlessui/react";
import clsx from "clsx";
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

    /**
     * The width of the modal.
     * @default "lg"
     */
    width?:
        | "sm"
        | "md"
        | "lg"
        | "xl"
        | "2xl"
        | "3xl"
        | "4xl"
        | "5xl"
        | "6xl"
        | "7xl"
        | "full";
};

export const GenericModal: React.FC<ModalProps> = ({
    visibleState,
    onDismissed = () => {
        // No-op
    },
    inhibitDismissOnClickOutside = false,
    childrenTitle,
    children,
    width = "lg",
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

    const panelClass = clsx({
        "relative w-full transform overflow-hidden rounded-md text-left shadow-xl transition-all sm:my-8 sm:w-full":
            true,
        "sm:max-w-sm": width === "sm",
        "sm:max-w-md": width === "md",
        "sm:max-w-lg": width === "lg",
        "sm:max-w-xl": width === "xl",
        "sm:max-w-2xl": width === "2xl",
        "sm:max-w-3xl": width === "3xl",
        "sm:max-w-4xl": width === "4xl",
        "sm:max-w-5xl": width === "5xl",
        "sm:max-w-6xl": width === "6xl",
        "sm:max-w-7xl": width === "7xl",
        "sm:max-w-full": width === "full",
    });

    return (
        <Transition show={isVisible} as={Fragment}>
            <Dialog
                as="div"
                className="relative"
                onClose={inhibitDismissOnClickOutside ? dummyFn : _onDismiss}
            >
                <TransitionChild
                    // as={Fragment}
                    enter="ease-out duration-300"
                    enterFrom="opacity-0"
                    enterTo="opacity-100"
                    leave="ease-in duration-200"
                    leaveFrom="opacity-100"
                    leaveTo="opacity-0"
                >
                    <div className="fixed inset-0 bg-black bg-opacity-10 backdrop-blur-sm transition-opacity duration-150" />
                </TransitionChild>

                <TransitionChild
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
                            <DialogPanel className={panelClass}>
                                {childrenTitle ? (
                                    <div className="flex justify-center bg-gray-50 px-4 py-3 sm:justify-start">
                                        {childrenTitle}
                                    </div>
                                ) : null}
                                {children}
                            </DialogPanel>
                        </div>
                    </div>
                </TransitionChild>
            </Dialog>
        </Transition>
    );
};

export type GeneralProps = {
    children: React.ReactNode;
    className?: string;
};

export const Title: React.FC<GeneralProps> = ({ children, className = "" }) => (
    <p className={"line-clamp-2 text-2xl font-bold text-gray-900" + className}>
        {children}
    </p>
);

export const Body: React.FC<GeneralProps> = ({ children, className = "" }) => (
    <div className={"bg-white px-4 pb-4 pt-5 sm:p-6 sm:pb-4 " + className}>
        {children}
    </div>
);

export const Footer: React.FC<GeneralProps> = ({
    children,
    className = "",
}) => (
    <div
        className={
            "bg-gray-50 px-4 py-3 sm:flex sm:flex-row-reverse sm:px-6 " +
            className
        }
    >
        {children}
    </div>
);
