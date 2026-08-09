import { protectedProcedure, publicProcedure } from "../../trpc";
import { z } from "zod";

export const authRouterRegister = publicProcedure
    .input(
        z.object({
            publicKeyJWK: z.string().min(10).max(1024),
            captchaToken: z.string(),
        }),
    )
    .output(z.object({ deviceId: z.string(), userId: z.string() }))
    .mutation(() => {
        throw new Error("api-contract stub");
    });

export const authRouterChallenge = publicProcedure
    .input(z.object({ deviceId: z.string().min(1).max(128) }))
    .output(
        z.object({
            challengeId: z.string(),
            challenge: z.string(),
            expiresAt: z.number(),
        }),
    )
    .mutation(() => {
        throw new Error("api-contract stub");
    });

export const authRouterVerify = publicProcedure
    .input(
        z.object({
            challengeId: z.string().min(1).max(64),
            signature: z.string().min(1).max(128),
            deviceId: z.string().min(1).max(128),
        }),
    )
    .output(
        z.object({
            sessionToken: z.string(),
            refreshToken: z.string(),
            expiresAt: z.number(),
            refreshExpiresAt: z.number(),
        }),
    )
    .mutation(() => {
        throw new Error("api-contract stub");
    });

export const authRouterRefresh = publicProcedure
    .input(z.object({ refreshToken: z.string().min(1).max(256) }))
    .output(
        z.object({
            sessionToken: z.string(),
            refreshToken: z.string(),
            expiresAt: z.number(),
            refreshExpiresAt: z.number(),
        }),
    )
    .mutation(() => {
        throw new Error("api-contract stub");
    });

export const authRouterLogout = protectedProcedure
    .input(
        z.object({
            refreshToken: z.string().min(1).max(256).optional(),
        }),
    )
    .output(z.object({ success: z.literal(true) }))
    .mutation(() => {
        throw new Error("api-contract stub");
    });

export const authRouterRecover = publicProcedure
    .input(
        z.object({
            userId: z.string().min(1).max(128),
            recoveryPhrase: z.string().min(1).max(512),
            newPublicKeyJWK: z.string().min(10).max(1024),
            captchaToken: z.string(),
        }),
    )
    .output(z.object({ success: z.literal(true), deviceId: z.string() }))
    .mutation(() => {
        throw new Error("api-contract stub");
    });
