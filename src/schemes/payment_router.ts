import { z } from "zod";

export const getSubscriptionOutputSchema = z.object({
    created_at: z.date().nullish(),
    expires_at: z.date().nullish(),
    // status: StripeSubscriptionStatusZod.nullish(),
    status: z.string().nullish(),
    payment_status: z.string().nullish(),
    cancel_at_period_end: z.boolean().nullish(),
    product_id: z.string().nullish(),
    product_name: z.string(),
    customer_id: z.string().nullish(),
    nonFree: z.boolean(),
    configuration: z
        .object({
            linking_allowed: z.boolean(),
            linked_devices: z.number(),
            linked_devices_limit: z.number(),
            feature_voting: z.boolean(),
            credentials_borrowing: z.boolean(),
            automated_backups: z.boolean(),
        })
        .nullable(),
});
export type GetSubscriptionOutputSchemaType = z.infer<
    typeof getSubscriptionOutputSchema
>;
