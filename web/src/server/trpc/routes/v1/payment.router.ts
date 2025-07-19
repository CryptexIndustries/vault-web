import { z } from "zod";
import {
    createCheckoutSession,
    getBillingPortalSession,
    getCheckoutUrl,
} from "../../../utils/stripe";
import * as trpc from "@trpc/server";

import {
    GetPriceID,
    PAYMENT_TIERS,
    PRICE_ID_KEY,
    REVERSE_TIER_MAP,
} from "../../../utils/subscription";
import {
    GetSubscriptionOutputSchemaType,
    getSubscriptionOutputSchema,
} from "../../../../schemes/payment_router";
import { protectedProcedure } from "../../trpc";
import { checkRatelimitter } from "../../../common/ratelimiting";

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

export const paymentRouterGetCheckoutURL = protectedProcedure
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
    .output(z.string().nullable())
    .query(async ({ ctx, input }) => {
        await checkRatelimitter(
            ctx.apiKeyHash,
            "PAYMENT_GET_CHECKOUT_URL",
            3,
            "10s",
        );

        const priceId = GetPriceID(input.tier as PRICE_ID_KEY);

        if (!priceId?.length) {
            console.error(
                `[TRPC - payment.getCheckoutURL] Invalid price ID. Tried: ${priceId} from ${input.tier}`,
            );
        }

        try {
            const id = await createCheckoutSession(ctx.user.id, priceId);

            return await getCheckoutUrl(id);
        } catch (error) {
            console.error(error);

            throw new trpc.TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: "Something went wrong",
            });
        }
    });

export const paymentRouterGetSubscription = protectedProcedure
    .output(getSubscriptionOutputSchema)
    .query(async ({ ctx }) => {
        await checkRatelimitter(
            ctx.apiKeyHash,
            "PAYMENT_GET_SUBSCRIPTION",
            3,
            "10s",
        );

        const subscriptionData = await ctx.prisma.subscription.findFirst({
            where: {
                user_id: ctx.user.id,
            },
            select: {
                created_at: true,
                expires_at: true,
                status: true,
                payment_status: true,
                cancel_at_period_end: true,
                product_id: true,
                customer_id: true,
            },
        });

        // Number of linked devices corresponds to the number of accounts with the same user ID
        // This does not include the main device
        const linkedDevices =
            (await ctx.prisma.aPIKey.count({
                where: {
                    user_id: ctx.user.id,
                },
            })) - 1;

        const output: GetSubscriptionOutputSchemaType = {
            createdAt: subscriptionData?.created_at,
            expiresAt: subscriptionData?.expires_at,
            status: subscriptionData?.status, // as Stripe.Subscription.Status,
            paymentStatus: subscriptionData?.payment_status,
            cancelAtPeriodEnd: subscriptionData?.cancel_at_period_end,
            productId: subscriptionData?.product_id,
            productName:
                REVERSE_TIER_MAP[
                    subscriptionData?.product_id ?? PAYMENT_TIERS.standard
                ]?.toUpperCase() ?? "Unknown",
            // customerId: subscriptionData?.customer_id,
            nonFree:
                REVERSE_TIER_MAP[
                    subscriptionData?.product_id ?? PAYMENT_TIERS.standard
                ] !== PAYMENT_TIERS.standard,
            resourceStatus: {
                linkedDevices: linkedDevices,
            },
        };

        return output;
    });

export const paymentRouterGetCustomerPortal = protectedProcedure
    .output(z.string().nullable())
    .query(async ({ ctx }) => {
        await checkRatelimitter(
            ctx.apiKeyHash,
            "PAYMENT_GET_CUSTOMER_PORTAL",
            3,
            "10s",
        );

        const subscription = await ctx.prisma.subscription.findFirst({
            where: {
                user_id: ctx.user.id,
            },
            select: {
                customer_id: true,
                product_id: true,
            },
        });

        // If the user doesn't have a subscription, don't fetch the customer portal URL
        if (
            !subscription ||
            (subscription &&
                subscription.product_id &&
                REVERSE_TIER_MAP[subscription.product_id] ===
                    PAYMENT_TIERS.standard)
        ) {
            return null;
        }

        try {
            const session = await getBillingPortalSession(
                subscription.customer_id,
            );

            return session.url;
        } catch (error) {
            console.error(
                "[TRPC - payment.getCustomerPortal] Failed to get user billing portal session URL.",
                error,
            );
            throw new trpc.TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: "Something went wrong",
            });
        }
    });
