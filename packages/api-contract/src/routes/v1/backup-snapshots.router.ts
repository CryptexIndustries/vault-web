import { protectedProcedure } from "../../trpc";
import { z } from "zod";

export const backupRouterCreateUpload = protectedProcedure
    .input(
        z.object({
            byteLength: z.number().int().positive(),
            checksumSha256: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
            idempotencyKey: z.string().min(16).max(64),
        }),
    )
    .output(
        z.object({
            snapshotId: z.string(),
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

export const backupRouterCompleteUpload = protectedProcedure
    .input(z.object({ snapshotId: z.string().min(1).max(64) }))
    .output(
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
    )
    .mutation(() => {
        throw new Error("api-contract stub");
    });

export const backupRouterList = protectedProcedure
    .input(z.object({ cursor: z.string().optional() }).optional())
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
    .query(() => {
        throw new Error("api-contract stub");
    });

export const backupRouterCreateDownload = protectedProcedure
    .input(z.object({ snapshotId: z.string() }))
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
    .query(() => {
        throw new Error("api-contract stub");
    });

export const backupRouterDelete = protectedProcedure
    .input(z.object({ snapshotId: z.string() }))
    .output(z.boolean())
    .mutation(() => {
        throw new Error("api-contract stub");
    });

export const backupRouterDeleteAll = protectedProcedure
    .output(z.boolean())
    .mutation(() => {
        throw new Error("api-contract stub");
    });
