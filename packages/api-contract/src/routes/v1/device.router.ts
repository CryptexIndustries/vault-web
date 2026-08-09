import { z } from "zod";
import { protectedProcedure } from "../../trpc";

export const deviceRouterLink = protectedProcedure
    .input(
        z.object({
            publicKeyJWK: z.string().min(10).max(1024),
        }),
    )
    .output(
        z.object({
            deviceId: z.string(),
            syncId: z.string(),
        }),
    )
    .mutation(() => {
        throw new Error("api-contract stub");
    });

export const deviceRouterRemove = protectedProcedure
    .input(
        z.object({
            id: z.string().min(1).max(128),
        }),
    )
    .output(z.void())
    .mutation(() => {
        throw new Error("api-contract stub");
    });

export const deviceRouterBreakLink = protectedProcedure
    .input(
        z.object({
            syncId: z.string().min(1).max(128),
        }),
    )
    .output(z.void())
    .mutation(() => {
        throw new Error("api-contract stub");
    });

export const deviceRouterLinked = protectedProcedure
    .output(
        z.array(
            z.object({
                id: z.string(),
                createdAt: z.date(),
                root: z.boolean(),
            }),
        ),
    )
    .query(() => {
        throw new Error("api-contract stub");
    });

export const deviceRouterTopology = protectedProcedure
    .output(
        z.object({
            devices: z.array(
                z.object({
                    id: z.string(),
                    createdAt: z.date(),
                    lastSeen: z.date().nullable(),
                    root: z.boolean(),
                    current: z.boolean(),
                }),
            ),
            relationships: z.array(
                z.object({
                    syncId: z.string(),
                    fromDeviceId: z.string(),
                    toDeviceId: z.string(),
                    createdAt: z.date(),
                }),
            ),
        }),
    )
    .query(() => {
        throw new Error("api-contract stub");
    });

export const deviceRouterSetRoot = protectedProcedure
    .input(
        z.object({
            id: z.string().min(1).max(128),
            root: z.boolean(),
        }),
    )
    .output(z.void())
    .mutation(() => {
        throw new Error("api-contract stub");
    });

export const deviceRouterSignalingAuth = protectedProcedure
    .input(
        z.object({
            socket_id: z.string(),
            channel_name: z.string(),
        }),
    )
    .output(
        z.object({
            auth: z.string(),
            user_data: z.string(),
        }),
    )
    .mutation(() => {
        throw new Error("api-contract stub");
    });

export const deviceRouterSignalingAuthChannel = protectedProcedure
    .input(
        z.object({
            socket_id: z.string(),
            channel_name: z.string().min(1).max(128),
        }),
    )
    .output(
        z.object({
            auth: z.string(),
            channel_data: z.string().optional(),
            shared_secret: z.string().optional(),
        }),
    )
    .mutation(() => {
        throw new Error("api-contract stub");
    });

export const deviceRouterTurnCredentials = protectedProcedure
    .input(
        z.object({
            syncId: z.string().min(1).max(128),
        }),
    )
    .output(
        z.object({
            iceServers: z.array(
                z.object({
                    urls: z.string(),
                    username: z.string(),
                    credential: z.string(),
                }),
            ),
            expiresAt: z.number(),
        }),
    )
    .mutation(() => {
        throw new Error("api-contract stub");
    });
