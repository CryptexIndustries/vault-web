import HCaptcha from "@hcaptcha/react-hcaptcha";
import { toast } from "react-toastify";
import { trpc } from "../../utils/trpc";
import { z } from "zod";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

export type NotifyMeReference = "enterprise-tier" | null;

const formSchema = z.object({
    Email: z.string().email("This is a required field."),
    CaptchaResponse: z.string().min(1, "This is a required field."),
});

type FormSchemaType = z.infer<typeof formSchema>;

export type NotifyMeFormProps = {
    submitButtonRef: React.RefObject<HTMLButtonElement>;
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
            Email: "",
            CaptchaResponse: "",
        },
    });

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

    const onSubmit = async (formData: FormSchemaType) => {
        setInProgress(true);

        const payload = {
            email: formData.Email,
            ref: reference,
            "h-captcha-response": formData.CaptchaResponse,
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
                    name="Email"
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
                {errors.Email && (
                    <p className="text-red-500">{errors.Email.message}</p>
                )}
            </div>
            <div className="flex flex-col">
                <Controller
                    control={control}
                    name="CaptchaResponse"
                    render={({ field: { onChange } }) => (
                        <HCaptcha
                            theme="light"
                            sitekey={
                                process.env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY ?? ""
                            }
                            onVerify={(token) => {
                                onChange(token);
                            }}
                            onError={(err) => {
                                console.error(err);
                                setFormError("CaptchaResponse", {
                                    message: err,
                                });
                            }}
                            onExpire={() => {
                                console.debug("Captcha expired");
                                onChange("");
                            }}
                        />
                    )}
                />
                {errors.CaptchaResponse && (
                    <p className="text-red-500">
                        {errors.CaptchaResponse.message}
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
