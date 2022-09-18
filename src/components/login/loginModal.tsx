import React, { Fragment, Suspense, useEffect, useState } from "react";
import { Dialog, Transition } from "@headlessui/react";
import dynamic from "next/dynamic";

// https://next-auth.js.org/configuration/pages

export enum FormMode {
    SignIn = "Sign In",
    SignUp = "Sign Up",
    Any = "",
}

export type LoginModalProps = {
    visible: boolean;
    hideModalFn: () => void;
    formMode: FormMode;
};

const LoginModal: React.FC<LoginModalProps> = ({
    visible,
    hideModalFn,
    formMode,
}) => {
    // const cancelButtonRef = useRef(null);
    const initialFormMode: FormMode =
        formMode === FormMode.Any ? FormMode.SignIn : formMode;
    const [currentFormMode, setCurrentFormMode] = useState(initialFormMode);

    const changeFormMode = (newFormMode: FormMode.SignIn | FormMode.SignUp) => {
        setCurrentFormMode(newFormMode);
    };

    return (
        <Transition.Root show={visible} as={Fragment}>
            <Dialog
                as="div"
                className="relative z-10"
                // initialFocus={cancelButtonRef}
                onClose={hideModalFn}
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
                    <div className="fixed inset-0 bg-black backdrop-blur-sm bg-opacity-75 transition-opacity duration-150" />
                </Transition.Child>

                <div className="fixed inset-0 z-10 overflow-y-auto">
                    <div className="flex min-h-full items-end justify-center p-4 text-center sm:items-center sm:p-0">
                        <Transition.Child
                            as={Fragment}
                            enter="ease-out duration-300"
                            enterFrom="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
                            enterTo="opacity-100 translate-y-0 sm:scale-100"
                            leave="ease-in duration-200"
                            leaveFrom="opacity-100 translate-y-0 sm:scale-100"
                            leaveTo="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
                        >
                            <Dialog.Panel className="relative transform overflow-hidden rounded-lg bg-white text-left shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-lg">
                                <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                                    <div className="flex justify-center">
                                        {/* <div className="mx-auto flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-red-100 sm:mx-0 sm:h-10 sm:w-10">
                                            <ExclamationTriangleIcon
                                                className="h-6 w-6 text-red-600"
                                                aria-hidden="true"
                                            />
                                        </div> */}
                                        <div className="flex flex-col items-center mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left">
                                            <Dialog.Title
                                                as="h2"
                                                className="text-2xl font-medium leading-6 text-gray-900 mb-9"
                                            >
                                                {currentFormMode}
                                            </Dialog.Title>
                                            {formMode === FormMode.Any ? (
                                                <TabBar
                                                    currentFormMode={
                                                        currentFormMode
                                                    }
                                                    changeFormMode={
                                                        changeFormMode
                                                    }
                                                />
                                            ) : null}
                                            <div className="flex flex-col">
                                                {currentFormMode ===
                                                FormMode.SignIn ? (
                                                    <SignInForm />
                                                ) : (
                                                    <SignUpForm />
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <div className="bg-gray-50 px-4 py-3 sm:flex sm:flex-row-reverse sm:px-6">
                                    <button
                                        type="button"
                                        className="inline-flex w-full justify-center rounded-md border border-transparent bg-colorPrimary px-4 py-2 text-base font-medium text-white shadow-sm hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 sm:ml-3 sm:w-auto sm:text-sm"
                                        onClick={hideModalFn}
                                    >
                                        {currentFormMode}
                                    </button>
                                    <button
                                        type="button"
                                        className="mt-3 inline-flex w-full justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-base font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
                                        onClick={hideModalFn}
                                        // ref={cancelButtonRef}
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </Dialog.Panel>
                        </Transition.Child>
                    </div>
                </div>
            </Dialog>
        </Transition.Root>
    );
};

type TabBarProps = {
    currentFormMode: FormMode;
    changeFormMode: (newFormMode: FormMode.SignIn | FormMode.SignUp) => void;
};

const TabBar: React.FC<TabBarProps> = ({ currentFormMode, changeFormMode }) => {
    return (
        <div className="flex flex-row justify-center mb-9">
            <button
                type="button"
                className={`${
                    currentFormMode === FormMode.SignIn
                        ? "bg-gray-100 text-gray-900"
                        : "text-gray-500 hover:text-gray-700"
                } w-auto py-3 px-4 border border-gray-300 rounded-l-md text-sm font-medium`}
                onClick={() => changeFormMode(FormMode.SignIn)}
            >
                {FormMode.SignIn}
            </button>
            <button
                type="button"
                className={`${
                    currentFormMode === FormMode.SignUp
                        ? "bg-gray-100 text-gray-900"
                        : "text-gray-500 hover:text-gray-700"
                } -ml-px w-auto py-3 px-4 border border-gray-300 rounded-r-md text-sm font-medium`}
                onClick={() => changeFormMode(FormMode.SignUp)}
            >
                {FormMode.SignUp}
            </button>
        </div>
    );
};

type SignUpFormProps = {};

const SignUpForm: React.FC<SignUpFormProps> = ({}) => {
    const [otpURI, setOtpURI] = useState("");
    const [secret, setSecret] = useState("");

    useEffect(() => {
        const getOtp = async () => {
            // https://github.com/google/google-authenticator/wiki/Key-Uri-Format
            const OTPAuth = await import("otpauth");
            const totp = new OTPAuth.TOTP({
                issuer: "CryptexVault",
                label: "Cryptex",
                algorithm: "SHA1",
                digits: 6,
                period: 30,
            });

            setOtpURI(totp.toString());
            setSecret(totp.secret.base32);
        };
        if (!secret) getOtp();
    }, []);

    const DynamicQRCode = dynamic(() => import("react-qr-code"), {
        suspense: true,
    });

    return (
        <form id="signup-form" className="flex flex-col">
            <div className="flex flex-col">
                <label
                    htmlFor="email"
                    className="mb-2 text-sm font-medium text-gray-600"
                >
                    Email
                </label>
                <input
                    type="email"
                    name="email"
                    id="email"
                    placeholder="Enter your email"
                    className="border border-gray-300 rounded-md px-3 py-2"
                />
            </div>
            <div className="flex flex-col mt-4">
                <label
                    htmlFor="email"
                    className="mb-2 text-sm font-medium text-gray-600"
                >
                    OTP Key
                </label>
                <Suspense
                    fallback={
                        <div className="flex justify-center">
                            <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-gray-200"></div>
                        </div>
                    }
                >
                    <DynamicQRCode value={otpURI} />
                </Suspense>
            </div>
            <div className="flex flex-col mt-4">
                <label
                    htmlFor="otp"
                    className="mb-2 text-sm font-medium text-gray-600"
                >
                    OTP (One Time Password)
                </label>
                <input
                    type="password"
                    name="otp"
                    id="otp"
                    placeholder="Generated OTP"
                    className="border border-gray-300 rounded-md px-3 py-2"
                />
            </div>
        </form>
    );
};

type SignInFormProps = {};

const SignInForm: React.FC<SignInFormProps> = ({}) => {
    return (
        <form id="signin-form" className="flex flex-col">
            <div className="flex flex-col">
                <label
                    htmlFor="email"
                    className="mb-2 text-sm font-medium text-gray-600"
                >
                    Email
                </label>
                <input
                    type="email"
                    name="email"
                    id="email"
                    placeholder="Enter your email"
                    className="border border-gray-300 rounded-md px-3 py-2"
                />
            </div>
            <div className="flex flex-col mt-4">
                <label
                    htmlFor="otp"
                    className="mb-2 text-sm font-medium text-gray-600"
                >
                    OTP (One Time Password)
                </label>
                <input
                    type="password"
                    name="otp"
                    id="otp"
                    placeholder="Generated OTP"
                    className="border border-gray-300 rounded-md px-3 py-2"
                />
            </div>
        </form>
    );
};

export default LoginModal;
