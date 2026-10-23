import { z } from "zod";

/** Who bills the subscription that currently grants access. */
export const billingProviderSchema = z.enum([
    "stripe",
    "google_play",
    "app_store",
]);
export type BillingProvider = z.infer<typeof billingProviderSchema>;

export const getSubscriptionOutputSchema = z.object({
    provider: billingProviderSchema.nullable(),
    expiresAt: z.date().nullish(),
    /** `trialing` during a free trial on any provider. */
    status: z.string().nullish(),
    trialEligible: z.boolean(),
    /** End of the current free trial; null outside a trial. */
    trialEndsAt: z.date().nullable(),
    cancelAtPeriodEnd: z.boolean().nullish(),
    productName: z.string(),
    nonFree: z.boolean(),
    resourceStatus: z.object({
        linkedDevices: z.number(),
    }),
});
export type GetSubscriptionOutputSchemaType = z.infer<
    typeof getSubscriptionOutputSchema
>;

// Clients choose a known destination, never an arbitrary return URL.
export const paymentReturnTargetSchema = z.enum([
    "web",
    "mobile-production",
    "mobile-preprod",
]);
export type PaymentReturnTarget = z.infer<typeof paymentReturnTargetSchema>;
