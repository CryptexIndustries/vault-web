import { protectedProcedure } from "../../trpc";
import { z } from "zod";

export const backupRouterStatus = protectedProcedure
    .output(
        z.object({
            enabled: z.boolean(),
            entitled: z.boolean(),
            graceExpiresAt: z.date().nullable(),
            recoveryConfigured: z.boolean(),
            accountRecoveryProtection: z.enum([
                "none",
                "pending",
                "protected",
                "degraded",
            ]),
            latestReadyAt: z.date().nullable(),
            versionCount: z.number().int(),
            storageBytes: z.number().int(),
            maxSnapshotBytes: z.number().int(),
            maxAccountBytes: z.number().int(),
            storageConfigured: z.boolean(),
        }),
    )
    .query(() => {
        throw new Error("api-contract stub");
    });

export const backupRouterEnable = protectedProcedure
    .output(z.object({ enabled: z.literal(true) }))
    .mutation(() => {
        throw new Error("api-contract stub");
    });

export const backupRouterDisable = protectedProcedure
    .output(z.object({ enabled: z.literal(false) }))
    .mutation(() => {
        throw new Error("api-contract stub");
    });
