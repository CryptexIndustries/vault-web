import { z } from "zod";
import { protectedProcedure, publicProcedure } from "../../trpc";

export const feedbackRouterNotifyMe = publicProcedure
    .input(
        z.object({
            email: z.string().email(),
            ref: z.enum(["enterprise-tier"]).nullable(),
            captchaToken: z.string(),
        }),
    )
    .output(z.void())
    .mutation(() => {
        throw new Error("api-contract stub");
    })
;
export const feedbackRouterContact = publicProcedure
    .input(
        z.object({
            email: z.string().email(),
            message: z.string().max(500),
            captchaToken: z.string(),
        }),
    )
    .output(z.void())
    .mutation(() => {
        throw new Error("api-contract stub");
    })
;
export const feedbackRouterGiveFeedback = protectedProcedure
    .input(
        z.object({
            reason: z.enum(["Feature", "Bug", "General"]),
            message: z.string().max(500),
            email: z.string().email().optional(),
            captchaToken: z.string(),
        }),
    )
    .output(z.void())
    .mutation(() => {
        throw new Error("api-contract stub");
    })
;
