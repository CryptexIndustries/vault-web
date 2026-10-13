import { z } from "zod";
import { protectedProcedure } from "../../trpc";
import {
    getSubscriptionOutputSchema,
    paymentReturnTargetSchema,
} from "../../payment";

export const paymentRouterGetCheckoutSession = protectedProcedure
    .input(
        z
            .union([
                z.object({
                    tier: z
                        .enum([
                            "premiumMonthly",
                            "premiumYearly",
                            "onlineServicesMonthly",
                            "onlineServicesYearly",
                        ])
                        .default("premiumMonthly"),
                    uiMode: z.literal("embedded").default("embedded"),
                    returnTarget: paymentReturnTargetSchema.optional(),
                }),
                z.object({
                    tier: z
                        .enum([
                            "premiumMonthly",
                            "premiumYearly",
                            "onlineServicesMonthly",
                            "onlineServicesYearly",
                        ])
                        .default("premiumMonthly"),
                    uiMode: z.literal("hosted"),
                    returnTarget: paymentReturnTargetSchema,
                }),
            ])
            .default({
                tier: "premiumMonthly",
                uiMode: "embedded",
            }),
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
    .input(
        z
            .object({ returnTarget: paymentReturnTargetSchema.default("web") })
            .default({ returnTarget: "web" }),
    )
    .output(z.string().nullable())
    .query(() => {
        throw new Error("api-contract stub");
    });

export const paymentRouterRevenueCatCustomer = protectedProcedure
    .output(
        z.object({
            enabled: z.boolean(),
            appUserId: z.string(),
            canPurchase: z.boolean(),
        }),
    )
    .query(() => {
        throw new Error("api-contract stub");
    });

export const paymentRouterSyncRevenueCat = protectedProcedure
    .output(z.void())
    .mutation(() => {
        throw new Error("api-contract stub");
    });
