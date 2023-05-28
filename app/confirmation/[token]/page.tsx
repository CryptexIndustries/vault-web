"use client";

import { Controller, useForm } from "react-hook-form";
// import { trpc } from "../../../src/utils/trpc";
import { Turnstile } from "@marsidev/react-turnstile";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

/**
 * Form containing a captcha and a submit button
 * On submit, send a TRPC request to the API to confirm the user
 * If the user is confirmed, redirect to /app
 * If the user is not confirmed, display an error message
 */

export const runtime = "nodejs";

type PageParams = {
    token: string;
};

export default async function ConfirmationPage({
    params,
}: {
    params: PageParams;
}) {
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

    // const { mutateAsync: confirmUser, isLoading } = trpc.useMutation([
    //     "credentials.confirm",
    // ]);

    const confirmUser = async (data: {
        captchaToken: string;
        token: string;
    }) => {
        const result = await fetch(
            `${process.env.NEXT_PUBLIC_API_URL}/api/[trpc]/credentials/confirm`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    captchaToken: data.captchaToken,
                    token: data.token,
                }),
            }
        );

        return result.json();
    };

    const onSubmit = async (formData: FormSchemaType) => {
        const result = await confirmUser({
            captchaToken: formData.captchaToken,
            token: params.token,
        });
        console.log(result);
    };

    // if (isLoading) {
    //     return <p>Loading...</p>;
    // }

    // Form containing a captcha and a submit button
    return (
        <div className="flex h-full min-h-screen w-full flex-col items-center justify-center space-y-4 px-2 text-center">
            <h1 className="text-3xl font-bold">Confirm your identity</h1>
            <p className="text-lg">
                Please confirm your identity to continue using CryptexVault.
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
                            siteKey={
                                process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? ""
                            }
                            onError={() => {
                                setFormError("captchaToken", {
                                    message: "Captcha error",
                                });
                            }}
                            onExpire={() => onChange("")}
                            onSuccess={(token) => {
                                onChange(token);
                                handleSubmit(onSubmit);
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
            {errors.root && (
                <p className="text-red-500">{errors.root.message}</p>
            )}
        </div>
    );
}
