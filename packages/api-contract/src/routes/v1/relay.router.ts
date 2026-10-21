import { protectedProcedure } from "../../trpc";
import { z } from "zod";

export const relayRouterPass = protectedProcedure
    .input(z.object({ key: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }))
    .output(z.object({ pass: z.string(), expiresAt: z.number() }))
    .mutation(() => {
        throw new Error("api-contract stub");
    });
