import { z } from "zod";
import * as trpc from "@trpc/server";

import Stripe from "stripe";

import { randomUUID } from "crypto";

import { StripeConfiguration } from "../../../utils/stripe";
import {
    checkRatelimitAccountRouter,
    trpcRatelimitError,
} from "../../common/ratelimiting";
import { protectedProcedure } from "../trpc";

const stripe = new Stripe(
    process.env.STRIPE_SECRET_KEY ?? "",
    StripeConfiguration
);

export const accountRouterGetLinkingConfiguration = protectedProcedure
    .output(
        z.object({
            can_link: z.boolean(),
            max_links: z.number(),
            always_connected: z.boolean(),
        })
    )
    .query(async ({ ctx }) => {
        if (!checkRatelimitAccountRouter(ctx.userIP, false)) {
            throw trpcRatelimitError;
        }

        const user = await ctx.prisma.user.findFirst({
            where: {
                id: ctx.session?.user.id,
            },
            select: {
                subscription: {
                    select: {
                        configuration: {
                            select: {
                                linking_allowed: true,
                                max_links: true,
                                always_connected: true,
                            },
                        },
                    },
                },
            },
        });

        if (user == null) {
            throw new trpc.TRPCError({
                code: "BAD_REQUEST",
                message: "User not found.",
            });
        }

        if (
            user.subscription == null ||
            user.subscription.length === 0 ||
            user.subscription[0] == null ||
            user.subscription[0].configuration == null
        ) {
            console.warn(
                `[TRPC - account.getLinkingConfiguration] User ID: ${ctx.session.user.id} has no subscription`
            );
            throw new trpc.TRPCError({
                code: "BAD_REQUEST",
                message: "Something went wrong.",
            });
        }

        const subscriptionConfig = user.subscription[0].configuration;

        return {
            can_link: subscriptionConfig.linking_allowed,
            max_links: subscriptionConfig.max_links,
            always_connected: subscriptionConfig.always_connected,
        };
    });

export const accountRouterLinkDevice = protectedProcedure
    .input(
        z.object({
            publicKey: z.string().max(256, "Invalid public key"),
        })
    )
    .output(z.string())
    .mutation(async ({ ctx, input }) => {
        if (!checkRatelimitAccountRouter(ctx.userIP, true)) {
            throw trpcRatelimitError;
        }

        if (!ctx.session.user.isRoot) {
            throw new trpc.TRPCError({
                code: "BAD_REQUEST",
                message: "Only the root device can be used to link devices.",
            });
        }

        // Get the user and check whether they can link devices and how many devices they can link
        const user = await ctx.prisma.user.findFirst({
            where: {
                id: ctx.session?.user.id,
            },
            select: {
                subscription: {
                    select: {
                        configuration: {
                            select: {
                                linking_allowed: true,
                                max_links: true,
                            },
                        },
                    },
                },
            },
        });

        if (user == null) {
            throw new trpc.TRPCError({
                code: "BAD_REQUEST",
                message: "User not found.",
            });
        }

        if (
            user.subscription == null ||
            user.subscription.length === 0 ||
            user.subscription[0] == null ||
            user.subscription[0].configuration == null
        ) {
            console.warn(
                `[TRPC - account.linkDevice] User ID: ${ctx.session.user.id} has no subscription`
            );
            throw new trpc.TRPCError({
                code: "BAD_REQUEST",
                message: "Something went wrong.",
            });
        }

        const subscriptionConfig = user.subscription[0].configuration;

        // Check if the user can link devices
        if (!subscriptionConfig.linking_allowed) {
            throw new trpc.TRPCError({
                code: "BAD_REQUEST",
                message: "Linking devices is not allowed.",
            });
        }

        // Check if the user has reached the maximum number of linked devices
        const linkedDevices = await ctx.prisma.account.count({
            where: {
                userId: ctx.session.user.id,
            },
        });

        if (linkedDevices >= subscriptionConfig.max_links) {
            throw new trpc.TRPCError({
                code: "BAD_REQUEST",
                message:
                    "Maximum number of linked devices reached. Upgrade your subscription or unlink an existing device.",
            });
        }

        try {
            // Create an account for this user
            const account = await ctx.prisma.account.create({
                data: {
                    userId: ctx.session.user.id,
                    provider: "cryptex-key-based",
                    type: "credentials",
                    providerAccountId: randomUUID(),
                    public_key: input.publicKey,
                },
            });

            return account.providerAccountId;
        } catch (e) {
            console.error(
                `[TRPC - account.linkDevice] Failed to register user for user ID: ${ctx.session.user.id}.`,
                e
            );
            throw new trpc.TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: "Something went wrong",
            });
        }
    });

export const accountRouterRemoveDevice = protectedProcedure
    .input(
        z.object({
            deviceId: z.string(),
        })
    )
    .output(z.boolean())
    .mutation(async ({ ctx, input }) => {
        if (!checkRatelimitAccountRouter(ctx.userIP, true)) {
            throw trpcRatelimitError;
        }

        if (!ctx.session.user.isRoot) {
            throw new trpc.TRPCError({
                code: "BAD_REQUEST",
                message: "Only the root device can be used to remove devices.",
            });
        }

        // Check if the account (device) the user is trying to unlink isn't the last one
        const linkedDevices = await ctx.prisma.account.count({
            where: {
                userId: ctx.session.user.id,
            },
        });

        if (linkedDevices <= 1) {
            throw new trpc.TRPCError({
                code: "BAD_REQUEST",
                message: "You cannot unlink your last device.",
            });
        }

        const account = await ctx.prisma.account.findFirst({
            where: {
                providerAccountId: input.deviceId,
                userId: ctx.session.user.id,
            },
            select: {
                providerAccountId: true,
            },
        });

        if (account == null) {
            throw new trpc.TRPCError({
                code: "BAD_REQUEST",
                message: "Device not found",
            });
        }

        await ctx.prisma.account.delete({
            where: {
                providerAccountId: account.providerAccountId,
            },
        });

        return true;
    });

export const accountRouterGetRegisteredDevices = protectedProcedure
    .output(
        z.array(
            z.object({
                id: z.string(),
                deviceID: z.string(),
                created_at: z.date(),
                root: z.boolean(),
                userAgent: z.string().nullable(),
                ip: z.string().nullable(),
            })
        )
    )
    .query(async ({ ctx }) => {
        if (!checkRatelimitAccountRouter(ctx.userIP, false)) {
            throw trpcRatelimitError;
        }

        if (!ctx.session.user.isRoot) {
            throw new trpc.TRPCError({
                code: "BAD_REQUEST",
                message:
                    "Only the root device can be used to view registered devices.",
            });
        }

        const devices = await ctx.prisma.account.findMany({
            where: {
                userId: ctx.session.user.id,
            },
            select: {
                id: true,
                providerAccountId: true,
                created_at: true,
                root: true,
                session: {
                    select: {
                        user_agent: true,
                        ip: true,
                    },
                },
            },
        });

        return [
            ...devices.map((device) => ({
                ...device,
                deviceID: device.providerAccountId,
                userAgent: device.session?.user_agent ?? null,
                ip: device.session?.ip ?? null,
            })),
        ];
    });

export const accountRouterDeleteUser = protectedProcedure
    .output(z.boolean())
    .mutation(async ({ ctx }) => {
        if (!checkRatelimitAccountRouter(ctx.userIP, true)) {
            throw trpcRatelimitError;
        }

        // Only the root account can delete the user
        if (!ctx.session.user.isRoot) {
            throw new trpc.TRPCError({
                code: "BAD_REQUEST",
                message: "Only the root account can delete the user.",
            });
        }

        const subscription = await ctx.prisma.user.delete({
            where: {
                id: ctx.session.user.id,
            },
            select: {
                subscription: true,
            },
        });

        if (subscription && subscription.subscription.length > 0) {
            const id = subscription.subscription[0]?.customer_id;

            // Call the Stripe API to delete the customer only if the user had a subscription
            // The actual customer_id is set to the user's ID when they don't have a subscription
            // When they do have a subscription, the customer_id is set to the actual customer ID (payment processor's)
            if (id && id !== ctx.session.user.id) {
                try {
                    const res = await stripe.customers.del(id);
                    console.debug(
                        `[TRPC - account.deleteUser] Deleted customer for user ID: ${ctx.session.user.id}}`,
                        res
                    );
                } catch (e) {
                    // Ignore error, the customer might have been deleted already or the ID is invalid
                    console.debug(
                        `[TRPC - account.deleteUser] Error deleting customer for user ID: ${ctx.session.user.id}}`,
                        e
                    );
                }
            }
        }

        return true;
    });
