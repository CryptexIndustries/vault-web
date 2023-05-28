import { useState } from "react";
import { useRouter } from "next/router";
import { TRPCClientError } from "@trpc/client";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Turnstile } from "@marsidev/react-turnstile";

import { env } from "../../env/client.mjs";
import { trpc } from "../../utils/trpc";
import NavBar from "../../components/navbar";
import HTMLHeader from "../../components/html_header";
import HTMLMain from "../../components/html_main";

export default function ConfirmationPage() {
    const router = useRouter();

    const requestToken = router.query.token;

    const formSchema = z.object({
        captchaToken: z.string().nonempty("Captcha is required."),
    });

    type FormSchemaType = z.infer<typeof formSchema>;

    const {
        control,
        handleSubmit,
        setError: setFormError,
        formState: { errors },
    } = useForm<FormSchemaType>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            captchaToken: "",
        },
    });

    const [success, setSuccess] = useState(false);

    // const [submitResult, setSubmitResult] = useState<string | null>(null);
    const { mutateAsync: confirmIdentity, isLoading } =
        trpc.credentials.confirm.useMutation();

    const onSubmit = async (formData: FormSchemaType) => {
        if (!requestToken) {
            return;
        }

        try {
            await confirmIdentity({
                captchaToken: formData.captchaToken,
                token: requestToken as string,
            });

            setSuccess(true);

            setTimeout(() => {
                router.push("/app");
            }, 1000);
        } catch (e) {
            console.error(e);
            if (e instanceof TRPCClientError) {
                setFormError("root", {
                    message: e.message,
                });
            }
        }
    };

    if (!requestToken) {
        return null;
    }

    // Form containing a captcha and a submit button
    return (
        <>
            <HTMLHeader
                title="Cryptex Vault - Identity Confirmation"
                description=""
            />

            <HTMLMain additionalClasses="flex flex-col flex-grow">
                <NavBar />

                <div className="content flex h-full w-full flex-grow flex-col items-center justify-center space-y-4 px-2 text-center">
                    <h1 className="text-3xl font-bold">
                        Confirm your identity
                    </h1>
                    <p className="text-lg">
                        Please confirm your identity to continue using
                        CryptexVault.
                    </p>

                    <div className="flex w-full flex-col items-center">
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
                                        setSuccess(false);
                                    }}
                                    onExpire={() => {
                                        onChange("");
                                        setSuccess(false);
                                    }}
                                    onSuccess={(token) => {
                                        onChange(token);
                                        handleSubmit(onSubmit)();
                                    }}
                                />
                            )}
                        />
                        {errors.captchaToken && (
                            <p className="text-red-500">
                                {errors.captchaToken.message}
                            </p>
                        )}
                    </div>
                    {isLoading && (
                        <p className="animate-pulse text-slate-500">
                            Loading...
                        </p>
                    )}
                    {errors.root && (
                        <div>
                            <p className="text-red-500">
                                Failed to confirm identity. Try again or resend
                                the confirmation email. If the problem persists,
                                contact support.
                            </p>
                            <p className="text-red-500">
                                Error: {errors.root.message}
                            </p>
                        </div>
                    )}
                    {success && (
                        <div>
                            <p className="text-green-500">
                                Identity successfully confirmed.
                            </p>
                            <p className="animate-pulse text-green-500">
                                Redirecting...
                            </p>
                        </div>
                    )}
                </div>
            </HTMLMain>
        </>
    );
}
