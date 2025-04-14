import * as trpc from "@trpc/server";
import { z } from "zod";
import { protectedProcedure } from "../../trpc";
import Pusher from "pusher";
import { env } from "../../../../env/client.mjs";
import { env as serverEnv } from "../../../../env/server.mjs";
import {
    APIKeyPurpose,
    insertDefaultAPIKey,
} from "../../../common/api-key-generation";
import { checkRatelimitter } from "../../../common/ratelimiting";

export const deviceRouterLink = protectedProcedure
    // .input(z.object({ purpose: z.nativeEnum(APIKeyPurpose) }))
    .input(
        z.object({
            root: z.boolean(),
        }),
    )
    .output(z.string())
    .mutation(async ({ ctx }) => {
        await checkRatelimitter(ctx.apiKeyHash, "DEVICE_LINK", 2, "1m");

        if (!ctx.rootAPIKey) {
            throw new trpc.TRPCError({
                code: "BAD_REQUEST",
                message:
                    "Only the root device can be used to link to other devices.",
            });
        }

        // Check if the user can link devices
        if (!ctx.user.subscriptionConfig.linking_allowed) {
            throw new trpc.TRPCError({
                code: "BAD_REQUEST",
                message: "Linking devices is not allowed.",
            });
        }

        // Check if the user has reached the maximum number of linked devices
        const linkedDevices =
            (await ctx.prisma.aPIKey.count({
                where: {
                    user_id: ctx.user.id,
                },
            })) - 1;

        // Check the maximum number of links the user can have
        // If the user's linked device count is greater than or equal to the maximum number of links, return an error
        if (
            ctx.user.subscriptionConfig.max_links <= 0 ||
            linkedDevices >= ctx.user.subscriptionConfig.max_links
        ) {
            throw new trpc.TRPCError({
                code: "BAD_REQUEST",
                message:
                    "Maximum number of linked devices reached. Upgrade your subscription or unlink an existing device.",
            });
        }

        // Create a new API Key for the user
        const apiKeyCompound = await insertDefaultAPIKey(
            ctx,
            ctx.user.id,
            false,
        );

        return apiKeyCompound;
    });

export const deviceRouterRemove = protectedProcedure
    .input(
        z.object({
            id: z.string(),
        }),
    )
    .output(z.boolean())
    .mutation(async ({ ctx, input }) => {
        await checkRatelimitter(ctx.apiKeyHash, "DEVICE_REMOVE", 3, "5s");

        if (!ctx.rootAPIKey) {
            throw new trpc.TRPCError({
                code: "BAD_REQUEST",
                message:
                    "Only the root device can be used to remove linked devices.",
            });
        }

        // Check if the account (device) the user is trying to unlink isn't the last one
        const linkedDevices = await ctx.prisma.aPIKey.count({
            where: {
                user_id: ctx.user.id,
            },
        });

        if (linkedDevices <= 1) {
            throw new trpc.TRPCError({
                code: "BAD_REQUEST",
                message: "Cannot remove the only linked device.",
            });
        }

        try {
            await ctx.prisma.aPIKey.delete({
                where: {
                    id: input.id,
                },
            });
        } catch (error) {
            // Failed to delete the device
            return false;
        }

        return true;
    });

export const deviceRouterLinked = protectedProcedure
    .output(
        z.array(
            z.object({
                id: z.string(),
                createdAt: z.date(),
                purpose: z.nativeEnum(APIKeyPurpose),
                root: z.boolean(),
            }),
        ),
    )
    .query(async ({ ctx }) => {
        await checkRatelimitter(ctx.apiKeyHash, "DEVICE_GET_LINKED", 3, "1s");

        if (!ctx.rootAPIKey) {
            throw new trpc.TRPCError({
                code: "BAD_REQUEST",
                message:
                    "Only the root device can be used to view linked devices.",
            });
        }

        const apiKeys = await ctx.prisma.aPIKey.findMany({
            where: {
                user_id: ctx.user.id,
            },
        });

        return [
            ...apiKeys.map((apiKey) => ({
                id: apiKey.id,
                createdAt: apiKey.created_at,
                purpose: apiKey.purpose as APIKeyPurpose,
                root: apiKey.root,
            })),
        ];
    });

export const deviceRouterSetRoot = protectedProcedure
    .input(
        z.object({
            id: z.string(),
            root: z.boolean(),
        }),
    )
    .mutation(async ({ ctx, input }) => {
        // If the user can promote to Root, they can demote from Root
        await checkRatelimitter(ctx.apiKeyHash, "DEVICE_SET_ROOT", 20, "1m");

        if (!ctx.user.subscriptionConfig.promoting_to_root) {
            throw new trpc.TRPCError({
                code: "UNAUTHORIZED",
                message: "You are not allowed to pro/demote devices to root.",
            });
        }

        // Check if the user is trying to demote the last Root device
        const rootDevices = await ctx.prisma.aPIKey.count({
            where: {
                user_id: ctx.user.id,
                root: true,
            },
        });

        if (rootDevices <= 1 && !input.root) {
            throw new trpc.TRPCError({
                code: "BAD_REQUEST",
                message: "Cannot demote the only Root device.",
            });
        }

        // Update the device's root status
        // NOTE: By using the user_id, we're making sure the user can only update their own devices
        await ctx.prisma.aPIKey.update({
            where: {
                id: input.id,
                user_id: ctx.user.id,
            },
            data: {
                root: input.root,
            },
        });
    });

//#region Pusher
const pusher = new Pusher({
    appId: env.NEXT_PUBLIC_PUSHER_APP_ID,
    key: env.NEXT_PUBLIC_PUSHER_APP_KEY,
    secret: serverEnv.PUSHER_APP_SECRET,
    useTLS: env.NEXT_PUBLIC_PUSHER_APP_TLS,
    host: env.NEXT_PUBLIC_PUSHER_APP_HOST,
    port: env.NEXT_PUBLIC_PUSHER_APP_PORT,
    // encryptionMasterKeyBase64: ENCRYPTION_MASTER_KEY, // a base64 string which encodes 32 bytes, used to derive the per-channel encryption keys (see below!)
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
    .mutation(async ({ ctx, input }) => {
        await checkRatelimitter(
            ctx.apiKeyHash,
            "PUSHER_SIGNALING_AUTH",
            5,
            "30s",
        );

        // If the user doesn't have a subscription, return an error
        if (!ctx.user.subscriptionConfig.linking_allowed) {
            throw new trpc.TRPCError({
                code: "UNAUTHORIZED",
                message: "Unauthorized",
            });
        }

        // Get the socket id and channel name from the request body
        // const { socket_id, channel_name } = req.body;

        console.warn("PUSHER AUTH-----", input.socket_id, input.channel_name);

        // Create the presence data
        const userData = {
            // user_id: session.user.id,
            // user_info: {
            id: ctx.user.id,
            // name: session.user.name,
            // email: session.user.email,
            // },
        };

        // Authenticate the request
        const auth = pusher.authenticateUser(input.socket_id, userData);

        return auth;
    });

export const deviceRouterSignalingAuthChannel = protectedProcedure
    .input(
        z.object({
            socket_id: z.string(),
            channel_name: z.string(),
        }),
    )
    .output(
        z.object({
            auth: z.string(),
            channel_data: z.string().optional(),
            shared_secret: z.string().optional(),
        }),
    )
    .query(async ({ ctx, input }) => {
        await checkRatelimitter(
            ctx.apiKeyHash,
            "PUSHER_SIGNALING_AUTH_CHANNEL",
            5,
            "30s",
        );

        // Check if the user has a subscription that allows them to use the vault linking
        // If the user doesn't have a subscription, return an error
        if (!ctx.user.subscriptionConfig.linking_allowed) {
            throw new trpc.TRPCError({
                code: "UNAUTHORIZED",
                message: "Unauthorized",
            });
        }

        // Get the socket id and channel name from the request body
        // const { socket_id, channel_name } = req.body;

        // console.warn("SESSION-----", session);
        // console.warn("PUSHER AUTH-----", socket_id, channel_name);
        // console.warn("PUSHER AUTH-----", req.body);

        // The prefix should be "presence-" or "private-"
        // The label after that should be "link" or "sync"
        if (
            !input.channel_name.startsWith("presence-link") &&
            !input.channel_name.startsWith("presence-sync") &&
            !input.channel_name.startsWith("private-link") &&
            !input.channel_name.startsWith("private-sync")
        ) {
            throw new trpc.TRPCError({
                code: "UNAUTHORIZED",
                message: "Unauthorized",
            });
        }

        if (
            input.channel_name.startsWith("presence-sync") ||
            input.channel_name.startsWith("private-sync")
        ) {
            // This is an example of a channel name: presence-sync-{senior_deviceID}_{junior_deviceID}
            const extractedDeviceIDs: string[] = input.channel_name
                .split("-")
                .slice(2)
                .join("-")
                .split("_");

            // Check if there are two device IDs (senior and junior) - valid channel name
            if (extractedDeviceIDs.length !== 2) {
                throw new trpc.TRPCError({
                    code: "UNAUTHORIZED",
                    message: "Unauthorized",
                });
            }

            // Check if any of these device IDs belong to the current device
            const belongsToThisDevice = await ctx.prisma.aPIKey.count({
                where: {
                    id: {
                        in: extractedDeviceIDs,
                    },
                    user_id: ctx.user.id,
                    key: ctx.apiKeyHash, // NOTE: This is here to make sure we look for the device this request is coming from
                },
            });

            // If none of the devices belong to the user, return an error
            if (belongsToThisDevice === 0) {
                console.error(
                    "[PUSHER] None of the devices belong to the user",
                    ctx.user.id,
                    extractedDeviceIDs,
                );

                throw new trpc.TRPCError({
                    code: "UNAUTHORIZED",
                    message: "Unauthorized",
                });
            }

            // Check if the rest of the devices belong to the user
            const accounts = await ctx.prisma.aPIKey.findMany({
                where: {
                    user_id: ctx.user.id,
                    id: {
                        in: extractedDeviceIDs,
                    },
                },
            });

            // Both accounts should be found, otherwise return unauthorized
            if (accounts.length !== 2) {
                throw new trpc.TRPCError({
                    code: "UNAUTHORIZED",
                    message: "Unauthorized",
                });
            }
        } else {
            // Regulate linking channels

            // Remove the prefix that can be two words
            const channelNameWithoutPrefix = input.channel_name
                .split("-")
                .slice(2)
                .join("-");

            // Check if there is a UserID for that user in the Account table
            const account = await ctx.prisma.aPIKey.count({
                where: {
                    user_id: ctx.user.id,
                    id: channelNameWithoutPrefix,
                },
            });

            // If there is no account, return an error
            if (!account) {
                throw new trpc.TRPCError({
                    code: "UNAUTHORIZED",
                    message: "Unauthorized",
                });
            }
        }

        // Create the presence data
        const userData = {
            user_id: ctx.apiKeyID,
            user_info: {
                id: ctx.apiKeyID,
                // name: session.user.name,
                // email: session.user.email,
            },
        };

        // Authenticate the request
        const auth = pusher.authorizeChannel(
            input.socket_id,
            input.channel_name,
            userData,
        );

        // Send the response
        return auth;
    });
//#endregion Pusher
