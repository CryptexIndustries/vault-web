import { z } from "zod";

import { protectedProcedure } from "../../trpc";
import { getSubscriptionOutputSchema } from "../../payment";

const PAYMENT_TIERS = {
    premiumMonthly: "premiumMonthly",
    premiumYearly: "premiumYearly",
} as const;

// const StripeSubscriptionStatusZod: z.ZodType<Stripe.Subscription.Status> =
//     z.enum([
//         "active",
//         "canceled",
//         "incomplete",
//         "incomplete_expired",
//         "past_due",
//         "trialing",
//         "unpaid",
//     ]);

export const paymentRouterGetCheckoutSession = protectedProcedure
    .input(
        z
            .object({
                tier: z
                    .enum([
                        PAYMENT_TIERS.premiumMonthly,
                        PAYMENT_TIERS.premiumYearly,
                    ])
                    .default(PAYMENT_TIERS.premiumMonthly),
            })
            .default({ tier: PAYMENT_TIERS.premiumMonthly }),
    )
    .output(z.string())
    .query(() => {
        throw new Error("api-contract stub");
    });
export const paymentRouterGetSubscription = protectedProcedure
    .output(getSubscriptionOutputSchema)
    .query(() => {
        throw new Error("api-contract stub");
    });
export const paymentRouterGetCustomerPortal = protectedProcedure
    .output(z.string().nullable())
    .query(() => {
        throw new Error("api-contract stub");
    });
