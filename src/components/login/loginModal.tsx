// import { ArrowPathIcon } from "@heroicons/react/24/outline";
// import { Field, Form, Formik } from "formik";
// import { signIn } from "next-auth/react";
// import dynamic from "next/dynamic";
// import {
//     Dispatch,
//     memo,
//     SetStateAction,
//     Suspense,
//     useEffect,
//     useRef,
//     useState,
// } from "react";
// import { toast } from "react-toastify";
// import Spinner from "../general/spinner";
// import { trpc } from "../../utils/trpc";
// import { NextRouter, useRouter } from "next/router";
// import { Body, Footer, GenericModal } from "../general/modal";
// import { ButtonFlat, ButtonType } from "../general/buttons";

// export enum FormMode {
//     SignIn = "Login",
//     SignUp = "Register",
//     Any = "",
// }

// export type LoginModalProps = {
//     visibleState: [boolean, Dispatch<SetStateAction<boolean>>];
//     formMode: FormMode;
//     userInitialMode?: FormMode;
//     accountLinkMode?: boolean;
//     emailPrefill?: string | null;
// };

// const LoginModal: React.FC<LoginModalProps> = ({
//     visibleState,
//     formMode,
//     userInitialMode,
//     accountLinkMode,
//     emailPrefill,
// }) => {
//     const initialFormMode: FormMode =
//         formMode === FormMode.Any ? FormMode.SignIn : formMode;
//     const [currentFormMode, setCurrentFormMode] = useState(
//         userInitialMode ?? initialFormMode
//     );
//     const changeFormMode = (newFormMode: FormMode.SignIn | FormMode.SignUp) =>
//         setCurrentFormMode(newFormMode);

//     const signInButtonRef = useRef<HTMLButtonElement>(null);
//     const signUpButtonRef = useRef<HTMLButtonElement>(null);

//     const hideModal = () => visibleState[1](false);

//     const isSubmitting = useState(false);
//     const [inProgress] = isSubmitting;

//     const onConfirm = () => {
//         if (
//             currentFormMode === FormMode.SignIn &&
//             !signInButtonRef.current?.disabled
//         ) {
//             signInButtonRef.current?.click();
//         } else if (
//             currentFormMode === FormMode.SignUp &&
//             !signUpButtonRef.current?.disabled
//         ) {
//             signUpButtonRef.current?.click();
//         }
//     };

//     return (
//         <GenericModal visibleState={visibleState}>
//             <Body>
//                 {formMode === FormMode.Any ? (
//                     <div className="mt-2">
//                         <TabBar
//                             currentFormMode={currentFormMode}
//                             changeFormMode={changeFormMode}
//                         />
//                     </div>
//                 ) : null}
//                 <div className="mt-3 flex flex-col items-center text-center sm:ml-4 sm:mt-0 sm:text-left">
//                     <div className="flex flex-col">
//                         {currentFormMode === FormMode.SignIn ? (
//                             <SignInForm
//                                 submittingState={isSubmitting}
//                                 submitButtonRef={signInButtonRef}
//                                 emailPrefill={emailPrefill}
//                             />
//                         ) : (
//                             <SignUpForm
//                                 submittingState={isSubmitting}
//                                 submitButtonRef={signUpButtonRef}
//                                 hideModalFn={hideModal}
//                                 emailPrefill={emailPrefill}
//                                 linkingMode={accountLinkMode}
//                             />
//                         )}
//                     </div>
//                 </div>
//             </Body>
//             <Footer className="space-y-3 sm:space-x-5 sm:space-y-0">
//                 <ButtonFlat
//                     text={currentFormMode}
//                     className="sm:ml-2"
//                     onClick={onConfirm}
//                     disabled={inProgress}
//                     loading={inProgress}
//                 />
//                 <ButtonFlat
//                     text="Close"
//                     type={ButtonType.Secondary}
//                     onClick={hideModal}
//                 />
//             </Footer>
//         </GenericModal>
//     );
// };

// type TabBarProps = {
//     currentFormMode: FormMode;
//     changeFormMode: (newFormMode: FormMode.SignIn | FormMode.SignUp) => void;
// };

// const TabBar: React.FC<TabBarProps> = ({ currentFormMode, changeFormMode }) => {
//     return (
//         <div className="mb-9 flex flex-row justify-center">
//             <button
//                 type="button"
//                 className={`${
//                     currentFormMode === FormMode.SignIn
//                         ? "bg-gray-100 text-gray-900"
//                         : "text-gray-500 hover:text-gray-700"
//                 } w-auto rounded-l-md border border-gray-300 px-4 py-3 text-sm font-medium`}
//                 onClick={() => changeFormMode(FormMode.SignIn)}
//                 autoFocus={currentFormMode === FormMode.SignIn}
//             >
//                 {FormMode.SignIn}
//             </button>
//             <button
//                 type="button"
//                 className={`${
//                     currentFormMode === FormMode.SignUp
//                         ? "bg-gray-100 text-gray-900"
//                         : "text-gray-500 hover:text-gray-700"
//                 } w-auto rounded-r-md border border-gray-300 px-4 py-3 text-sm font-medium`}
//                 onClick={() => changeFormMode(FormMode.SignUp)}
//                 autoFocus={currentFormMode === FormMode.SignUp}
//             >
//                 {FormMode.SignUp}
//             </button>
//         </div>
//     );
// };

// type QRCodeProps = {
//     value: string;
//     clickCallback?: () => void;
// };

// const QRCode: React.FC<QRCodeProps> = ({ value, clickCallback }) => {
//     const DynamicQRCode = dynamic(() => import("react-qr-code"), {
//         suspense: true,
//     });

//     return (
//         <>
//             <Suspense fallback={<Spinner />}>
//                 <DynamicQRCode value={value} onClick={clickCallback} />
//             </Suspense>
//         </>
//     );
// };

// // #region Sign Up
// type SignUpFormProps = {
//     submittingState: [boolean, React.Dispatch<React.SetStateAction<boolean>>];
//     submitButtonRef: React.RefObject<HTMLButtonElement>;
//     hideModalFn: () => void;
//     emailPrefill?: string | null;
//     linkingMode?: boolean;
// };

// interface SignUpFormValues {
//     email: string;
//     secret: string;
//     token: string;
// }

// const SignUpForm: React.FC<SignUpFormProps> = ({
//     submittingState,
//     submitButtonRef,
//     hideModalFn,
//     linkingMode,
//     emailPrefill,
// }) => {
//     const router = useRouter();

//     const [otpURI, setOtpURI] = useState("");
//     const [secret, setSecret] = useState("");

//     const setIsSubmitting = (isSubmitting: boolean) => {
//         submittingState[1](isSubmitting);
//     };

//     function _QrCode() {
//         return (
//             <QRCode
//                 value={otpURI}
//                 clickCallback={async () => {
//                     // Copy TOTP secret to clipboard
//                     try {
//                         await navigator.clipboard.writeText(secret);
//                         toast.info("Copied to clipboard!", {
//                             autoClose: 2000,
//                         });
//                     } catch {
//                         toast.warn(
//                             "Failed to copy to clipboard, please update your browser.",
//                             {
//                                 autoClose: 2000,
//                             }
//                         );
//                     }
//                 }}
//             />
//         );
//     }
//     // TODO: This component rerenders four times on initial render and on token refresh
//     const QrCode = memo(_QrCode);

//     useEffect(() => {
//         // Generate the TOTP secret on component mount
//         const getOtp = async () => {
//             // https://github.com/google/google-authenticator/wiki/Key-Uri-Format
//             const { TOTP } = await import("otpauth");
//             const totp = new TOTP({
//                 issuer: "CryptexVault",
//                 label: "Cryptex",
//                 algorithm: "SHA1",
//                 digits: 6,
//                 period: 30,
//             });

//             setOtpURI(totp.toString());
//             setSecret(totp.secret.base32);
//         };
//         if (!secret) getOtp();
//     }, [secret]);

//     const { mutate: registerUser } = trpc.useMutation(
//         ["credentials.register-user-legacy"],
//         {
//             onSuccess: async (_, variables) => {
//                 if (linkingMode) {
//                     toast.success("Account successfully linked!", {
//                         autoClose: 2000,
//                     });

//                     hideModalFn();
//                 } else {
//                     toast.success("User successfully registered.", {
//                         autoClose: 2000,
//                     });

//                     // Sign in user after registration
//                     await signInUser(
//                         { email: variables.email, token: variables.token },
//                         router
//                     );
//                 }
//                 setIsSubmitting(false);
//             },
//             onError(error) {
//                 toast.error(error.message);
//                 setIsSubmitting(false);
//             },
//         }
//     );

//     return (
//         <Formik
//             initialValues={{
//                 email: emailPrefill ?? "",
//                 secret: secret,
//                 token: "",
//             }}
//             enableReinitialize={true}
//             validate={(values: SignUpFormValues) => {
//                 const errors: { email?: string; token?: string } = {};
//                 if (!values.email) {
//                     errors.email = "This is a required field.";
//                 } else if (
//                     !/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(
//                         values.email
//                     )
//                 ) {
//                     errors.email = "Invalid email address.";
//                 }

//                 if (!values.token) {
//                     errors.token = "This is a required field.";
//                 }
//                 return errors;
//             }}
//             onSubmit={(values: SignUpFormValues, { setSubmitting }) => {
//                 setIsSubmitting(true);
//                 registerUser(values);
//                 setSubmitting(false);
//             }}
//         >
//             {({
//                 values,
//                 errors,
//                 touched,
//                 handleChange,
//                 handleBlur,
//                 handleSubmit,
//                 isSubmitting,
//             }) => (
//                 <Form
//                     className="flex flex-col space-y-4"
//                     onSubmit={handleSubmit}
//                 >
//                     <div className="flex flex-col">
//                         <label
//                             htmlFor="email"
//                             className="mb-2 text-sm font-medium text-gray-600"
//                         >
//                             Email *
//                         </label>
//                         <Field
//                             type="email"
//                             name="email"
//                             placeholder="Enter your email"
//                             className={`rounded-md border border-gray-300 px-3 py-2 disabled:text-gray-300 ${
//                                 errors.email && touched.email
//                                     ? "invalid:border-2 invalid:border-rose-500"
//                                     : ""
//                             } `}
//                             required={true}
//                             disabled={linkingMode != null}
//                             onChange={handleChange}
//                             onBlur={handleBlur}
//                             value={values.email}
//                         />
//                         <span
//                             className={`${
//                                 errors.email && touched.email
//                                     ? "block"
//                                     : "hidden"
//                             } text-sm text-rose-500`}
//                         >
//                             {errors.email && touched.email && errors.email}
//                         </span>
//                     </div>

//                     <div className="flex flex-col">
//                         <label className="mb-2 flex justify-center text-sm font-medium text-gray-600 sm:justify-start">
//                             TOTP Key
//                             <ArrowPathIcon
//                                 onClick={() => {
//                                     setSecret("");
//                                     setOtpURI("");
//                                 }}
//                                 className="ml-1 h-5 w-5 text-gray-500 hover:text-gray-700"
//                             />
//                         </label>
//                         <QrCode />
//                         <label className="flex justify-center text-sm text-gray-500">
//                             Press QR code to copy TOTP to clipboard.
//                             <br />
//                             Or copy the key below:
//                         </label>
//                         <input
//                             className="flex justify-center text-sm text-gray-500"
//                             readOnly={true}
//                             value={secret}
//                         ></input>
//                         <Field
//                             type="password"
//                             name="secret"
//                             hidden={true}
//                             onChange={handleChange}
//                             onBlur={handleBlur}
//                             value={values.secret}
//                         />
//                     </div>

//                     <div className="flex flex-col">
//                         <label
//                             htmlFor="token"
//                             className="mb-2 text-sm font-medium text-gray-600"
//                         >
//                             Token (One Time Password) *
//                         </label>
//                         <Field
//                             type="password"
//                             name="token"
//                             id="token"
//                             placeholder="Generated Token"
//                             className={`rounded-md border border-gray-300 px-3 py-2 ${
//                                 errors.token && touched.token
//                                     ? "invalid:border-2 invalid:border-rose-500"
//                                     : ""
//                             } `}
//                             required={true}
//                             onChange={handleChange}
//                             onBlur={handleBlur}
//                             value={values.token}
//                         />
//                         <span
//                             className={`${
//                                 errors.token && touched.token
//                                     ? "block"
//                                     : "hidden"
//                             } text-sm text-rose-500`}
//                         >
//                             {errors.token && touched.token && errors.token}
//                         </span>
//                     </div>
//                     {/* This is here because we want to be able to trigger the form submission on return key press */}
//                     <button
//                         type="submit"
//                         disabled={isSubmitting}
//                         hidden={true}
//                         ref={submitButtonRef}
//                     ></button>
//                 </Form>
//             )}
//         </Formik>
//     );
// };
// // #endregion

// // #region Sign In
// type SignInFormProps = {
//     submittingState: [boolean, React.Dispatch<React.SetStateAction<boolean>>];
//     submitButtonRef: React.RefObject<HTMLButtonElement>;
//     emailPrefill?: string | null;
// };

// interface SignInFormValues {
//     email: string;
//     token: string;
// }

// /**
//  * This function signs in the user and redirects them to the login page so that they can be redirected where needed.
//  * @param values Sign in form values
//  * @param router NextJS router instance
//  */
// const signInUser = async (values: SignInFormValues, router: NextRouter) => {
//     const signInDelay = 2000;

//     const result = await signIn("cryptex", {
//         redirect: false,
//         email: values.email,
//         token: values.token,
//     });

//     if (result?.ok) {
//         toast.success("Authentication successful. Redirecting...", {
//             autoClose: signInDelay,
//         });
//         setTimeout(() => {
//             // Reload the page so that the login page can take us to the protected page
//             // Push the route instead of reloading to avoid the flash of the login page
//             router.push(router.asPath);
//         }, parseInt(`${signInDelay / 2}`));
//     } else {
//         toast.error("Authentication failed. Please try again.");
//         console.error(result);
//     }
// };

// const SignInForm: React.FC<SignInFormProps> = ({
//     submittingState,
//     submitButtonRef,
//     emailPrefill,
// }) => {
//     const router = useRouter();

//     const setIsSubmitting = (value: boolean) => {
//         submittingState[1](value);
//     };

//     useEffect(() => {
//         // Get the token field and focus it
//         const tokenField = document.getElementById("token");
//         if (tokenField && emailPrefill) {
//             tokenField.focus();
//         } else {
//             const emailField = document.getElementById("email-signin");
//             if (emailField) {
//                 emailField.focus();
//             }
//         }
//     }, []);

//     return (
//         <Formik
//             initialValues={{ email: emailPrefill ?? "", token: "" }}
//             enableReinitialize={true}
//             validate={(values: SignInFormValues) => {
//                 const errors: { email?: string; token?: string } = {};
//                 if (!values.email) {
//                     errors.email = "This is a required field.";
//                 } else if (
//                     !/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(
//                         values.email
//                     )
//                 ) {
//                     errors.email = "Invalid email address.";
//                 }

//                 if (!values.token) {
//                     errors.token = "This is a required field.";
//                 }
//                 return errors;
//             }}
//             onSubmit={async (values: SignInFormValues, { setSubmitting }) => {
//                 setIsSubmitting(true);
//                 await signInUser(values, router);
//                 setSubmitting(false);
//                 setIsSubmitting(false);
//             }}
//         >
//             {({
//                 values,
//                 errors,
//                 touched,
//                 handleChange,
//                 handleBlur,
//                 handleSubmit,
//                 isSubmitting,
//             }) => (
//                 <Form
//                     className="flex flex-col space-y-4"
//                     onSubmit={handleSubmit}
//                 >
//                     <div className="flex flex-col">
//                         <label
//                             htmlFor="email"
//                             className="mb-2 text-sm font-medium text-gray-600"
//                         >
//                             Email *
//                         </label>
//                         <Field
//                             type="email"
//                             name="email"
//                             id="email-signin"
//                             placeholder="Enter your email"
//                             className={`rounded-md border border-gray-300 px-3 py-2 ${
//                                 errors.email && touched.email
//                                     ? "invalid:border-2 invalid:border-rose-500"
//                                     : ""
//                             } `}
//                             required={true}
//                             onChange={handleChange}
//                             onBlur={handleBlur}
//                             value={values.email}
//                         />
//                         <span
//                             className={`${
//                                 errors.email && touched.email
//                                     ? "block"
//                                     : "hidden"
//                             } text-sm text-rose-500`}
//                         >
//                             {errors.email && touched.email && errors.email}
//                         </span>
//                     </div>

//                     <div className="flex flex-col">
//                         <label
//                             htmlFor="token"
//                             className="mb-2 text-sm font-medium text-gray-600"
//                         >
//                             Token (One Time Password) *
//                         </label>
//                         <Field
//                             type="password"
//                             name="token"
//                             id="token"
//                             placeholder="Generated Token"
//                             className={`rounded-md border border-gray-300 px-3 py-2 ${
//                                 errors.token && touched.token
//                                     ? "invalid:border-2 invalid:border-rose-500"
//                                     : ""
//                             } `}
//                             required={true}
//                             onChange={handleChange}
//                             onBlur={handleBlur}
//                             value={values.token}
//                         />
//                         <span
//                             className={`${
//                                 errors.token && touched.token
//                                     ? "block"
//                                     : "hidden"
//                             } text-sm text-rose-500`}
//                         >
//                             {errors.token && touched.token && errors.token}
//                         </span>
//                     </div>
//                     {/* This is here because we want to be able to trigger the form submission on return key press */}
//                     <button
//                         type="submit"
//                         disabled={isSubmitting}
//                         hidden={true}
//                         ref={submitButtonRef}
//                     ></button>
//                 </Form>
//             )}
//         </Formik>
//     );
// };
// // #endregion

// export default LoginModal;
