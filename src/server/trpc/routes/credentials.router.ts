// import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";
import * as trpc from "@trpc/server";
import { randomUUID, createHash } from "crypto";

import { z } from "zod";

import { Redis } from "@upstash/redis";

import * as bip39 from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";

import { env } from "../../../env/server.mjs";
import validateCaptcha, { trpcCaptchaError } from "../../../utils/captcha";
import {
    checkAuthRatelimit,
    checkRatelimitRegisterUser,
    checkRatelimitUserRecovery,
    checkRatelimitUserRecoveryCreate,
    checkRatelimitUserVerification,
    trpcRatelimitError,
} from "../../common/ratelimiting";
import {
    confirmVerificationToken,
    issueNewVerificationToken,
    updateUserIdentityConfirmationExpiery,
    verificationTemplate,
} from "../../common/identity-confirmation";
import { protectedProcedure, publicProcedure } from "../trpc";
import { sendVerificationEmail } from "../../common/email";

const redis = Redis.fromEnv();

export const credentialsRouterGenerateAuthNonce = publicProcedure
    .output(z.string())
    .query(async ({ ctx }) => {
        if (!checkAuthRatelimit(ctx.userIP)) {
            throw trpcRatelimitError;
        }

        // Use the crypto module to generate a nonce
        const nonce = randomUUID();

        try {
            // Save the nonce to the upstash redis cache
            const isProd = env.NODE_ENV === "production";
            if (isProd)
                await redis.set(`auth-nonce-${nonce}`, "true", {
                    // Set the nonce to expire after 1 minute
                    ex: 60,
                });
        } catch (e) {
            // If the nonce failed to save, log the error
            // This is not a critical error, so we don't throw an error
            // We just log the error and return the nonce
            console.error(
                "[TRPC - credentials.generateAuthNonce] Failed to save nonce to redis.",
                e
            );
        }

        return nonce;
    });

export const credentialsRouterRegisterUser = publicProcedure
    .input(
        z.object({
            email: z.string().email(),
            publicKey: z.string().max(256, "Invalid public key"),
            captchaToken: z.string(),
        })
    )
    .output(z.string())
    .mutation(async ({ ctx, input }) => {
        if (!checkRatelimitRegisterUser(ctx.userIP)) {
            throw trpcRatelimitError;
        }

        // Send a request to the Captcha API to verify the user's response
        const verification = await validateCaptcha(input.captchaToken);

        // If the user's response was invalid, return an error
        if (!verification.success) {
            throw trpcCaptchaError;
        }

        // Check if the user already exists (by email)
        const existingUser = await ctx.prisma.user.findFirst({
            where: {
                email: input.email,
            },
            select: {
                id: true,
            },
        });

        // If the email is not unique, throw an error
        if (existingUser) {
            throw new trpc.TRPCError({
                code: "BAD_REQUEST",
                message: "The specified email is already registered",
            });
        }

        let userId: string;
        let accountId: string;
        try {
            // Create a new user
            const user = await ctx.prisma.user.create({
                data: {
                    email: input.email,
                    name: input.email.split("@")[0],
                },
            });

            // Create an account for this user
            const account = await ctx.prisma.account.create({
                data: {
                    userId: user.id,
                    type: "credentials",
                    provider: "cryptex-key-based",
                    providerAccountId: randomUUID(),
                    public_key: input.publicKey,
                    root: true, // We set this to true because this is the user's first account
                },
            });

            userId = user.id;
            accountId = account.providerAccountId;
        } catch (e) {
            console.error(
                "[TRPC - credentials.register-user] Failed to register user.",
                e
            );
            throw new trpc.TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: "Something went wrong",
            });
        }

        await updateUserIdentityConfirmationExpiery(ctx.prisma, userId);

        try {
            // Create a new confirmation link
            const link = await issueNewVerificationToken(ctx.prisma, userId);

            //  Send the confirmation email
            await sendVerificationEmail(
                input.email,
                verificationTemplate(link)
            );
        } catch (e) {
            console.error(
                "[TRPC - credentials.register-user] Failed to send verification email.",
                e
            );
        }
        return accountId;
    });

export const credentialsRouterConfirm = publicProcedure
    .input(
        z.object({
            captchaToken: z.string().nonempty(),
            token: z.string(),
        })
    )
    .mutation(async ({ ctx, input }) => {
        if (!checkRatelimitUserVerification(ctx.userIP)) {
            throw trpcRatelimitError;
        }

        // Send a request to the Captcha API to verify the user's response
        const verification = await validateCaptcha(input.captchaToken);

        // If the user's response was invalid, return an error
        if (!verification.success) {
            throw trpcCaptchaError;
        }

        // Check if the token that the user provided is valid
        const isTokenValid = await confirmVerificationToken(
            ctx.prisma,
            input.token
        );

        // If the token is invalid, throw an error
        if (!isTokenValid) {
            throw new trpc.TRPCError({
                code: "BAD_REQUEST",
                message: "Invalid token",
            });
        }
    });

export const credentialsRouterResendVerificationEmail =
    protectedProcedure.mutation(async ({ ctx }) => {
        if (!checkRatelimitUserVerification(ctx.userIP)) {
            throw trpcRatelimitError;
        }

        // Check if the user is already verified
        const user = await ctx.prisma.user.findUnique({
            where: {
                id: ctx.session.user.id,
            },
            select: {
                email: true,
                email_verified_at: true,
            },
        });

        // If the user is already verified, throw an error
        if (!user || user?.email_verified_at) {
            throw new trpc.TRPCError({
                code: "BAD_REQUEST",
                message: "User is already verified",
            });
        }

        // Create a new confirmation link
        const link = await issueNewVerificationToken(
            ctx.prisma,
            ctx.session.user.id
        );

        //  Send the confirmation email
        await sendVerificationEmail(user.email, verificationTemplate(link));
    });

export const credentialsRecover = publicProcedure
    .input(
        z.object({
            userId: z.string().max(100, "Invalid user ID"),
            recoveryPhraseHash: z
                .string()
                .length(64, "Invalid recovery phrase"),
            publicKey: z.string().max(256, "Invalid public key"),
            captchaToken: z.string(),
        })
    )
    .output(z.string())
    .mutation(async ({ ctx, input }) => {
        if (!checkRatelimitUserRecovery(ctx.userIP)) {
            throw trpcRatelimitError;
        }

        // Send a request to the Captcha API to verify the user's response
        const verification = await validateCaptcha(input.captchaToken);

        // If the user's response was invalid, return an error
        if (!verification.success) {
            throw trpcCaptchaError;
        }

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

        // Check if the recovery phrase matches
        // Make the error intentionally vague to prevent brute force attacks
        if (existingUser.recovery_token !== input.recoveryPhraseHash) {
            throw new trpc.TRPCError({
                code: "BAD_REQUEST",
                message: "Invalid request",
            });
        }

        // Remove all existing accounts for this user
        await ctx.prisma.account.deleteMany({
            where: {
                userId: input.userId,
            },
        });

        // Create a new account for this user
        const newAccount = await ctx.prisma.account.create({
            data: {
                userId: input.userId,
                type: "credentials",
                provider: "cryptex-key-based",
                providerAccountId: randomUUID(),
                public_key: input.publicKey,
                root: true, // We set this to true because this is the user's first account
            },
        });

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

        return newAccount.providerAccountId;
    });

export const credentialsRouterGenerateRecoveryToken = protectedProcedure
    .output(z.object({ userId: z.string(), token: z.string() }))
    .mutation(async ({ ctx }) => {
        if (!checkRatelimitUserRecoveryCreate(ctx.userIP)) {
            throw trpcRatelimitError;
        }

        // Only the root device can generate recovery tokens
        if (!ctx.session.user.isRoot) {
            throw new trpc.TRPCError({
                code: "BAD_REQUEST",
                message:
                    "Only the root device can be used to generate recovery tokens.",
            });
        }

        // The recovery token can be created only if it isn't already created
        const recoveryTokenExists = await ctx.prisma.user.findFirst({
            where: {
                id: ctx.session.user.id,
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
        const token = bip39.generateMnemonic(wordlist, 256);

        // Hash the mnemonic
        const _hash = createHash("sha256");
        _hash.update(token);
        const hashedToken = _hash.digest("hex");

        // Create a recovery token for the user
        await ctx.prisma.user.update({
            where: {
                id: ctx.session.user.id,
            },
            data: {
                recovery_token: hashedToken,
                recovery_token_created_at: new Date(),
            },
        });

        return {
            userId: ctx.session.user.id,
            token,
        };
    });

export const credentialsRouterClearRecoveryToken = protectedProcedure
    .output(z.boolean())
    .mutation(async ({ ctx }) => {
        if (!checkRatelimitUserRecoveryCreate(ctx.userIP)) {
            throw trpcRatelimitError;
        }

        // Only the root device can clear recovery tokens
        if (!ctx.session.user.isRoot) {
            throw new trpc.TRPCError({
                code: "BAD_REQUEST",
                message:
                    "Only the root device can be used to clear recovery tokens.",
            });
        }

        // The recovery token can be cleared only if it exists
        const existingRecoveryToken = await ctx.prisma.user.findFirst({
            where: {
                id: ctx.session.user.id,
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
                id: ctx.session.user.id,
            },
            data: {
                recovery_token: null,
                recovery_token_created_at: null,
            },
        });

        return true;
    });
