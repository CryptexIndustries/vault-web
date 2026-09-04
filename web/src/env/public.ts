import { z } from "zod";

const publicEnvSchema = z
    .object({
        NEXT_PUBLIC_APP_URL: z.string().default("http://localhost:3000"),
        NEXT_PUBLIC_TURNSTILE_SITE_KEY: z.string().default(""),
        NEXT_PUBLIC_PUSHER_APP_ID: z.string().default(""),
        NEXT_PUBLIC_PUSHER_APP_KEY: z.string().default(""),
        NEXT_PUBLIC_PUSHER_APP_HOST: z.string().default(""),
        NEXT_PUBLIC_PUSHER_APP_PORT: z.string().default(""),
        NEXT_PUBLIC_PUSHER_APP_TLS: z
            .preprocess(
                (value) =>
                    typeof value === "string"
                        ? value.toLowerCase() === "true"
                        : !!value,
                z.boolean(),
            )
            .default(false),
        NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().default(""),
        NEXT_PUBLIC_STRIPE_PREMIUM_PRODUCT_ID: z.string().default(""),
        NEXT_PUBLIC_STRIPE_PREMIUM_MONTHLY_PRICE_ID: z.string().default(""),
        NEXT_PUBLIC_STRIPE_PREMIUM_YEARLY_PRICE_ID: z.string().default(""),
        NEXT_PUBLIC_ONLINE_SERVICES_API_URL: z.string().default(""),
        NEXT_PUBLIC_BACKUP_STORAGE_ORIGIN: z.string().default(""),
        NEXT_PUBLIC_CLOUD_ENABLED: z
            .preprocess(
                (value) =>
                    typeof value === "string"
                        ? value.toLowerCase() !== "false"
                        : typeof value === "boolean"
                          ? value
                          : true,
                z.boolean(),
            )
            .default(true),
    })
    .superRefine((data, context) => {
        if (!data.NEXT_PUBLIC_CLOUD_ENABLED) return;

        const required = [
            ["NEXT_PUBLIC_TURNSTILE_SITE_KEY", "Turnstile site key"],
            ["NEXT_PUBLIC_PUSHER_APP_ID", "Pusher app id"],
            ["NEXT_PUBLIC_PUSHER_APP_KEY", "Pusher app key"],
            ["NEXT_PUBLIC_PUSHER_APP_HOST", "Pusher host"],
            ["NEXT_PUBLIC_PUSHER_APP_PORT", "Pusher port"],
            ["NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "Stripe publishable key"],
            [
                "NEXT_PUBLIC_STRIPE_PREMIUM_PRODUCT_ID",
                "Stripe premium product id",
            ],
            [
                "NEXT_PUBLIC_STRIPE_PREMIUM_MONTHLY_PRICE_ID",
                "Stripe premium monthly price id",
            ],
            [
                "NEXT_PUBLIC_STRIPE_PREMIUM_YEARLY_PRICE_ID",
                "Stripe premium yearly price id",
            ],
        ] as const;

        for (const [field, label] of required) {
            if (!data[field].trim()) {
                context.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: [field],
                    message: `${label} is required when NEXT_PUBLIC_CLOUD_ENABLED is true`,
                });
            }
        }

        const stripeIds = [
            ["NEXT_PUBLIC_STRIPE_PREMIUM_PRODUCT_ID", "prod_", "product"],
            ["NEXT_PUBLIC_STRIPE_PREMIUM_MONTHLY_PRICE_ID", "price_", "price"],
            ["NEXT_PUBLIC_STRIPE_PREMIUM_YEARLY_PRICE_ID", "price_", "price"],
        ] as const;

        for (const [field, prefix, label] of stripeIds) {
            if (data[field] && !data[field].startsWith(prefix)) {
                context.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: [field],
                    message: `Must be a Stripe ${label} id (${prefix}…)`,
                });
            }
        }
    });

const readRuntimeEnv = (key: string) => process.env[key];

const readServerEnv = () => ({
    NEXT_PUBLIC_APP_URL: readRuntimeEnv("NEXT_PUBLIC_APP_URL"),
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: readRuntimeEnv(
        "NEXT_PUBLIC_TURNSTILE_SITE_KEY",
    ),
    NEXT_PUBLIC_PUSHER_APP_ID: readRuntimeEnv("NEXT_PUBLIC_PUSHER_APP_ID"),
    NEXT_PUBLIC_PUSHER_APP_KEY: readRuntimeEnv("NEXT_PUBLIC_PUSHER_APP_KEY"),
    NEXT_PUBLIC_PUSHER_APP_HOST: readRuntimeEnv("NEXT_PUBLIC_PUSHER_APP_HOST"),
    NEXT_PUBLIC_PUSHER_APP_PORT: readRuntimeEnv("NEXT_PUBLIC_PUSHER_APP_PORT"),
    NEXT_PUBLIC_PUSHER_APP_TLS: readRuntimeEnv("NEXT_PUBLIC_PUSHER_APP_TLS"),
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: readRuntimeEnv(
        "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
    ),
    NEXT_PUBLIC_STRIPE_PREMIUM_PRODUCT_ID: readRuntimeEnv(
        "NEXT_PUBLIC_STRIPE_PREMIUM_PRODUCT_ID",
    ),
    NEXT_PUBLIC_STRIPE_PREMIUM_MONTHLY_PRICE_ID: readRuntimeEnv(
        "NEXT_PUBLIC_STRIPE_PREMIUM_MONTHLY_PRICE_ID",
    ),
    NEXT_PUBLIC_STRIPE_PREMIUM_YEARLY_PRICE_ID: readRuntimeEnv(
        "NEXT_PUBLIC_STRIPE_PREMIUM_YEARLY_PRICE_ID",
    ),
    NEXT_PUBLIC_ONLINE_SERVICES_API_URL: readRuntimeEnv(
        "NEXT_PUBLIC_ONLINE_SERVICES_API_URL",
    ),
    NEXT_PUBLIC_BACKUP_STORAGE_ORIGIN: readRuntimeEnv(
        "NEXT_PUBLIC_BACKUP_STORAGE_ORIGIN",
    ),
    NEXT_PUBLIC_CLOUD_ENABLED: readRuntimeEnv("NEXT_PUBLIC_CLOUD_ENABLED"),
});

const readBrowserEnv = () => {
    const runtimeConfig = (
        globalThis as typeof globalThis & {
            __CRYPTEX_RUNTIME_CONFIG__?: unknown;
        }
    ).__CRYPTEX_RUNTIME_CONFIG__;
    if (runtimeConfig !== undefined) return runtimeConfig;
    if (process.env.NODE_ENV === "test") {
        return { NEXT_PUBLIC_CLOUD_ENABLED: false };
    }
    throw new Error("Runtime configuration is missing from the page");
};

const result = publicEnvSchema.safeParse(
    typeof window === "undefined" ? readServerEnv() : readBrowserEnv(),
);

if (!result.success) {
    const details = result.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("\n");
    throw new Error(`Invalid public environment variables:\n${details}`);
}

export const env = result.data;
