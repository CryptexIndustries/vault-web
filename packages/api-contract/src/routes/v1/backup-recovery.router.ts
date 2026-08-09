import { publicProcedure } from "../../trpc";
import { z } from "zod";

export const backupRouterCreateRecoverySession = publicProcedure
    .input(
        z
            .object({
                sessionToken: z.string().min(32).max(128),
            })
            .extend({
                userId: z.string().min(1).max(128),
                recoveryPhrase: z.string().min(1).max(512),
                captchaToken: z.string(),
            }),
    )
    .output(z.object({ expiresAt: z.date() }))
    .mutation(() => {
        throw new Error("api-contract stub");
    });

export const backupRouterRecoveryList = publicProcedure
    .input(
        z
            .object({
                sessionToken: z.string().min(32).max(128),
            })
            .extend({ cursor: z.string().optional() }),
    )
    .output(
        z.object({
            items: z.array(
                z.object({
                    id: z.string(),
                    createdAt: z.date(),
                    readyAt: z.date().nullable(),
                    byteLength: z.number().int(),
                    checksumSha256: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
                    sourceLabel: z.enum([
                        "Root device",
                        "Linked device",
                        "Removed device",
                    ]),
                }),
            ),
            nextCursor: z.string().nullable(),
        }),
    )
    .mutation(() => {
        throw new Error("api-contract stub");
    });

export const backupRouterRecoveryDownload = publicProcedure
    .input(
        z
            .object({
                sessionToken: z.string().min(32).max(128),
            })
            .extend({ snapshotId: z.string() }),
    )
    .output(
        z.object({
            snapshot: z.object({
                id: z.string(),
                createdAt: z.date(),
                readyAt: z.date().nullable(),
                byteLength: z.number().int(),
                checksumSha256: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
                sourceLabel: z.enum([
                    "Root device",
                    "Linked device",
                    "Removed device",
                ]),
            }),
            transfer: z.object({
                url: z.string().url(),
                expiresAt: z.date(),
                headers: z.record(z.string()),
            }),
        }),
    )
    .mutation(() => {
        throw new Error("api-contract stub");
    });
