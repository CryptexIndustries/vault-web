import { z } from "zod";
import validateCaptcha from "../../../utils/captcha";
import {
    checkRatelimitNotifyme,
    trpcRatelimitError,
} from "../../common/ratelimiting";
import { publicProcedure } from "../trpc";

export const notifyMeRouterRegister = publicProcedure
    .input(
        z.object({
            email: z.string().email(),
            ref: z.enum(["enterprise-tier"]).nullable(),
            captchaToken: z.string(),
        })
    )
    .mutation(async ({ ctx, input }) => {
        if (!checkRatelimitNotifyme(ctx.userIP)) {
            throw trpcRatelimitError;
        }

        // Send a request to the Captcha API to verify the user's response
        const verification = await validateCaptcha(input.captchaToken);

        // If the user's response was invalid, return an error
        if (!verification.success) {
            // console.log(`Captcha err: ${verification["error-codes"]}`);
            throw new Error("Failed to validate captcha");
        }

        try {
            // Save the email to the DB. Don't throw an error if the email is already in the database
            try {
                await ctx.prisma.notifyMeUsers.create({
                    data: {
                        email: input.email,
                        ref: input.ref?.toString() ?? null,
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
    });

export const notifyMeRouterContact = publicProcedure
    .input(
        z.object({
            email: z.string().email(),
            message: z.string().max(500),
            captchaToken: z.string(),
        })
    )
    .mutation(async ({ ctx, input }) => {
        if (!checkRatelimitNotifyme(ctx.userIP)) {
            throw trpcRatelimitError;
        }

        // Send a request to the Captcha API to verify the user's response
        const verification = await validateCaptcha(input.captchaToken);

        // If the user's response was invalid, return an error
        if (!verification.success) {
            // console.log(`Captcha err: ${verification["error-codes"]}`);
            throw new Error("Failed to validate captcha");
        }

        try {
            const nodemailer = await import("nodemailer");
            // Send email using the nodemailer package
            // Cast the object as any because the types are wrong...
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
            } as any);

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
            console.error(`[notifyme.contact] Error sending email: ${error}`);
            return {
                success: false,
                message: "Something went wrong.",
            };
        }
    });
