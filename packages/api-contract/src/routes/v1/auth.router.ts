import { z } from "zod";

import { publicProcedure } from "../../trpc";

const deviceIdSchema = z.string().min(1).max(128);
const sessionTokenSchema = z.string().min(1).max(4096);

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
    })
;
export const authRouterChallenge = publicProcedure
    .input(z.object({ deviceId: deviceIdSchema }))
    .output(
        z.object({
            challengeId: z.string(),
            challenge: z.string(),
            expiresAt: z.number(),
        }),
    )
    .mutation(() => {
        throw new Error("api-contract stub");
    })
;
/** Server challenge ids are 32 hex chars; allow slack for format changes. */
const authVerifyChallengeIdSchema = z.string().min(1).max(64);
/** P-256 IEEE P1363 signature as base64url (typically well under this cap). */
const authVerifySignatureSchema = z.string().min(1).max(128);

export const authRouterVerify = publicProcedure
    .input(
        z.object({
            challengeId: authVerifyChallengeIdSchema,
            signature: authVerifySignatureSchema,
            deviceId: deviceIdSchema,
        }),
    )
    .output(
        z.object({
            sessionToken: z.string(),
            expiresAt: z.number(),
        }),
    )
    .mutation(() => {
        throw new Error("api-contract stub");
    })
;
export const authRouterRefresh = publicProcedure
    .input(z.object({ sessionToken: sessionTokenSchema }))
    .output(
        z.object({
            sessionToken: z.string(),
            expiresAt: z.number(),
        }),
    )
    .mutation(() => {
        throw new Error("api-contract stub");
    })
;
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
    })
;
