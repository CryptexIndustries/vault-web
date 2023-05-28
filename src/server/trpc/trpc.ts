import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { Context } from "./context";

const t = initTRPC.context<Context>().create({
    // Optional:
    transformer: superjson,
    // Optional:
    errorFormatter(opts) {
        const { shape } = opts;
        return {
            ...shape,
            data: {
                ...shape.data,
            },
        };
    },
});

/**
 * We recommend only exporting the functionality that we
 * use so we can enforce which base procedures should be used
 **/
export const router = t.router;
export const mergeRouters = t.mergeRouters;
export const publicProcedure = t.procedure;

const middleware = t.middleware;
const isAuthenticated = middleware(({ ctx, next }) => {
    if (!ctx.session || !ctx.session.user) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
    }
    return next({
        ctx: {
            ...ctx,
            // infers that `session` is non-nullable to downstream resolvers
            session: { ...ctx.session, user: ctx.session.user },
        },
    });
});
export const protectedProcedure = publicProcedure.use(isAuthenticated);
