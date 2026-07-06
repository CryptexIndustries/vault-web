import { z } from "zod";

import { protectedProcedure } from "../../trpc";


export const userRouterGenerateRecoveryToken = protectedProcedure
    .output(
        z.object({
            /** Account id (required when calling `auth.recover`). */
            userId: z.string(),
            token: z.string(),
        }),
    )
    .mutation(() => {
        throw new Error("api-contract stub");
    })
;
export const userRouterClearRecoveryToken = protectedProcedure
    .output(z.boolean())
    .mutation(() => {
        throw new Error("api-contract stub");
    })
;
export const userRouterConfiguration = protectedProcedure
    .output(
        z.object({
            deviceId: z.string(),
            root: z.boolean(),
            canLink: z.boolean(),
            maxLinks: z.number(),
            canPromoteDevices: z.boolean(),
            alwaysConnected: z.boolean(),
            canFeatureVote: z.boolean(),
            recoveryTokenCreatedAt: z.date().nullable(),
        }),
    )
    .query(() => {
        throw new Error("api-contract stub");
    })
;
export const userRouterDelete = protectedProcedure
    .output(z.boolean())
    .mutation(() => {
        throw new Error("api-contract stub");
    })
;
