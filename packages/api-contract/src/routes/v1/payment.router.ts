import { protectedProcedure } from "../../trpc";
import { z } from "zod";
import { getSubscriptionOutputSchema } from "../../payment";

export const paymentRouterGetCheckoutSession = protectedProcedure
    .input(
        z
            .object({
                tier: z
                    .enum(["premiumMonthly", "premiumYearly"])
                    .default("premiumMonthly"),
            })
            .default({ tier: "premiumMonthly" }),
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
