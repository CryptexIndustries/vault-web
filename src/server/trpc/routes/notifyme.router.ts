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

                const nodemailer = await import("nodemailer");
                // Send email using the nodemailer package
                const transporter = nodemailer.createTransport({
                    host: process.env.SMTP_HOST,
                    port: Number(process.env.SMTP_PORT),
                    secureConnection: false,
                    tls: {
                        ciphers: "SSLv3",
                    },
                    auth: {
                        user: process.env.SMTP_USER,
                        pass: process.env.SMTP_PASS,
                    },
                });

                await transporter.sendMail({
                    from: `"CryptexVaultRouter " <${process.env.SMTP_USER}>`,
                    to: process.env.SMTP_RECEIVER,
                    subject: "Contact form submission",
                    html: `
                        <h1>Contact form submission</h1>
                        <p><strong>From:</strong> ${input.email}</p>
                        <br />
                        <hr />
                        <br />
                        <p>${input.message}</p>
                    `,
                    headers: {
                        "Reply-To": input.email,
                    },
                });

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
