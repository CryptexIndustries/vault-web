import { zodResolver } from "@hookform/resolvers/zod";
import { Turnstile } from "@marsidev/react-turnstile";
import { Controller, useForm } from "react-hook-form";
import { toast } from "react-toastify";
import { z } from "zod";
import { env } from "../../env/client.mjs";
import { trpcReact } from "../../utils/trpc";

export type NotifyMeReference = "enterprise-tier" | null;

const formSchema = z.object({
    email: z.string().email("This is a required field."),
    captchaToken: z.string().min(1, "Captcha is required."),
});

type FormSchemaType = z.infer<typeof formSchema>;

export type NotifyMeFormProps = {
    submitButtonRef: React.RefObject<HTMLButtonElement | null>;
    submittingState: [boolean, React.Dispatch<React.SetStateAction<boolean>>];
    hideModalFn: () => void;
    reference: NotifyMeReference;
};

const NotifyMeForm: React.FC<NotifyMeFormProps> = ({
    submitButtonRef,
    submittingState,
    hideModalFn,
    reference,
}) => {
    const [, setInProgress] = submittingState;

    const {
        control,
        handleSubmit,
        formState: { errors },
        setError: setFormError,
    } = useForm<FormSchemaType>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            email: "",
            captchaToken: "",
        },
    });

    const { mutate: notifyMeRegister } =
        trpcReact.v1.feedback.notifyMe.useMutation({
            onSuccess: async () => {
                hideModalFn();
                toast.success("You will be notified when we're launching!");
            },
            onError(error) {
                toast.error("Something went wrong. Please try again later.");
                console.error(error);
            },
        });

    const onSubmit = async (formData: FormSchemaType) => {
        setInProgress(true);

        const payload = {
            email: formData.email,
            ref: reference,
            captchaToken: formData.captchaToken,
        };
        notifyMeRegister(payload, {
            onSettled: () => {
                setInProgress(false);
            },
        });
    };

    return (
        <div className="flex w-full flex-col items-center space-y-4 text-center">
            <div className="flex w-full flex-col text-left">
                <Controller
                    control={control}
                    name="email"
                    render={({ field: { onChange, onBlur, value } }) => (
                        <>
                            <input
                                type="email"
                                autoCapitalize="none"
                                placeholder="Enter your email"
                                className="mt-4 rounded-md bg-gray-200 px-4 py-2 text-gray-900"
                                onChange={onChange}
                                onBlur={onBlur}
                                value={value}
                            />
                        </>
                    )}
                />
                {errors.email && (
                    <p className="text-red-500">{errors.email.message}</p>
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
                            }}
                            siteKey={env.NEXT_PUBLIC_TURNSTILE_SITE_KEY}
                            onError={() => {
                                setFormError("captchaToken", {
                                    message: "Captcha error",
                                });
                            }}
                            onExpire={() => onChange("")}
                            onSuccess={(token) => onChange(token)}
                        />
                    )}
                />
                {errors.captchaToken && (
                    <p className="text-red-500">
                        {errors.captchaToken.message}
                    </p>
                )}
                <button
                    ref={submitButtonRef}
                    hidden={true}
                    onClick={handleSubmit(onSubmit)}
                ></button>
            </div>
        </div>
    );
};

export default NotifyMeForm;
