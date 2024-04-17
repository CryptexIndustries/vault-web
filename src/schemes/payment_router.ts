import { z } from "zod";

export const getSubscriptionOutputSchema = z.object({
    createdAt: z.date().nullish(),
    expiresAt: z.date().nullish(),
    // status: StripeSubscriptionStatusZod.nullish(),
    status: z.string().nullish(),
    paymentStatus: z.string().nullish(),
    cancelAtPeriodEnd: z.boolean().nullish(),
    productId: z.string().nullish(),
    productName: z.string(),
    // customerId: z.string().nullish(),
    nonFree: z.boolean(),
    // configuration: z
    //     .object({
    //         linkingAllowed: z.boolean(),
    //         linkedDevices: z.number(),
    //         linkedDevicesLimit: z.number(),
    //         featureVoting: z.boolean(),
    //         credentialsBorrowing: z.boolean(),
    //     })
    //     .nullable(),
    resourceStatus: z.object({
        linkedDevices: z.number(),
    }),
});
export type GetSubscriptionOutputSchemaType = z.infer<
    typeof getSubscriptionOutputSchema
>;
