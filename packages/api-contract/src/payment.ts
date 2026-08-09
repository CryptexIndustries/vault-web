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
