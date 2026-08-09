import { protectedProcedure } from "../../trpc";
import { z } from "zod";

export const userRouterGenerateRecoveryToken = protectedProcedure
    .output(
        z.object({
            userId: z.string(),
            token: z.string(),
        }),
    )
    .mutation(() => {
        throw new Error("api-contract stub");
    });

export const userRouterRotateRecoveryToken = protectedProcedure
    .output(
        z.object({
            userId: z.string(),
            token: z.string(),
        }),
    )
    .mutation(() => {
        throw new Error("api-contract stub");
    });

export const userRouterConfiguration = protectedProcedure
    .output(
        z.object({
            deviceId: z.string(),
            root: z.boolean(),
            canLink: z.boolean(),
            maxLinks: z.number(),
            canPromoteDevices: z.boolean(),
            managedEncryptedBackups: z.boolean(),
            passwordSharing: z.boolean(),
            securityReportBasic: z.boolean(),
            securityReportAdvanced: z.boolean(),
            recoveryTokenCreatedAt: z.date().nullable(),
            recoveryGenerationNeeded: z.boolean(),
        }),
    )
    .query(() => {
        throw new Error("api-contract stub");
    });

export const userRouterDeleteChallenge = protectedProcedure
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

export const userRouterDelete = protectedProcedure
    .input(
        z.object({
            challengeId: z.string().min(1).max(64),
            signature: z.string().min(1).max(128),
        }),
    )
    .output(z.boolean())
    .mutation(() => {
        throw new Error("api-contract stub");
    });
