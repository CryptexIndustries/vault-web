import { initTRPC } from "@trpc/server";
import superjson from "superjson";

const t = initTRPC.create({
    transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;
/** Typed like authenticated procedures; no server middleware in contract stubs. */
export const protectedProcedure = t.procedure;
