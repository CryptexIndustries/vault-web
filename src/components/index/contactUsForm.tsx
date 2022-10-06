import HCaptcha from "@hcaptcha/react-hcaptcha";
import { ErrorMessage, Field, Form, Formik } from "formik";
import { useState } from "react";
import { toast } from "react-toastify";
import { trpc } from "../../utils/trpc";

export type ContactUsFormProps = {
    submitButtonRef: React.RefObject<HTMLButtonElement>;
    hideModalFn: () => void;
};

const ContactUsForm: React.FC<ContactUsFormProps> = ({
    submitButtonRef,
    hideModalFn,
}) => {
    const [inProgress, setInProgress] = useState(false);

    const captchaTokenFieldName = "captchaToken";

    const { mutate: sendMessage } = trpc.useMutation(["notifyme.contact"], {
        onSuccess: async (data) => {
            if (data.success === true) {
                hideModalFn();
                toast.success("Successfully sent!");
            } else {
                toast.error("Something went wrong. Please try again later.");
                if (data != null && data.message != null)
                    console.error(data.message);
            }
        },
        onError(error) {
            toast.error("Something went wrong. Please try again later.");
            console.error(error);
        },
    });

    return (
        <Formik
            initialValues={{ email: "", message: "", captchaToken: "" }}
            validate={(values: {
                email: string;
                message: string;
                captchaToken: string;
            }) => {
                const errors: {
                    email?: string;
                    message?: string;
                    captchaToken?: string;
                } = {};
                if (!values.email) {
                    errors.email = "This is a required field.";
                } else if (
                    !/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(
                        values.email
                    )
                ) {
                    errors.email = "Invalid email address.";
                }

                if (values.message == null || values.message.length === 0) {
                    errors.message = "This is a required field.";
                }

                if (
                    values.captchaToken == null ||
                    values.captchaToken.length === 0
                ) {
                    errors.captchaToken = "This is a required field.";
                }
                return errors;
            }}
            onSubmit={async (values, { setSubmitting }) => {
                if (inProgress == true) return;
                setInProgress(true);

                const payload = {
                    email: values.email,
                    message: values.message,
                    "h-captcha-response": values.captchaToken,
                };
                sendMessage(payload, {
                    onSettled: () => {
                        setSubmitting(false);
                        setInProgress(false);
                    },
                });
            }}
        >
            {({ isSubmitting, setFieldValue, setFieldError }) => (
                <Form>
                    <div className="flex flex-col space-y-4 w-full">
                        <div className="flex flex-col text-left">
                            <Field
                                name="email"
                                type="email"
                                placeholder="Enter your email"
                                className="bg-gray-200 text-gray-900 rounded-md px-4 py-2 mt-4"
                            />
                            <div className="text-red-500">
                                <ErrorMessage name="email" />
                            </div>
                        </div>
                        <div className="flex flex-col text-left">
                            <Field name="message">
                                {({
                                    field, // { name, value, onChange, onBlur }
                                }: {
                                    field: object;
                                }) => (
                                    <textarea
                                        {...field}
                                        placeholder="Enter your message"
                                        className="bg-gray-200 text-gray-900 rounded-md px-4 py-2 mt-4"
                                    />
                                )}
                            </Field>
                            <div className="text-red-500">
                                <ErrorMessage name="message" />
                            </div>
                        </div>
                        <div className="flex flex-col text-left">
                            <HCaptcha
                                theme="light"
                                sitekey={
                                    process.env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY ??
                                    ""
                                }
                                onVerify={(token) => {
                                    setFieldValue(captchaTokenFieldName, token);
                                }}
                                onError={(err) => {
                                    console.error(err);
                                    setFieldError(captchaTokenFieldName, err);
                                }}
                                onExpire={() => {
                                    console.debug("Captcha expired");
                                    setFieldValue(captchaTokenFieldName, "");
                                }}
                            />
                            <div className="text-red-500">
                                <ErrorMessage name={captchaTokenFieldName} />
                            </div>
                        </div>
                    </div>
                    <button
                        type="submit"
                        ref={submitButtonRef}
                        hidden={true}
                        disabled={isSubmitting}
                    ></button>
                </Form>
            )}
        </Formik>
    );
};

export default ContactUsForm;
