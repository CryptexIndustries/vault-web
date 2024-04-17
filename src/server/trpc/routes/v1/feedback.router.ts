import { z } from "zod";
import { protectedProcedure, publicProcedure } from "../../trpc";
import validateCaptcha from "../../../utils/captcha";
import { checkRatelimitter } from "../../../common/ratelimiting";
import { sendContactEmail, sendFeedbackEmail } from "../../../common/email";
import { TRPCError } from "@trpc/server";
import { Prisma } from "@prisma/client";

export const feedbackRouterNotifyMe = publicProcedure
    .input(
        z.object({
            email: z.string().email(),
            ref: z.enum(["enterprise-tier"]).nullable(),
            captchaToken: z.string(),
        }),
    )
    .mutation(async ({ ctx, input }) => {
        await checkRatelimitter(ctx.userIP, "FEEDBACK_NOTIFY_ME", 2, "2m");

        // Send a request to the Captcha API to verify the user's response
        await validateCaptcha(input.captchaToken);

        // Try to save the email to the DB
        try {
            try {
                await ctx.prisma.notifyMeUsers.create({
                    data: {
                        email: input.email,
                        ref: input.ref?.toString() ?? null,
                    },
                });
            } catch (e) {
                // If the email is already in the database, return a nice message
                if (e instanceof Prisma.PrismaClientKnownRequestError) {
                    if (e.code === "P2002") {
                        throw new TRPCError({
                            code: "BAD_REQUEST",
                            message: "You are already registered for updates!",
                        });
                    }
                }

                throw new TRPCError({
                    code: "INTERNAL_SERVER_ERROR",
                    message: "Something went wrong",
                });
            }
        } catch (err) {
            console.error(
                `[TRPC - feedback.register] Error saving email to DB: ${err}`,
            );

            throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: "Something went wrong",
            });
        }
    });

export const feedbackRouterContact = publicProcedure
    .input(
        z.object({
            email: z.string().email(),
            message: z.string().max(500),
            captchaToken: z.string(),
        }),
    )
    .mutation(async ({ ctx, input }) => {
        await checkRatelimitter(ctx.userIP, "FEEDBACK_CONTACT", 2, "2m");

        // Send a request to the Captcha API to verify the user's response
        await validateCaptcha(input.captchaToken);

        try {
            await sendContactEmail(input.email, input.message);
        } catch (error: unknown) {
            console.error(
                `[TRPC - feedback.contact] Error sending email: ${error}`,
            );

            throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: "Something went wrong",
            });
        }
    });

export const feedbackRouterGiveFeedback = protectedProcedure
    .input(
        z.object({
            reason: z.enum(["Feature", "Bug", "General"]),
            message: z.string().max(500),
            email: z.string().email().optional(),
            captchaToken: z.string(),
        }),
    )
    .mutation(async ({ ctx, input }) => {
        await checkRatelimitter(
            ctx.apiKeyHash,
            "FEEDBACK_GIVE_FEEDBACK",
            3,
            "1m",
        );

        // Send a request to the Captcha API to verify the user's response
        await validateCaptcha(input.captchaToken);

        try {
            await sendFeedbackEmail(
                input.email ?? null,
                ctx.user.id,
                input.reason,
                input.message,
            );
        } catch (error: unknown) {
            console.error(
                `[TRPC - feedback.giveFeedback] Error sending email: ${error}`,
            );

            throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: "Something went wrong",
            });
        }
    });
