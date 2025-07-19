// src/server/router/context.ts
import * as trpc from "@trpc/server";
import * as trpcNext from "@trpc/server/adapters/next";
import { NextApiRequest } from "next";
import {
    apiKeyFromHeaders,
    ipFromHeaders,
} from "../common/request-header-probe";
import { prisma } from "../db/client";

type User = {
    id: string;
    // NOTE: This object is stuffed with user data from the DB in the TRPC middleware
};

type CreateContextOptions = {
    req: NextApiRequest;
    prisma: typeof prisma;

    userIP: string;
    apiKey: string | null;
    apiKeyID: string | null;
    apiKeyHash: string | null;
    rootAPIKey: boolean;
    user: User | null;
};

/** Use this helper for:
 * - testing, where we don't have to Mock Next.js' req/res
 * - trpc's `createSSGHelpers` where we don't have req/res
 **/
// export const createContextInner = async (opts: CreateContextOptions) => {
//     return {
//         session: opts.session,
//         request: opts.req,
//         userIP: opts.userIP,
//         prisma,
//     };
// };

/**
 * This is the actual context you'll use in your router
 * @link https://trpc.io/docs/context
 **/
export const createContext = async (
    opts: trpcNext.CreateNextContextOptions,
) => {
    const { req } = opts;

    const context: CreateContextOptions = {
        req,
        prisma,
        userIP: ipFromHeaders(req.headers),
        apiKey: apiKeyFromHeaders(req.headers),
        apiKeyID: null,
        apiKeyHash: null,
        rootAPIKey: false,
        user: null,
    };

    return context;
};

export type Context = trpc.inferAsyncReturnType<typeof createContext>;
