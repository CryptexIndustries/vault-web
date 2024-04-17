import { z } from "zod";
import * as trpc from "@trpc/server";
import { protectedProcedure } from "../../trpc";
import { checkRatelimitter } from "../../../common/ratelimiting";

export const featureVotingRouterOpenRoundExists = protectedProcedure
    .output(z.boolean())
    .query(async ({ ctx }) => {
        await checkRatelimitter(
            ctx.apiKeyHash,
            "FEATURE_VOTING_OPEN_ROUND_EXISTS",
            1,
            "1m",
        );

        // Check the end date of the round and compare it to the current date
        const openRound = await ctx.prisma.featureVotingRounds.findFirst({
            where: {
                start: {
                    lte: new Date(),
                },
                end: {
                    gte: new Date(),
                },
                visible: true,
            },
            select: {
                id: true,
            },
        });

        // Return a boolean result if an open round exists
        return openRound ? true : false;
    });

export const featureVotingRouterGetRounds = protectedProcedure
    .output(
        z.object({
            rounds: z.array(
                z.object({
                    id: z.string(),
                    title: z.string(),
                    description: z.string().nullable(),
                    start: z.date(),
                    end: z.date(),
                    items: z.array(
                        z.object({
                            id: z.string(),
                            title: z.string(),
                            description: z.string().nullable(),
                            votes: z
                                .array(
                                    z.object({
                                        id: z.string(),
                                    }),
                                )
                                .optional(),
                        }),
                    ),
                    active: z.boolean().optional(), // If the round is active (between start and end date)
                    // votes: z.number().optional(), // The number of votes this round has received (if the round is done / not active)
                    userCanVote: z.boolean().optional(), // If the user can vote in this round (if the round is active and the user is logged in)
                    votedId: z.string().optional(), // The item ID the user has voted for (if the user has voted)
                }),
            ),
            incorrectTier: z.boolean(), // If the user is logged in but has a tier that does not allow voting
        }),
    )
    .query(async ({ ctx }) => {
        await checkRatelimitter(
            ctx.apiKeyHash,
            "FEATURE_VOTING_GET_ROUNDS",
            2,
            "1m",
        );

        // Return the latest two rounds
        const rounds: {
            id: string;
            title: string;
            description: string | null;
            start: Date;
            end: Date;
            items: {
                id: string;
                title: string;
                description: string | null;
                votes?: { id: string }[];
            }[];
            active?: boolean;
            // votes?: number;
            userCanVote?: boolean;
            votedId?: string;
        }[] = await ctx.prisma.featureVotingRounds.findMany({
            take: 2,
            orderBy: {
                start: "desc",
            },
            select: {
                id: true,
                title: true,
                description: true,
                start: true,
                end: true,
                items: {
                    select: {
                        id: true,
                        title: true,
                        description: true,
                    },
                },
            },
            where: {
                visible: true,
            },
        });

        // Get the items of the rounds we selected
        const items = await ctx.prisma.featureVotingItems.findMany({
            where: {
                round_id: {
                    in: rounds.map((round) => round.id),
                },
            },
            select: {
                id: true,
                title: true,
                description: true,
                round_id: true,
                votes: {
                    select: {
                        id: true,
                    },
                },
            },
        });

        // Get the users tier and tier configuration
        const canUserVote = ctx.user.subscriptionConfig.feature_voting;

        const votes = await ctx.prisma.featureVotingVotes.findMany({
            where: {
                round_id: {
                    in: rounds.map((round) => round.id),
                },
                user_id: ctx.user.id,
            },
            select: {
                round_id: true,
                item_id: true,
            },
        });

        // Implant a boolean value to indicate if the user can vote and if the round is active
        rounds?.forEach((round) => {
            round.active = false;
            round.items = items.filter((item) => item.round_id === round.id);
            round.userCanVote = false;
            round.votedId = votes.find((vote) => vote.round_id === round.id)
                ?.item_id;

            if (round.start <= new Date() && round.end >= new Date()) {
                round.active = true;

                // Check if they have voted in this round
                if (canUserVote) {
                    round.userCanVote = !round.votedId;
                }
            }
        });

        return {
            rounds: rounds,
            incorrectTier: !canUserVote,
        };
    });

export const featureVotingRouterPlaceVote = protectedProcedure
    .input(
        z.object({
            roundId: z.string(),
            itemId: z.string(),
        }),
    )
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
        await checkRatelimitter(
            ctx.apiKeyHash,
            "FEATURE_VOTING_PLACE_VOTE",
            2,
            "1m",
        );

        // Check if the user has a tier that allows voting
        const canUserVote = ctx.user.subscriptionConfig.feature_voting;

        if (!canUserVote) {
            throw new trpc.TRPCError({
                code: "UNAUTHORIZED",
                message: "Your tier does not allow voting. Please upgrade",
            });
        }

        // Check if the round is active and that the user can vote
        const round = await ctx.prisma.featureVotingRounds.findFirst({
            where: {
                id: input.roundId,
                start: {
                    lte: new Date(),
                },
                end: {
                    gte: new Date(),
                },
                visible: true,
            },
            select: {
                id: true,
            },
        });

        if (!round) {
            throw new trpc.TRPCError({
                code: "NOT_FOUND",
                message: "Round not found",
            });
        }

        // Check if the user has already voted in this round
        const vote = await ctx.prisma.featureVotingVotes.findFirst({
            where: {
                round_id: input.roundId,
                user_id: ctx.user.id,
            },
            select: {
                id: true,
            },
        });

        if (vote) {
            throw new trpc.TRPCError({
                code: "BAD_REQUEST",
                message: "You have already voted in this round",
            });
        }

        // Check if the item exists
        const item = await ctx.prisma.featureVotingItems.findFirst({
            where: {
                id: input.itemId,
                round_id: input.roundId,
            },
            select: {
                id: true,
            },
        });

        if (!item) {
            throw new trpc.TRPCError({
                code: "NOT_FOUND",
                message: "Item not found",
            });
        }

        // Create the vote
        await ctx.prisma.featureVotingVotes.create({
            data: {
                round_id: input.roundId,
                item_id: input.itemId,
                user_id: ctx.user.id,
            },
        });

        return {
            success: true,
        };
    });
