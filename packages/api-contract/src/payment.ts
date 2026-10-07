import { z } from "zod";

export const getSubscriptionOutputSchema = z.object({
    createdAt: z.date().nullish(),
    expiresAt: z.date().nullish(),
    status: z.string().nullish(),
    paymentStatus: z.string().nullish(),
    cancelAtPeriodEnd: z.boolean().nullish(),
    productId: z.string().nullish(),
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
