// @ts-check
import { z } from "zod";

export const booleanString = (
    /** @type {z.ZodDefault<z.ZodTypeAny>} */ schema,
) =>
    z.preprocess((a) => {
        if (typeof a === "string") {
            return a.toLowerCase() === "true";
        } else if (typeof a === "boolean") {
            return a;
        } else {
            return false;
        }
    }, schema);

// Same thing but for numbers
export const numberString = (
    /** @type {z.ZodDefault<z.ZodTypeAny>} */ schema,
) =>
    z.preprocess((a) => {
        if (typeof a === "string") {
            return parseInt(a);
        } else if (typeof a === "number") {
            return a;
        } else {
            return 0;
        }
    }, schema);

/**
 * Specify your server-side environment variables schema here.
 * This way you can ensure the app isn't built with invalid env vars.
 */
export const serverSchema = z.object({
    DATABASE_URL: z.string().url(),
    NODE_ENV: z.enum(["development", "test", "production"]),
    NEXTAUTH_SECRET: z.string(),
    NEXTAUTH_URL: z.string().url(),

    /* Authentication */
    // GOOGLE_CLIENT_ID: z.string(),
    // GOOGLE_CLIENT_SECRET: z.string(),
    // GITHUB_CLIENT_ID: z.string(),
    // GITHUB_CLIENT_SECRET: z.string(),
    // GITLAB_CLIENT_ID: z.string(),
    // GITLAB_CLIENT_SECRET: z.string(),
    // APPLE_CLIENT_ID: z.string(),
    // APPLE_CLIENT_SECRET: z.string(),
    // ATLASSIAN_CLIENT_ID: z.string(),
    // ATLASSIAN_CLIENT_SECRET: z.string(),
    // DISCORD_CLIENT_ID: z.string(),
    // DISCORD_CLIENT_SECRET: z.string(),

    /* Upstash Redis */
    UPSTASH_REDIS_REST_URL: z.string().url(),
    UPSTASH_REDIS_REST_TOKEN: z.string(),

    /* Captcha - Turnstile */
    TURNSTILE_SECRET: z.string(),

    /* Email */
    INFOBIP_BASE_URL: z.string().optional(),
    INFOBIP_API_KEY: z.string().optional(),
    INFOBIP_EMAIL_VALIDATION: booleanString(z.boolean().default(false)),
    EMAIL_SENDER: z.string().optional(),
    EMAIL_CONTACT_US_SENDER: z.string(),
    EMAIL_CONTACT_US_RECEIVER: z.string(),

    /* Pusher */
    PUSHER_APP_SECRET: z.string(),

    /* Stripe */
    STRIPE_SECRET_KEY: z.string(),
    STRIPE_WEBHOOK_SECRET: z.string(),
});

/**
 * Specify your client-side environment variables schema here.
 * This way you can ensure the app isn't built with invalid env vars.
 * To expose them to the client, prefix them with `NEXT_PUBLIC_`.
 */
export const clientSchema = z.object({
    NEXT_PUBLIC_APP_URL: z.string().default("http://localhost:3000"),

    NEXT_PUBLIC_TURNSTILE_SITE_KEY: z.string(),

    NEXT_PUBLIC_PUSHER_APP_ID: z.string(),
    NEXT_PUBLIC_PUSHER_APP_KEY: z.string(),
    NEXT_PUBLIC_PUSHER_APP_HOST: z.string(),
    NEXT_PUBLIC_PUSHER_APP_PORT: z.string(),
    NEXT_PUBLIC_PUSHER_APP_TLS: z.boolean(),

    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string(),
    NEXT_PUBLIC_STRIPE_PREMIUM_PRODUCT_ID: z.string(),
    NEXT_PUBLIC_STRIPE_PREMIUM_MONTHLY_PRICE_ID: z.string(),
    NEXT_PUBLIC_STRIPE_PREMIUM_YEARLY_PRICE_ID: z.string(),
});

/**
 * You can't destruct `process.env` as a regular object, so you have to do
 * it manually here. This is because Next.js evaluates this at build time,
 * and only used environment variables are included in the build.
 * @type {{ [k in keyof z.infer<typeof clientSchema>]: z.infer<typeof clientSchema>[k] | undefined }}
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
};
