import { PrismaClient, ProductConfiguration } from "@prisma/client";

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
    prismaInstance: PrismaClient
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
 * If the user doesn't have a subscription in the database, create an entry with the standard tier.
 * Note: This function does a count query first to check if the user has a subscription.
 * Note: If the upsert parameter is true, the subscription will be updated to the standard tier if it exists.
 * @param prismaInstance The prisma instance to use. This is used to avoid circular dependencies.
 * @param user The user to initialize the subscription tier for
 * @param userEmail The user's email. This is used as a value that is always present in multiple tables.
 * @param upsert If true, update the subscription if it exists - basically set it to standard (free)
 */
export const initUserSubscriptionTier = async (
    prismaInstance: PrismaClient,
    userId: string,
    userEmail?: string,
    upsert?: boolean
) => {
    // Check if the user has a subscription by counting the number of subscriptions
    // Either 0 or 1, more than that is not possible
    // If upsert is true, we don't need to check if the user has a subscription
    const subscriptionExists = !upsert
        ? (await prismaInstance.subscription.count({
              where: {
                  user_id: userId,
              },
          })) > 0
        : false;

    // If the user doesn't have a subscription, create one with the standard tier
    if (!subscriptionExists || upsert) {
        const email =
            userEmail ??
            (
                await prismaInstance.user.findFirst({
                    where: {
                        id: userId,
                    },
                    select: {
                        email: true,
                    },
                })
            )?.email;

        // If we could not get the email, this create op would fail anyway
        if (email) {
            await prismaInstance.subscription.upsert({
                create: {
                    user_id: userId,
                    customer_id: userId,
                    email: email,
                    created_at: new Date(),
                    product_id: PAYMENT_TIERS.standard,
                },
                update: {
                    // This is called when the user cancels their subscription
                    created_at: new Date(),
                    expires_at: null,
                    status: null,
                    payment_status: null,
                    cancel_at_period_end: null,
                    product_id: PAYMENT_TIERS.standard,
                },
                where: {
                    email: email,
                },
            });
        }
    }
};
