import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import argon2 from "argon2";

import type { Context } from "./context";

const t = initTRPC.context<Context>().create({
    // Optional:
    transformer: superjson,
    // Optional:
    errorFormatter(opts) {
        const { shape } = opts;
        return {
            ...shape,
            data: {
                ...shape.data,
            },
        };
    },
});

/**
 * We recommend only exporting the functionality that we
 * use so we can enforce which base procedures should be used
 **/
export const router = t.router;
export const mergeRouters = t.mergeRouters;
export const publicProcedure = t.procedure;

const middleware = t.middleware;
const isAuthenticated = middleware(async ({ ctx, next }) => {
    // This contains the API key and the API Key ID
    // The API Key is the first 36 characters, and the API Key ID is the rest
    const apiKeyCompound = ctx.apiKey;

    // Check if the apiKey is proper UUIDv4
    if (
        !apiKeyCompound ||
        !apiKeyCompound.length ||
        apiKeyCompound.length < 36 ||
        apiKeyCompound.length > 100
    ) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
    }

    // Split the API key into the API Key ID and the API Key
    const apiKey = apiKeyCompound.slice(0, 36);
    const apiKeyID = apiKeyCompound.slice(36);

    // Try and find the API Key in the database
    // NOTE: This might be less efficient than using only one query to fetch the API Key and the user subscription
    //      However, this is more secure as it doesn't load the DB with potentially malicious queries.
    //      In case someone got a hold of the API Key ID and tried to brute force the API Key.
    //      This way, we only check if the API Key ID exists, and only then do we fetch the subscription and subscription configuration.
    const apiKeyExists = await ctx.prisma.aPIKey.findUnique({
        where: {
            id: apiKeyID,
        },
        select: {
            key: true,
            user_id: true,
            purpose: true,
            root: true,
        },
    });

    if (!apiKeyExists) {
        console.debug(`[TRPC - context] API Key ID ${apiKeyID} does not exist`);
        throw new TRPCError({ code: "UNAUTHORIZED" });
    }

    // Validate the API key using argon2
    const isSame = await argon2.verify(apiKeyExists.key, apiKey);

    if (!isSame) {
        console.debug(
            `[TRPC - context] API Key ID ${apiKeyID} mismatched with API Key ${apiKey}`,
        );
        throw new TRPCError({ code: "UNAUTHORIZED" });
    }

    const userId = apiKeyExists.user_id;

    // Do a DB lookup to check if the API key actually exists
    const userSubscription = await ctx.prisma.subscription.findUnique({
        where: {
            user_id: userId,
        },
        select: {
            configuration: true,
        },
    });

    // If the user doesn't have a subscription, return an error
    if (!userSubscription || !userSubscription.configuration) {
        console.warn(
            `[TRPC - context] User ${userId} has no subscription or configuration`,
        );
        throw new TRPCError({ code: "UNAUTHORIZED" });
    }

    return next({
        ctx: {
            ...ctx,
            // Infer that `apiKey` is non-nullable
            apiKeyID: apiKeyID,
            apiKey: apiKey,
            apiKeyHash: apiKeyExists.key,
            rootAPIKey: apiKeyExists.root,
            // Infers that `user` is non-nullable
            user: {
                id: userId,
                subscriptionConfig: userSubscription.configuration,
            },
        },
    });
});
export const protectedProcedure = publicProcedure.use(isAuthenticated);
