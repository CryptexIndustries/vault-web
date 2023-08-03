// @ts-check
import { z } from "zod";

export const booleanString = (
    /** @type {z.ZodDefault<z.ZodTypeAny>} */ schema
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
    /** @type {z.ZodDefault<z.ZodTypeAny>} */ schema
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

    /* Upstash Ratelimitting */
    UPSTASH_RATELIMIT_ENABLE_AUTH: booleanString(z.boolean().default(false)),
    UPSTASH_RATELIMIT_N_REQUESTS_AUTH: numberString(z.number().default(2)),
    UPSTASH_RATELIMIT_DURATION_AUTH: z.string().default("5s"),

    UPSTASH_RATELIMIT_ENABLE_USER_VERIFICATION: booleanString(
        z.boolean().default(false)
    ),
    UPSTASH_RATELIMIT_N_REQUESTS_USER_VERIFICATION: numberString(
        z.number().default(3)
    ),
    UPSTASH_RATELIMIT_DURATION_USER_VERIFICATION: z.string().default("10m"),

    UPSTASH_RATELIMIT_ENABLE_REGISTER: booleanString(
        z.boolean().default(false)
    ),
    UPSTASH_RATELIMIT_N_REQUESTS_REGISTER: numberString(z.number().default(1)),
    UPSTASH_RATELIMIT_DURATION_REGISTER: z.string().default("1m"),

    UPSTASH_RATELIMIT_ENABLE_PAYMENTROUTER_DB: booleanString(
        z.boolean().default(false)
    ),
    UPSTASH_RATELIMIT_N_REQUESTS_PAYMENTROUTER_DB: numberString(
        z.number().default(3)
    ),
    UPSTASH_RATELIMIT_DURATION_PAYMENTROUTER_DB: z.string().default("5s"),
    UPSTASH_RATELIMIT_ENABLE_PAYMENTROUTER_NODB: booleanString(
        z.boolean().default(false)
    ),
    UPSTASH_RATELIMIT_N_REQUESTS_PAYMENTROUTER_NODB: numberString(
        z.number().default(3)
    ),
    UPSTASH_RATELIMIT_DURATION_PAYMENTROUTER_NODB: z.string().default("5s"),

    UPSTASH_RATELIMIT_ENABLE_FEATUREVOTINGROUTER: booleanString(
        z.boolean().default(false)
    ),
    UPSTASH_RATELIMIT_N_REQUESTS_FEATUREVOTINGROUTER: numberString(
        z.number().default(3)
    ),
    UPSTASH_RATELIMIT_DURATION_FEATUREVOTINGROUTER: z.string().default("10s"),
    UPSTASH_RATELIMIT_ENABLE_FEATUREVOTINGROUTER_MUTATION: z
        .boolean()
        .default(false),
    UPSTASH_RATELIMIT_N_REQUESTS_FEATUREVOTINGROUTER_MUTATION: z
        .number()
        .default(1),
    UPSTASH_RATELIMIT_DURATION_FEATUREVOTINGROUTER_MUTATION: z
        .string()
        .default("1m"),

    UPSTASH_RATELIMIT_ENABLE_NOTIFYMEROUTER: booleanString(
        z.boolean().default(false)
    ),
    UPSTASH_RATELIMIT_N_REQUESTS_NOTIFYMEROUTER: numberString(
        z.number().default(5)
    ),
    UPSTASH_RATELIMIT_DURATION_NOTIFYMEROUTER: z.string().default("1m"),

    UPSTASH_RATELIMIT_ENABLE_ACCOUNTROUTER_QUERY: booleanString(
        z.boolean().default(false)
    ),
    UPSTASH_RATELIMIT_N_REQUESTS_ACCOUNTROUTER_QUERY: numberString(
        z.number().default(4)
    ),
    UPSTASH_RATELIMIT_DURATION_ACCOUNTROUTER_QUERY: z.string().default("10s"),
    UPSTASH_RATELIMIT_ENABLE_ACCOUNTROUTER_MUTATION: booleanString(
        z.boolean().default(false)
    ),
    UPSTASH_RATELIMIT_N_REQUESTS_ACCOUNTROUTER_MUTATION: numberString(
        z.number().default(5)
    ),
    UPSTASH_RATELIMIT_DURATION_ACCOUNTROUTER_MUTATION: z.string().default("5s"),

    UPSTASH_RATELIMIT_ENABLE_API_PUSHER: booleanString(
        z.boolean().default(false)
    ),
    UPSTASH_RATELIMIT_N_REQUESTS_API_PUSHER: numberString(
        z.number().default(5)
    ),
    UPSTASH_RATELIMIT_DURATION_API_PUSHER: z.string().default("30s"),

    /* Captcha - Turnstile */
    TURNSTILE_SECRET: z.string(),

    /* Email */
    INFOBIP_BASE_URL: z.string().optional(),
    INFOBIP_API_KEY: z.string().optional(),
    EMAIL_SENDER: z.string().optional(),
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

    // Make captcha mandatory for the Sign in endpoint
    NEXT_PUBLIC_SIGNIN_VALIDATE_CAPTCHA: z.boolean().default(false),

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

    NEXT_PUBLIC_SIGNIN_VALIDATE_CAPTCHA:
        process.env.NEXT_PUBLIC_SIGNIN_VALIDATE_CAPTCHA?.toLowerCase() ===
        "true",

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
