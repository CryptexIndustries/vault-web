// @ts-check
import { z } from "zod";

/**
 * Client-side environment variables (public repo).
 * Server secrets and validation live in cryptex-vault-cloud/web/src/env/.
 */
const baseClientSchema = z.object({
    NEXT_PUBLIC_APP_URL: z.string().default("http://localhost:3000"),

    NEXT_PUBLIC_TURNSTILE_SITE_KEY: z.string().default(""),

    NEXT_PUBLIC_PUSHER_APP_ID: z.string().default(""),
    NEXT_PUBLIC_PUSHER_APP_KEY: z.string().default(""),
    NEXT_PUBLIC_PUSHER_APP_HOST: z.string().default(""),
    NEXT_PUBLIC_PUSHER_APP_PORT: z.string().default(""),
    NEXT_PUBLIC_PUSHER_APP_TLS: z
        .preprocess(
            (v) => (typeof v === "string" ? v.toLowerCase() === "true" : !!v),
            z.boolean(),
        )
        .default(false),

    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().default(""),
    NEXT_PUBLIC_STRIPE_PREMIUM_PRODUCT_ID: z.string().default(""),
    NEXT_PUBLIC_STRIPE_PREMIUM_MONTHLY_PRICE_ID: z.string().default(""),
    NEXT_PUBLIC_STRIPE_PREMIUM_YEARLY_PRICE_ID: z.string().default(""),

    /** Cryptex Cloud API origin (tRPC). Empty = use NEXT_PUBLIC_APP_URL. */
    NEXT_PUBLIC_ONLINE_SERVICES_API_URL: z.string().default(""),
    /** Exact S3-compatible origin used by short-lived backup transfer URLs. */
    NEXT_PUBLIC_BACKUP_STORAGE_ORIGIN: z.string().default(""),

    /** When "false", hide online-services UI and skip cloud tRPC. */
    NEXT_PUBLIC_CLOUD_ENABLED: z
        .preprocess(
            (v) =>
                typeof v === "string"
                    ? v.toLowerCase() !== "false"
                    : typeof v === "boolean"
                      ? v
                      : true,
            z.boolean(),
        )
        .default(true),
});

/** @param {string | undefined} value */
const isBlank = (value) => typeof value !== "string" || value.trim() === "";

export const clientSchema = baseClientSchema.superRefine((data, ctx) => {
    if (!data.NEXT_PUBLIC_CLOUD_ENABLED) {
        return;
    }

    /** @param {keyof z.infer<typeof baseClientSchema>} field @param {string} label */
    const requireField = (field, label) => {
        const value = data[field];
        if (typeof value !== "string" || isBlank(value)) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: [field],
                message: `${label} is required when NEXT_PUBLIC_CLOUD_ENABLED is true`,
            });
        }
    };

    requireField("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "Turnstile site key");
    requireField("NEXT_PUBLIC_PUSHER_APP_ID", "Pusher app id");
    requireField("NEXT_PUBLIC_PUSHER_APP_KEY", "Pusher app key");
    requireField("NEXT_PUBLIC_PUSHER_APP_HOST", "Pusher host");
    requireField("NEXT_PUBLIC_PUSHER_APP_PORT", "Pusher port");
    requireField(
        "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
        "Stripe publishable key",
    );
    requireField(
        "NEXT_PUBLIC_STRIPE_PREMIUM_PRODUCT_ID",
        "Stripe premium product id",
    );
    requireField(
        "NEXT_PUBLIC_STRIPE_PREMIUM_MONTHLY_PRICE_ID",
        "Stripe premium monthly price id",
    );
    requireField(
        "NEXT_PUBLIC_STRIPE_PREMIUM_YEARLY_PRICE_ID",
        "Stripe premium yearly price id",
    );

    if (
        !isBlank(data.NEXT_PUBLIC_STRIPE_PREMIUM_PRODUCT_ID) &&
        !data.NEXT_PUBLIC_STRIPE_PREMIUM_PRODUCT_ID.startsWith("prod_")
    ) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["NEXT_PUBLIC_STRIPE_PREMIUM_PRODUCT_ID"],
            message: "Must be a Stripe product id (prod_…)",
        });
    }

    if (
        !isBlank(data.NEXT_PUBLIC_STRIPE_PREMIUM_MONTHLY_PRICE_ID) &&
        !data.NEXT_PUBLIC_STRIPE_PREMIUM_MONTHLY_PRICE_ID.startsWith("price_")
    ) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["NEXT_PUBLIC_STRIPE_PREMIUM_MONTHLY_PRICE_ID"],
            message: "Must be a Stripe price id (price_…)",
        });
    }

    if (
        !isBlank(data.NEXT_PUBLIC_STRIPE_PREMIUM_YEARLY_PRICE_ID) &&
        !data.NEXT_PUBLIC_STRIPE_PREMIUM_YEARLY_PRICE_ID.startsWith("price_")
    ) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["NEXT_PUBLIC_STRIPE_PREMIUM_YEARLY_PRICE_ID"],
            message: "Must be a Stripe price id (price_…)",
        });
    }
});

/**
 * @type {{ [k in keyof z.infer<typeof baseClientSchema>]: z.infer<typeof baseClientSchema>[k] | undefined }}
 */
export const clientEnv = {
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,

    NEXT_PUBLIC_TURNSTILE_SITE_KEY: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,

    NEXT_PUBLIC_PUSHER_APP_ID: process.env.NEXT_PUBLIC_PUSHER_APP_ID,
    NEXT_PUBLIC_PUSHER_APP_KEY: process.env.NEXT_PUBLIC_PUSHER_APP_KEY,
    NEXT_PUBLIC_PUSHER_APP_HOST: process.env.NEXT_PUBLIC_PUSHER_APP_HOST,
    NEXT_PUBLIC_PUSHER_APP_PORT: process.env.NEXT_PUBLIC_PUSHER_APP_PORT,
    NEXT_PUBLIC_PUSHER_APP_TLS:
        process.env.NEXT_PUBLIC_PUSHER_APP_TLS?.toLowerCase() === "true",

    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY:
        process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_STRIPE_PREMIUM_PRODUCT_ID:
        process.env.NEXT_PUBLIC_STRIPE_PREMIUM_PRODUCT_ID,
    NEXT_PUBLIC_STRIPE_PREMIUM_MONTHLY_PRICE_ID:
        process.env.NEXT_PUBLIC_STRIPE_PREMIUM_MONTHLY_PRICE_ID,
    NEXT_PUBLIC_STRIPE_PREMIUM_YEARLY_PRICE_ID:
        process.env.NEXT_PUBLIC_STRIPE_PREMIUM_YEARLY_PRICE_ID,

    NEXT_PUBLIC_ONLINE_SERVICES_API_URL:
        process.env.NEXT_PUBLIC_ONLINE_SERVICES_API_URL ?? "",
    NEXT_PUBLIC_BACKUP_STORAGE_ORIGIN:
        process.env.NEXT_PUBLIC_BACKUP_STORAGE_ORIGIN ?? "",

    NEXT_PUBLIC_CLOUD_ENABLED:
        process.env.NEXT_PUBLIC_CLOUD_ENABLED?.toLowerCase() !== "false",
};
