import { protectedProcedure } from "../../trpc";
import { z } from "zod";

export const shareRouterTicket = protectedProcedure
    .output(z.object({ ticket: z.string(), expiresAt: z.number() }))
    .mutation(() => {
        throw new Error("api-contract stub");
    });
