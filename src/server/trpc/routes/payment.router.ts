// import Stripe from "stripe";
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
} from "../../../schemes/payment_router";
import {
    checkRatelimitPaymentRouter,
    trpcRatelimitError,
} from "../../common/ratelimiting";
import { protectedProcedure } from "../trpc";

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
            .default({ tier: PAYMENT_TIERS.premiumMonthly })
    )
    .output(z.string().nullable())
    .query(async ({ ctx, input }) => {
        if (!checkRatelimitPaymentRouter(ctx.userIP, false)) {
            throw trpcRatelimitError;
        }

        const priceId = GetPriceID(input.tier as PRICE_ID_KEY);

        if (!priceId?.length) {
            console.error(
                `[TRPC - payment.getCheckoutURL] Invalid price ID. Tried: ${priceId} from ${input.tier}`
            );
        }

        try {
            const id = await createCheckoutSession(
                ctx.session.user.email,
                priceId
            );

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
        if (!checkRatelimitPaymentRouter(ctx.userIP, true)) {
            throw trpcRatelimitError;
        }

        const subscriptionData = await ctx.prisma.subscription.findFirst({
            where: {
                user_id: ctx.session.user.id,
            },
            select: {
                created_at: true,
                expires_at: true,
                status: true,
                payment_status: true,
                cancel_at_period_end: true,
                product_id: true,
                customer_id: true,
                configuration: true,
            },
        });

        // Number of linked devices corresponds to the number of accounts with the same user ID
        const linkedDevices = await ctx.prisma.account.count({
            where: {
                userId: ctx.session.user.id,
            },
        });

        const output: GetSubscriptionOutputSchemaType = {
            created_at: subscriptionData?.created_at,
            expires_at: subscriptionData?.expires_at,
            status: subscriptionData?.status, // as Stripe.Subscription.Status,
            payment_status: subscriptionData?.payment_status,
            cancel_at_period_end: subscriptionData?.cancel_at_period_end,
            product_id: subscriptionData?.product_id,
            product_name:
                REVERSE_TIER_MAP[
                    subscriptionData?.product_id ?? PAYMENT_TIERS.standard
                ]?.toUpperCase() ?? "Unknown",
            customer_id: subscriptionData?.customer_id,
            nonFree:
                REVERSE_TIER_MAP[
                    subscriptionData?.product_id ?? PAYMENT_TIERS.standard
                ] !== PAYMENT_TIERS.standard,
            configuration: null,
        };

        // The subscription configuration is null if the subscription is not configured in the db
        if (subscriptionData?.configuration) {
            output.configuration = {
                linking_allowed: subscriptionData.configuration.linking_allowed,
                linked_devices: linkedDevices,
                linked_devices_limit: subscriptionData.configuration.max_links,
                feature_voting: subscriptionData.configuration.feature_voting,
                credentials_borrowing:
                    subscriptionData.configuration.credentials_borrowing,
                automated_backups:
                    subscriptionData.configuration.automated_backups,
            };
        } else {
            console.error(
                "[TRPC - payment.getSubscription] Subscription configuration is null. This can only happen if we got a subscription product_id for which there is no configuration in the db."
            );
        }

        return output;
    });

export const paymentRouterGetCustomerPortal = protectedProcedure
    .output(z.string().nullable())
    .query(async ({ ctx }) => {
        if (!checkRatelimitPaymentRouter(ctx.userIP, true)) {
            throw trpcRatelimitError;
        }

        const subscription = await ctx.prisma.subscription.findFirst({
            where: {
                user_id: ctx.session.user.id,
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
                subscription.customer_id
            );
            return session.url;
        } catch (error) {
            console.error(
                "[TRPC - payment.getCustomerPortal] Failed to get user billing portal session URL.",
                error
            );
            throw new trpc.TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: "Something went wrong",
            });
        }
    });
