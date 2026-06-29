import { z } from "zod";
import { protectedProcedure } from "../../trpc";

export const featureVotingRouterOpenRoundExists = protectedProcedure
    .output(z.boolean())
    .query(() => {
        throw new Error("api-contract stub");
    })
;
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
    .query(() => {
        throw new Error("api-contract stub");
    })
;
export const featureVotingRouterPlaceVote = protectedProcedure
    .input(
        z.object({
            roundId: z.string(),
            itemId: z.string(),
        }),
    )
    .output(z.object({ success: z.boolean() }))
    .mutation(() => {
        throw new Error("api-contract stub");
    })
;
