import { z } from "zod";
import validateCaptcha from "../../../utils/captcha";
import {
    checkRatelimitNotifyme,
    trpcRatelimitError,
} from "../../common/ratelimiting";
import { protectedProcedure, publicProcedure } from "../trpc";
import { sendContactEmail, sendFeedbackEmail } from "../../common/email";

export const notifyMeRouterRegister = publicProcedure
    .input(
        z.object({
            email: z.string().email(),
            ref: z.enum(["enterprise-tier"]).nullable(),
            captchaToken: z.string(),
        }),
    )
    .mutation(async ({ ctx, input }) => {
        if (!checkRatelimitNotifyme(ctx.userIP)) {
            throw trpcRatelimitError;
        }

        // Send a request to the Captcha API to verify the user's response
        const verification = await validateCaptcha(input.captchaToken);

        // If the user's response was invalid, return an error
        if (!verification.success) {
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
        }),
    )
    .mutation(async ({ ctx, input }) => {
        if (!checkRatelimitNotifyme(ctx.userIP)) {
            throw trpcRatelimitError;
        }

        // Send a request to the Captcha API to verify the user's response
        const verification = await validateCaptcha(input.captchaToken);

        // If the user's response was invalid, return an error
        if (!verification.success) {
            throw new Error("Failed to validate captcha");
        }

        try {
            await sendContactEmail(input.email, input.message);

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

export const feedbackRouter = protectedProcedure
    .input(
        z.object({
            reason: z.enum(["Feature", "Bug", "General"]),
            message: z.string().max(500),
            captchaToken: z.string(),
        }),
    )
    .mutation(async ({ ctx, input }) => {
        if (!checkRatelimitNotifyme(ctx.userIP)) {
            throw trpcRatelimitError;
        }

        // Send a request to the Captcha API to verify the user's response
        const verification = await validateCaptcha(input.captchaToken);

        // If the user's response was invalid, return an error
        if (!verification.success) {
            throw new Error("Failed to validate captcha");
        }

        try {
            await sendFeedbackEmail(
                ctx.session.user.email,
                ctx.session.user.id,
                input.reason,
                input.message,
            );

            return {
                success: true,
                message: "",
            };
        } catch (error: unknown) {
            console.error(`[notifyme.feedback] Error sending email: ${error}`);
            return {
                success: false,
                message: "Something went wrong.",
            };
        }
    });
