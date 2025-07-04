import { zodResolver } from "@hookform/resolvers/zod";
import { Turnstile } from "@marsidev/react-turnstile";
import React from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "react-toastify";
import { z } from "zod";
import { trpcReact } from "../../utils/trpc";

import { useAtomValue } from "jotai";
import { env } from "../../env/client.mjs";
import { onlineServicesBoundAtom } from "../../utils/atoms";
import { ButtonFlat, ButtonType } from "../general/buttons";
import { FormSelectboxField } from "../general/input-fields";
import { Body, Footer, GenericModal, Title } from "../general/modal";

const formSchema = z.object({
    reason: z.enum(["Feature", "Bug", "General"]),
    message: z
        .string()
        .min(10, "Message needs to be larger than 10 characters.")
        .max(500, "Message needs to be smaller than 500 characters."),
    captchaToken: z.string().min(1, "Captcha is required."),
});

type FormSchemaType = z.infer<typeof formSchema>;

const FeedbackDialog: React.FC<{
    showDialogFnRef: React.MutableRefObject<() => void>;
}> = ({ showDialogFnRef }) => {
    const [visible, setVisible] = React.useState(false);
    showDialogFnRef.current = () => setVisible(true);
    const hideDialog = () => {
        setVisible(false);

        setTimeout(() => {
            resetForm();
            setInProgress(false);
        }, 200);
    };

    const boundToOnlineServices = useAtomValue(onlineServicesBoundAtom);

    const [isInProgress, setInProgress] = React.useState(false);

    const {
        control,
        register: registerControl,
        handleSubmit,
        formState: { errors },
        reset: resetForm,
        setError: setFormError,
    } = useForm<FormSchemaType>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            reason: "General",
            message: "",
            captchaToken: "",
        },
    });

    const { mutate: sendMessage } = trpcReact.v1.feedback.feedback.useMutation({
        onSuccess: async () => {
            hideDialog();
            toast.success("Successfully sent!");
        },
        onError(error) {
            toast.error("Something went wrong. Please try again later.");
            console.error(error);
        },
    });

    const onSubmit = async (formData: FormSchemaType) => {
        setInProgress(true);

        const payload = {
            reason: formData.reason,
            message: formData.message,
            captchaToken: formData.captchaToken,
        };
        sendMessage(payload, {
            onSettled: () => {
                setInProgress(false);
            },
        });
    };

    return (
        <GenericModal
            key="contact-us-dialog"
            visibleState={[visible, hideDialog]}
            inhibitDismissOnClickOutside={isInProgress}
            childrenTitle={<Title>Contact us</Title>}
        >
            <Body>
                <div className="flex flex-col items-center text-center">
                    <p className="text-gray-700">
                        Send us your feature requests, bug reports, or general
                        feedback.
                    </p>
                    {/* Overlay that is active if the session is null */}
                    {!boundToOnlineServices && (
                        <div
                            className={
                                "absolute inset-0 flex items-center justify-center backdrop-blur-sm"
                            }
                        >
                            <div className="flex flex-col items-center justify-center space-y-2 text-center">
                                <p className="text-lg font-bold text-slate-800">
                                    You are not signed in
                                </p>
                                <p className="text-base text-slate-600">
                                    You need to be signed in to send feedback.
                                </p>
                            </div>
                        </div>
                    )}
                    {boundToOnlineServices && (
                        <div className="flex w-full flex-col items-center space-y-4 text-center">
                            <div className="flex w-full flex-col text-left">
                                <p className="text-gray-600">Reason</p>
                                <FormSelectboxField
                                    options={["General", "Feature", "Bug"]}
                                    register={registerControl("reason")}
                                />
                                {errors.reason && (
                                    <p className="text-red-500">
                                        {errors.reason.message}
                                    </p>
                                )}
                            </div>
                            <div className="flex w-full flex-col text-left">
                                <Controller
                                    control={control}
                                    name="message"
                                    render={({
                                        field: { onChange, onBlur, value },
                                    }) => (
                                        <>
                                            <textarea
                                                autoCapitalize="sentences"
                                                placeholder="Enter your message"
                                                className="mt-4 rounded-md bg-gray-200 px-4 py-2 text-gray-900"
                                                onChange={onChange}
                                                onBlur={onBlur}
                                                value={value}
                                            />
                                        </>
                                    )}
                                />
                                {errors.message && (
                                    <p className="text-red-500">
                                        {errors.message.message}
                                    </p>
                                )}
                            </div>
                            <div className="flex flex-col">
                                <Controller
                                    control={control}
                                    name="captchaToken"
                                    render={({ field: { onChange } }) => (
                                        <Turnstile
                                            options={{
                                                theme: "light",
                                                size: "normal",
                                                language: "auto",
                                                refreshExpired: "manual",
                                            }}
                                            siteKey={
                                                env.NEXT_PUBLIC_TURNSTILE_SITE_KEY
                                            }
                                            onError={() => {
                                                setFormError("captchaToken", {
                                                    message: "Captcha error",
                                                });
                                            }}
                                            onExpire={() => {
                                                onChange("");
                                                setFormError("captchaToken", {
                                                    message: "Captch expired",
                                                });
                                            }}
                                            onSuccess={(token) =>
                                                onChange(token)
                                            }
                                        />
                                    )}
                                />
                                {errors.captchaToken && (
                                    <p className="text-red-500">
                                        {errors.captchaToken.message}
                                    </p>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </Body>

            <Footer className="space-y-3 sm:space-x-5 sm:space-y-0">
                <ButtonFlat
                    text="Send"
                    className="sm:ml-2"
                    onClick={handleSubmit(onSubmit)}
                    disabled={isInProgress}
                    loading={isInProgress}
                />
                <ButtonFlat
                    text="Close"
                    type={ButtonType.Secondary}
                    onClick={hideDialog}
                />
            </Footer>
        </GenericModal>
    );
};

export default FeedbackDialog;
