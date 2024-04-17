import { PrismaClient, ProductConfiguration } from "@prisma/client";
import type { NextApiResponse } from "next/types";
import { getLatestInvoice, getSubscription } from "./stripe";

export type PRICE_ID_KEY = "standard" | "premiumMonthly" | "premiumYearly";

export const PAYMENT_TIERS_LABELS = [
    "standard",
    "premiumMonthly",
    "premiumYearly",
];

export const PAYMENT_TIERS = {
    standard: "standard",
    premiumMonthly: "premiumMonthly",
    premiumYearly: "premiumYearly",
};

const PRICE_ID = {
    premiumMonthly: process.env
        .NEXT_PUBLIC_STRIPE_PREMIUM_MONTHLY_PRICE_ID as string,
    premiumYearly: process.env
        .NEXT_PUBLIC_STRIPE_PREMIUM_YEARLY_PRICE_ID as string,
    // premium: process.env.NEXT_PUBLIC_STRIPE_PREMIUM_PRODUCT_ID as string,
    // [process.env.NEXT_PUBLIC_STRIPE_PREMIUM_PRODUCT_ID as string]: "premium",
};

export const REVERSE_TIER_MAP = {
    ["standard"]: "standard",
    [process.env.NEXT_PUBLIC_STRIPE_PREMIUM_PRODUCT_ID as string]: "premium",
};

export const GetPriceID = (key: PRICE_ID_KEY) =>
    key === "standard" ? "" : PRICE_ID[key] ?? "";

/**
 * Insert the default standard subscription tier into the database.
 * @param prismaInstance The prisma instance to use. This is used to avoid circular dependencies.
 */
export const initProductConfiguration = async (
    prismaInstance: PrismaClient,
): Promise<ProductConfiguration> => {
    return await prismaInstance.productConfiguration.upsert({
        create: {
            product_id: PAYMENT_TIERS.standard,
        },
        update: {},
        where: {
            product_id: PAYMENT_TIERS.standard,
        },
    });
};

/**
 * If the user doesn't have a subscription in the database, create an entry with the standard tier, otherwise, update the subscription to the standard tier.
 * @param prismaInstance The prisma instance to use. This is used to avoid circular dependencies.
 * @param userId The user to initialize the subscription tier for
 */
export const upsertUserSubscriptionTier = async (
    prismaInstance: PrismaClient,
    userId: string,
) => {
    await prismaInstance.subscription.upsert({
        create: {
            user_id: userId,
            customer_id: userId,
            created_at: new Date(),
            product_id: PAYMENT_TIERS.standard,
        },
        where: {
            user_id: userId,
        },
        update: {
            // This is used when we're resetting the subscription to standard
            created_at: new Date(),
            expires_at: null,
            status: null,
            payment_status: null,
            cancel_at_period_end: null,
            product_id: PAYMENT_TIERS.standard,
        },
    });
};

export const updateSubscription = async (
    prismaInstance: PrismaClient,
    res: NextApiResponse,
    eventType: string,
    customerId: string,
    userId: string,
    subscriptionId: string,
    paymentStatus?: string,
) => {
    if (!userId?.length) {
        console.error(
            `[Stripe] [${eventType}] || CustomerID: ${customerId} || Error: Invalid userId`,
        );

        // Don't send an error, because we don't want to retry the webhook
        res.status(200).send({ received: true });
        return;
    }

    // Get the customers subscription from stripe
    const subscription = await getSubscription(subscriptionId);

    // Validate the Stripe subscription object
    if (!subscription) {
        console.error(
            `[Stripe] [${eventType}] || CustomerID: ${customerId} UserID: ${userId} || Error: Could not find users subscription`,
        );

        // Don't send an error, because we don't want to retry the webhook
        res.status(200).send({ received: true });
        return;
    }

    // Fetch the latest invoice only if we have the subscription object and the paymentStatus is null
    const latestInvoice =
        subscription && !paymentStatus
            ? await getLatestInvoice(subscription.latest_invoice as string)
            : null;

    // Here we update the subscription in the database
    await prismaInstance.subscription.upsert({
        create: {
            user_id: userId,
            customer_id: customerId,
            created_at: new Date(subscription.current_period_start * 1000),
            expires_at: new Date(subscription.current_period_end * 1000),
            status: subscription.status.toString(),
            payment_status: paymentStatus ?? latestInvoice?.status ?? null,
            cancel_at_period_end: subscription.cancel_at_period_end,
            product_id: subscription.items.data[0]?.plan.product?.toString(),
        },
        update: {
            customer_id: customerId,
            created_at: new Date(subscription.current_period_start * 1000),
            expires_at: new Date(subscription.current_period_end * 1000),
            status: subscription.status.toString(),
            payment_status: paymentStatus ?? latestInvoice?.status ?? null,
            cancel_at_period_end: subscription.cancel_at_period_end,
            product_id: subscription.items.data[0]?.plan.product?.toString(),
        },
        where: {
            user_id: userId,
        },
    });
};
