import { Dialog, Transition } from "@headlessui/react";
import { ArrowPathIcon } from "@heroicons/react/24/outline";
import { Field, Form, Formik } from "formik";
import { signIn } from "next-auth/react";
import dynamic from "next/dynamic";
import { Fragment, memo, Suspense, useEffect, useRef, useState } from "react";
import { toast } from "react-toastify";
import Spinner from "../general/spinner";
import { trpc } from "../../utils/trpc";
import { useRouter } from "next/router";

// https://next-auth.js.org/configuration/pages

export enum FormMode {
    SignIn = "Login",
    SignUp = "Register",
    Any = "",
}

export type LoginModalProps = {
    visible: boolean;
    hideModalFn: () => void;
    formMode: FormMode;
    userEmail?: string | null;
};

const LoginModal: React.FC<LoginModalProps> = ({
    visible,
    hideModalFn,
    formMode,
    userEmail,
}) => {
    const initialFormMode: FormMode =
        formMode === FormMode.Any ? FormMode.SignIn : formMode;
    const [currentFormMode, setCurrentFormMode] = useState(initialFormMode);
    const changeFormMode = (newFormMode: FormMode.SignIn | FormMode.SignUp) =>
        setCurrentFormMode(newFormMode);

    const signInButtonRef = useRef<HTMLButtonElement>(null);
    const signUpButtonRef = useRef<HTMLButtonElement>(null);

    return (
        <Transition.Root show={visible} as={Fragment}>
            <Dialog as="div" className="relative z-10" onClose={hideModalFn}>
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
                            <Dialog.Panel className="relative transform overflow-hidden rounded-lg text-left shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-lg">
                                <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                                    <div className="flex justify-center">
                                        {/* <div className="mx-auto flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-red-100 sm:mx-0 sm:h-10 sm:w-10">
                                            <ExclamationTriangleIcon
                                                className="h-6 w-6 text-red-600"
                                                aria-hidden="true"
                                            />
                                        </div> */}
                                        <div className="flex flex-col items-center mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left">
                                            {/* <Dialog.Title
                                                as="h2"
                                                className="text-2xl font-medium leading-6 text-gray-900 mb-9"
                                            >
                                                {currentFormMode}
                                            </Dialog.Title> */}
                                            {formMode === FormMode.Any ? (
                                                <div className="mt-2">
                                                    <TabBar
                                                        currentFormMode={
                                                            currentFormMode
                                                        }
                                                        changeFormMode={
                                                            changeFormMode
                                                        }
                                                    />
                                                </div>
                                            ) : null}
                                            <div className="flex flex-col">
                                                {currentFormMode ===
                                                FormMode.SignIn ? (
                                                    <SignInForm
                                                        submitButtonRef={
                                                            signInButtonRef
                                                        }
                                                    />
                                                ) : (
                                                    <SignUpForm
                                                        submitButtonRef={
                                                            signUpButtonRef
                                                        }
                                                        userEmail={userEmail}
                                                        hideModalFn={
                                                            hideModalFn
                                                        }
                                                    />
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <div className="bg-gray-50 px-4 py-3 sm:flex sm:flex-row-reverse sm:px-6">
                                    <button
                                        type="button"
                                        className="inline-flex w-full justify-center rounded-md border border-transparent bg-colorPrimary px-4 py-2 text-base font-medium text-white shadow-sm hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 sm:ml-3 sm:w-auto sm:text-sm"
                                        onClick={() => {
                                            if (
                                                currentFormMode ===
                                                    FormMode.SignIn &&
                                                !signInButtonRef.current
                                                    ?.disabled
                                            ) {
                                                signInButtonRef.current?.click();
                                            } else if (
                                                currentFormMode ===
                                                    FormMode.SignUp &&
                                                !signUpButtonRef.current
                                                    ?.disabled
                                            ) {
                                                signUpButtonRef.current?.click();
                                            }
                                        }}
                                    >
                                        {currentFormMode}
                                    </button>
                                    <button
                                        type="button"
                                        className="mt-3 inline-flex w-full justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-base font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
                                        onClick={hideModalFn}
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

type QRCodeProps = {
    value: string;
};

const QRCode: React.FC<QRCodeProps> = ({ value }) => {
    const DynamicQRCode = dynamic(() => import("react-qr-code"), {
        suspense: true,
    });

    return (
        <>
            <Suspense fallback={<Spinner />}>
                <DynamicQRCode value={value} />
            </Suspense>
        </>
    );
};

// #region SignUpForm
type SignUpFormProps = {
    submitButtonRef: React.RefObject<HTMLButtonElement>;
    userEmail?: string | null;
    hideModalFn: () => void;
};

interface SignUpFormValues {
    email: string;
    secret: string;
    token: string;
}

const SignUpForm: React.FC<SignUpFormProps> = ({
    submitButtonRef,
    userEmail,
    hideModalFn,
}) => {
    const [otpURI, setOtpURI] = useState("");
    const [secret, setSecret] = useState("");

    function _QrCode() {
        return <QRCode value={otpURI} />;
    }
    // TODO: This component rerenders four times on initial render and on token refresh
    const QrCode = memo(_QrCode);

    useEffect(() => {
        // Generate the TOTP secret on component mount
        const getOtp = async () => {
            // https://github.com/google/google-authenticator/wiki/Key-Uri-Format
            const { TOTP } = await import("otpauth");
            const totp = new TOTP({
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
    }, [secret]);

    const { mutate: registerUser, error } = trpc.useMutation(
        ["credentials.register-user"],
        {
            onSuccess: () => {
                if (userEmail == null) {
                    // TODO: Sign in user after registration
                    toast.success(
                        "User successfully registered. Redirecting...",
                        {
                            autoClose: 2000,
                        }
                    );
                } else {
                    toast.success("Account successfully linked!", {
                        autoClose: 2000,
                    });
                }
                hideModalFn();
            },
            onError(error) {
                toast.error(error.message);
            },
        }
    );

    return (
        <Formik
            initialValues={{
                email: userEmail ?? "",
                secret: secret,
                token: "",
            }}
            enableReinitialize={true}
            validate={(values: SignUpFormValues) => {
                const errors: { email?: string; token?: string } = {};
                if (!values.email) {
                    errors.email = "This is a required field.";
                } else if (
                    !/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(
                        values.email
                    )
                ) {
                    errors.email = "Invalid email address.";
                }

                if (!values.token) {
                    errors.token = "This is a required field.";
                }
                return errors;
            }}
            onSubmit={(values: SignUpFormValues, { setSubmitting }) => {
                registerUser(values);
                setSubmitting(false);
            }}
        >
            {({
                values,
                errors,
                touched,
                handleChange,
                handleBlur,
                handleSubmit,
                isSubmitting,
            }) => (
                <Form
                    className="flex flex-col space-y-4"
                    onSubmit={handleSubmit}
                >
                    <div className="flex flex-col">
                        <label
                            htmlFor="email"
                            className="mb-2 text-sm font-medium text-gray-600"
                        >
                            Email *
                        </label>
                        <Field
                            type="email"
                            name="email"
                            placeholder="Enter your email"
                            className={`border border-gray-300 rounded-md px-3 py-2 disabled:text-gray-300 ${
                                errors.email && touched.email
                                    ? "invalid:border-2 invalid:border-rose-500"
                                    : ""
                            } `}
                            required={true}
                            disabled={userEmail != null}
                            onChange={handleChange}
                            onBlur={handleBlur}
                            value={values.email}
                        />
                        <span
                            className={`${
                                errors.email && touched.email
                                    ? "block"
                                    : "hidden"
                            } text-sm text-rose-500`}
                        >
                            {errors.email && touched.email && errors.email}
                        </span>
                    </div>

                    <div className="flex flex-col">
                        <label className="mb-2 text-sm font-medium text-gray-600 flex">
                            TOTP Key
                            <ArrowPathIcon
                                onClick={() => {
                                    setSecret("");
                                    setOtpURI("");
                                }}
                                className="ml-1 w-5 h-5 text-gray-500 hover:text-gray-700"
                            />
                        </label>
                        <QrCode />
                        <Field
                            type="password"
                            name="secret"
                            hidden={true}
                            onChange={handleChange}
                            onBlur={handleBlur}
                            value={values.secret}
                        />
                    </div>

                    <div className="flex flex-col">
                        <label
                            htmlFor="token"
                            className="mb-2 text-sm font-medium text-gray-600"
                        >
                            Token (One Time Password) *
                        </label>
                        <Field
                            type="password"
                            name="token"
                            id="token"
                            placeholder="Generated Token"
                            className={`border border-gray-300 rounded-md px-3 py-2 ${
                                errors.token && touched.token
                                    ? "invalid:border-2 invalid:border-rose-500"
                                    : ""
                            } `}
                            required={true}
                            onChange={handleChange}
                            onBlur={handleBlur}
                            value={values.token}
                        />
                        <span
                            className={`${
                                errors.token && touched.token
                                    ? "block"
                                    : "hidden"
                            } text-sm text-rose-500`}
                        >
                            {errors.token && touched.token && errors.token}
                        </span>
                    </div>
                    {/* This is here because we want to be able to trigger the form submission on return key press */}
                    <button
                        type="submit"
                        disabled={isSubmitting}
                        hidden={true}
                        ref={submitButtonRef}
                    ></button>
                </Form>
            )}
        </Formik>
    );
};
// #endregion

// #region SignInForm
type SignInFormProps = {
    submitButtonRef: React.RefObject<HTMLButtonElement>;
};

interface SignInFormValues {
    email: string;
    token: string;
}

const SignInForm: React.FC<SignInFormProps> = ({ submitButtonRef }) => {
    const router = useRouter();
    return (
        <Formik
            initialValues={{ email: "", token: "" }}
            enableReinitialize={true}
            validate={(values: SignInFormValues) => {
                const errors: { email?: string; token?: string } = {};
                if (!values.email) {
                    errors.email = "This is a required field.";
                } else if (
                    !/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(
                        values.email
                    )
                ) {
                    errors.email = "Invalid email address.";
                }

                if (!values.token) {
                    errors.token = "This is a required field.";
                }
                return errors;
            }}
            onSubmit={async (values: SignInFormValues, { setSubmitting }) => {
                const result = await signIn("cryptex", {
                    redirect: false,
                    email: values.email,
                    token: values.token,
                });

                if (result?.ok) {
                    toast.success("Authentication successful. Redirecting...", {
                        autoClose: 2000,
                    });
                    setTimeout(() => {
                        // Reload the page so that the login page can take us to the protected page
                        router.push("/login");
                    }, 2000);
                } else {
                    toast.error("Authentication failed. Please try again.");
                    console.error(result);
                }
                setSubmitting(false);
            }}
        >
            {({
                values,
                errors,
                touched,
                handleChange,
                handleBlur,
                handleSubmit,
                isSubmitting,
            }) => (
                <Form
                    className="flex flex-col space-y-4"
                    onSubmit={handleSubmit}
                >
                    <div className="flex flex-col">
                        <label
                            htmlFor="email"
                            className="mb-2 text-sm font-medium text-gray-600"
                        >
                            Email *
                        </label>
                        <Field
                            type="email"
                            name="email"
                            placeholder="Enter your email"
                            className={`border border-gray-300 rounded-md px-3 py-2 ${
                                errors.email && touched.email
                                    ? "invalid:border-2 invalid:border-rose-500"
                                    : ""
                            } `}
                            required={true}
                            onChange={handleChange}
                            onBlur={handleBlur}
                            value={values.email}
                        />
                        <span
                            className={`${
                                errors.email && touched.email
                                    ? "block"
                                    : "hidden"
                            } text-sm text-rose-500`}
                        >
                            {errors.email && touched.email && errors.email}
                        </span>
                    </div>

                    <div className="flex flex-col">
                        <label
                            htmlFor="token"
                            className="mb-2 text-sm font-medium text-gray-600"
                        >
                            Token (One Time Password) *
                        </label>
                        <Field
                            type="password"
                            name="token"
                            id="token"
                            placeholder="Generated Token"
                            className={`border border-gray-300 rounded-md px-3 py-2 ${
                                errors.token && touched.token
                                    ? "invalid:border-2 invalid:border-rose-500"
                                    : ""
                            } `}
                            required={true}
                            onChange={handleChange}
                            onBlur={handleBlur}
                            value={values.token}
                        />
                        <span
                            className={`${
                                errors.token && touched.token
                                    ? "block"
                                    : "hidden"
                            } text-sm text-rose-500`}
                        >
                            {errors.token && touched.token && errors.token}
                        </span>
                    </div>
                    {/* This is here because we want to be able to trigger the form submission on return key press */}
                    <button
                        type="submit"
                        disabled={isSubmitting}
                        hidden={true}
                        ref={submitButtonRef}
                    ></button>
                </Form>
            )}
        </Formik>
    );
};
// #endregion

export default LoginModal;
