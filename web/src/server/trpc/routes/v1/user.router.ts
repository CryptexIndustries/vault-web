import * as bip39 from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import * as trpc from "@trpc/server";
import argon2 from "argon2";
import Stripe from "stripe";
import { z } from "zod";

import { protectedProcedure, publicProcedure } from "../../trpc";

import validateCaptcha from "../../../utils/captcha";
import { StripeConfiguration } from "../../../utils/stripe";
import { upsertUserSubscriptionTier } from "../../../utils/subscription";
import { insertDefaultAPIKey } from "../../../common/api-key-generation";
import { checkRatelimitter } from "../../../common/ratelimiting";

const stripe = new Stripe(
    process.env.STRIPE_SECRET_KEY ?? "",
    StripeConfiguration,
);

const userRecoveryArgon2Config: argon2.Options & { raw?: false } = {
    type: argon2.argon2id,
    parallelism: 4, // 4 threads (each thread has a memory pool of memoryCost bytes)
    memoryCost: 2 ** 16, // 64MiB
    timeCost: 3, // 3 iterations (3 passes over the memory)
    // salt: ..., // NOTE: We don't need to provide a salt, argon2 will generate a random salt
};

export const userRouterRegister = publicProcedure
    .input(
        z.object({
            captchaToken: z.string(),
        }),
    )
    .output(z.string())
    .mutation(async ({ ctx, input }) => {
        await checkRatelimitter(ctx.userIP, "USER_REGISTER", 1, "1m");

        await validateCaptcha(input.captchaToken);

        let apiKeyCompound: string;
        try {
            // Generate the user
            // And create the first API Key with which the user will authenticate their requests
            const user = await ctx.prisma.user.create({
                data: {},
            });

            apiKeyCompound = await insertDefaultAPIKey(ctx, user.id);

            await upsertUserSubscriptionTier(ctx.prisma, user.id);
        } catch (err) {
            console.error(`[TRPC - user.register] Error creating user: ${err}`);

            throw new trpc.TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: "Something went wrong. Please try again later.",
            });
        }

        // Return the API Key and the API Key ID in one string
        return apiKeyCompound;
    });

export const userRouterRecover = publicProcedure
    .input(
        z.object({
            userId: z.string().max(100, "Invalid user ID"),
            recoveryPhrase: z.string().max(256, "Invalid recovery phrase"),
            captchaToken: z.string(),
        }),
    )
    .output(z.string())
    .mutation(async ({ ctx, input }) => {
        await checkRatelimitter(ctx.userIP, "RECOVERY", 3, "30m");

        // Send a request to the Captcha API to verify the user's response
        await validateCaptcha(input.captchaToken);

        // Check if the user already exists (by email)
        const existingUser = await ctx.prisma.user.findFirst({
            where: {
                id: input.userId,
            },
            select: {
                id: true,
                recovery_token: true,
            },
        });

        // If the user or the recovery token doesn't exist, throw an error
        if (!existingUser || !existingUser.id || !existingUser.recovery_token) {
            throw new trpc.TRPCError({
                code: "BAD_REQUEST",
                message: "Invalid request",
            });
        }

        // Make the error intentionally vague
        const wrongRecoveryPhraseErr = new trpc.TRPCError({
            code: "BAD_REQUEST",
            message: "Invalid request",
        });

        // Check if the recovery phrase matches
        if (
            !(await argon2.verify(
                existingUser.recovery_token,
                input.recoveryPhrase,
            ))
        ) {
            throw wrongRecoveryPhraseErr;
        }

        // Remove all existing API keys for this user
        await ctx.prisma.aPIKey.deleteMany({
            where: {
                user_id: input.userId,
            },
        });

        // Create a new API key for the user
        const apiKeyCompound = await insertDefaultAPIKey(ctx, input.userId);

        // Clear the recovery token
        await ctx.prisma.user.update({
            where: {
                id: input.userId,
            },
            data: {
                recovery_token: null,
                recovery_token_created_at: null,
            },
        });

        return apiKeyCompound;
    });

export const userRouterGenerateRecoveryToken = protectedProcedure
    .output(z.object({ userId: z.string(), token: z.string() }))
    .mutation(async ({ ctx }) => {
        await checkRatelimitter(ctx.userIP, "RECOVERY_TOKEN_MUT", 3, "30m");

        // Only the root device can generate recovery tokens
        if (!ctx.rootAPIKey) {
            throw new trpc.TRPCError({
                code: "BAD_REQUEST",
                message:
                    "Only the root device can be used to generate recovery tokens.",
            });
        }

        // The recovery token can be created only if it isn't already created
        const recoveryTokenExists = await ctx.prisma.user.findFirst({
            where: {
                id: ctx.user.id,
                recovery_token: {
                    not: null,
                },
            },
            select: {
                recovery_token: true,
            },
        });

        if (recoveryTokenExists?.recovery_token) {
            throw new trpc.TRPCError({
                code: "BAD_REQUEST",
                message: "Recovery token already exists.",
            });
        }

        // Generate a 256-bit mnemonic
        const recoveryPhrase = bip39.generateMnemonic(wordlist, 256);

        let hashedToken: string;

        try {
            // Hash the mnemonic
            hashedToken = await argon2.hash(
                recoveryPhrase,
                userRecoveryArgon2Config,
            );
        } catch (err) {
            console.error(
                "[TRPC - user.generateRecoveryToken] Failed to hash the recovery token.",
                err,
            );

            throw new trpc.TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: "Failed to hash the recovery token",
            });
        }

        // Create a recovery token for the user
        await ctx.prisma.user.update({
            where: {
                id: ctx.user.id,
            },
            data: {
                recovery_token: hashedToken,
                recovery_token_created_at: new Date(),
            },
        });

        return {
            userId: ctx.user.id,
            token: recoveryPhrase,
        };
    });

export const userRouterClearRecoveryToken = protectedProcedure
    .output(z.boolean())
    .mutation(async ({ ctx }) => {
        await checkRatelimitter(ctx.userIP, "RECOVERY_TOKEN_MUT", 3, "30m");

        // Only the root device can clear recovery tokens
        if (!ctx.rootAPIKey) {
            throw new trpc.TRPCError({
                code: "BAD_REQUEST",
                message:
                    "Only the root device can be used to clear recovery tokens.",
            });
        }

        // The recovery token can be cleared only if it exists
        const existingRecoveryToken = await ctx.prisma.user.findFirst({
            where: {
                id: ctx.user.id,
                recovery_token: {
                    not: null,
                },
            },
            select: {
                recovery_token: true,
            },
        });

        if (!existingRecoveryToken?.recovery_token) {
            throw new trpc.TRPCError({
                code: "BAD_REQUEST",
                message: "Recovery token doesn't exist.",
            });
        }

        // Clear the recovery token
        await ctx.prisma.user.update({
            where: {
                id: ctx.user.id,
            },
            data: {
                recovery_token: null,
                recovery_token_created_at: null,
            },
        });

        return true;
    });

export const userRouterConfiguration = protectedProcedure
    .output(
        z.object({
            root: z.boolean(),
            canLink: z.boolean(),
            maxLinks: z.number(),
            canPromoteDevices: z.boolean(),
            alwaysConnected: z.boolean(),
            canFeatureVote: z.boolean(),
            recoveryTokenCreatedAt: z.date().nullable(),
        }),
    )
    .query(async ({ ctx }) => {
        await checkRatelimitter(ctx.userIP, "USER_CONFIGURATION", 3, "10s");

        const recoveryData = await ctx.prisma.user.findFirst({
            where: {
                id: ctx.user.id,
            },
            select: {
                recovery_token_created_at: true,
            },
        });

        return {
            root: ctx.rootAPIKey,
            canLink: ctx.user.subscriptionConfig.linking_allowed,
            maxLinks: ctx.user.subscriptionConfig.max_links,
            canPromoteDevices: ctx.user.subscriptionConfig.promoting_to_root,
            alwaysConnected: ctx.user.subscriptionConfig.always_connected,
            canFeatureVote: ctx.user.subscriptionConfig.feature_voting,
            recoveryTokenCreatedAt:
                recoveryData?.recovery_token_created_at ?? null,
        };
    });

export const userRouterDelete = protectedProcedure
    .output(z.boolean())
    .mutation(async ({ ctx }) => {
        await checkRatelimitter(ctx.userIP, "USER_DELETE", 1, "5m");

        // Only the root account can delete the user
        if (!ctx.rootAPIKey) {
            throw new trpc.TRPCError({
                code: "BAD_REQUEST",
                message: "Only the root device can delete the user.",
            });
        }

        const subscription = await ctx.prisma.user.delete({
            where: {
                id: ctx.user.id,
            },
            select: {
                subscription: true,
            },
        });

        if (subscription && subscription.subscription) {
            const id = subscription.subscription.customer_id;

            // Call the Stripe API to delete the customer only if the user had a subscription
            // The actual customer_id is set to the user's ID when they don't have a subscription
            // When they do have a subscription, the customer_id is set to the actual customer ID (payment processor's)
            if (id && id !== ctx.user.id) {
                try {
                    const res = await stripe.customers.del(id);
                    console.debug(
                        `[TRPC - user.delete] Deleted customer for user ID: ${ctx.user.id}}`,
                        res,
                    );
                } catch (e) {
                    // Ignore error, the customer might have been deleted already or the ID is invalid
                    console.debug(
                        `[TRPC - user.delete] Error deleting customer for user ID: ${ctx.user.id}}`,
                        e,
                    );
                }
            }
        }

        return true;
    });
