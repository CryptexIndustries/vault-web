import { z } from "zod";
import { createRouter } from "../context";

const gethCaptchaConfirmation = async (token: string) => {
    return await fetch("https://hcaptcha.com/siteverify", {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
            secret: process.env.HCAPTCHA_SECRET ?? "",
            response: token,
        }),
    }).then((res) => res.json());
};

export const notifyMeRouter = createRouter()
    .mutation("register", {
        input: z.object({
            email: z.string().email(),
            "h-captcha-response": z.string(),
        }),
        async resolve({ input, ctx }) {
            try {
                if (!process.env.HCAPTCHA_SECRET) {
                    throw new Error("HCAPTCHA_SECRET is not defined");
                }

                // Send a request to the HCaptcha API to verify the user's response
                // const verification = await fetch(
                //     "https://hcaptcha.com/siteverify",
                //     {
                //         method: "POST",
                //         headers: {
                //             "Content-Type": "application/x-www-form-urlencoded",
                //         },
                //         body: new URLSearchParams({
                //             secret: process.env.HCAPTCHA_SECRET ?? "",
                //             response: input["h-captcha-response"] ?? "",
                //         }),
                //     }
                // ).then((res) => res.json());
                const verification = await gethCaptchaConfirmation(
                    input["h-captcha-response"]
                );

                // If the user's response was invalid, return an error
                if (!verification.success) {
                    console.log(`hCaptcha err: ${verification["error-codes"]}`);
                    throw new Error("Invalid hCaptcha response");
                }

                // Save the email to the DB. Don't throw an error if the email is already in the database
                try {
                    await ctx.prisma.notifyMeUsers.create({
                        data: {
                            email: input.email,
                        },
                    });
                } catch (_) {}

                return {
                    success: true,
                    message: "",
                };
            } catch (error: unknown) {
                // console.log(error);
                return {
                    success: false,
                    message: "Something went wrong.",
                };
            }
        },
    })
    .mutation("contact", {
        input: z.object({
            email: z.string().email(),
            message: z.string(),
            "h-captcha-response": z.string(),
        }),
        async resolve({ input }) {
            return {
                success: true,
                message: "",
            };
            try {
                if (!process.env.HCAPTCHA_SECRET) {
                    throw new Error("HCAPTCHA_SECRET is not defined");
                }

                // Send a request to the HCaptcha API to verify the user's response
                const verification = await gethCaptchaConfirmation(
                    input["h-captcha-response"]
                );

                // If the user's response was invalid, return an error
                if (!verification.success) {
                    console.log(`hCaptcha err: ${verification["error-codes"]}`);
                    throw new Error("Invalid hCaptcha response");
                }

                // Send an email over the zoho email api
                // TODO: https://www.zoho.com/mail/help/api/post-send-an-email.html
                const response = await fetch(
                    "https://mail.zoho.com/api/accounts/100000000000000001/messages",
                    {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            Authorization: `Zoho-oauthtoken ${process.env.ZOHO_TOKEN}`,
                        },
                        body: JSON.stringify({
                            fromAddress: "",
                            toAddress: "",
                            subject: "Contact Form Submission",
                            content: `
                                Email: ${input.email}
                                Message: ${input.message}
                            `,
                        }),
                    }
                );

                if (response.status !== 200) {
                    throw new Error("Something went wrong");
                }

                return {
                    success: true,
                    message: "",
                };
            } catch (error: unknown) {
                console.log(error);
                return {
                    success: false,
                    message: "Something went wrong.",
                };
            }
        },
    });
