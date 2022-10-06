import HCaptcha from "@hcaptcha/react-hcaptcha";
import { ErrorMessage, Field, Form, Formik } from "formik";
import { useState } from "react";
import { toast } from "react-toastify";
import { trpc } from "../../utils/trpc";

export type NotifyMeFormProps = {
    submitButtonRef: React.RefObject<HTMLButtonElement>;
    hideModalFn: () => void;
};

const NotifyMeForm: React.FC<NotifyMeFormProps> = ({
    submitButtonRef,
    hideModalFn,
}) => {
    const [inProgress, setInProgress] = useState(false);

    const captchaTokenFieldName = "captchaToken";

    const { mutate: notifyMeRegister } = trpc.useMutation(
        ["notifyme.register"],
        {
            onSuccess: async (data) => {
                if (data.success === true) {
                    hideModalFn();
                    toast.success("You will be notified when we're launching!");
                } else {
                    toast.error(
                        "Something went wrong. Please try again later."
                    );
                    if (data != null && data.message != null)
                        console.error(data.message);
                }
            },
            onError(error) {
                toast.error("Something went wrong. Please try again later.");
                console.error(error);
            },
        }
    );

    return (
        <Formik
            initialValues={{ email: "", captchaToken: "" }}
            validate={(values: { email: string; captchaToken: string }) => {
                const errors: { email?: string; captchaToken?: string } = {};
                if (!values.email) {
                    errors.email = "This is a required field.";
                } else if (
                    !/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(
                        values.email
                    )
                ) {
                    errors.email = "Invalid email address.";
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
                if (inProgress) return;
                setInProgress(true);

                setTimeout(async () => {
                    const payload = {
                        email: values.email,
                        "h-captcha-response": values.captchaToken,
                    };
                    notifyMeRegister(payload, {
                        onSettled: () => {
                            setSubmitting(false);
                            setInProgress(false);
                        },
                    });
                }, 500);
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

export default NotifyMeForm;
