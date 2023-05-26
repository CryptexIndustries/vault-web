// src/server/router/context.ts
import * as trpc from "@trpc/server";
import * as trpcNext from "@trpc/server/adapters/next";
import { Session } from "next-auth";
import { getServerAuthSession } from "../common/get-server-auth-session";
import { prisma } from "../db/client";
import { NextApiRequest } from "next";

type CreateContextOptions = {
    session: Session | null;
    req: NextApiRequest;
    userIP: string;
};

/** Use this helper for:
 * - testing, where we don't have to Mock Next.js' req/res
 * - trpc's `createSSGHelpers` where we don't have req/res
 **/
export const createContextInner = async (opts: CreateContextOptions) => {
    return {
        session: opts.session,
        request: opts.req,
        userIP: opts.userIP,
        prisma,
    };
};

/**
 * This is the actual context you'll use in your router
 * @link https://trpc.io/docs/context
 **/
export const createContext = async (
    opts: trpcNext.CreateNextContextOptions
) => {
    const { req, res } = opts;

    // Get the session from the server using the previously unstable getServerSession wrapper function
    const session = await getServerAuthSession({ req, res });

    return await createContextInner({
        session,
        req,
        userIP: (req.headers?.["x-forwarded-for"] ?? "127.0.0.1") as string,
    });
};

type Context = trpc.inferAsyncReturnType<typeof createContext>;

export const createRouter = () => trpc.router<Context>();
