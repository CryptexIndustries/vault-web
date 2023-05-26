import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { TRPCError } from "@trpc/server";
import { env } from "../../env/server.mjs";

type Unit = "ms" | "s" | "m" | "h" | "d";
type Duration = `${number} ${Unit}` | `${number}${Unit}`;

// Emphermeral storage
const ephemeralCache = new Map();

//#region Auth
const ratelimitAuth: Ratelimit = new Ratelimit({
    redis: Redis.fromEnv(),
    limiter: Ratelimit.slidingWindow(
        env.UPSTASH_RATELIMIT_N_REQUESTS_AUTH,
        env.UPSTASH_RATELIMIT_DURATION_AUTH as Duration
    ),
    analytics: true,
    ephemeralCache,
    prefix: "@upstash/ratelimit/auth",
});
/**
 * Ratelimit for all requests
 * Rate limit is 2 requests per 5 seconds
 */
export const checkAuthRatelimit = async (ip: string) => {
    if (!env.UPSTASH_RATELIMIT_ENABLE_AUTH) return true;

    const result = await ratelimitAuth.limit(ip);
    return result.success;
};
//#endregion Auth

//#region Register User
const ratelimitRegisterUser: Ratelimit = new Ratelimit({
    redis: Redis.fromEnv(),
    limiter: Ratelimit.slidingWindow(
        env.UPSTASH_RATELIMIT_N_REQUESTS_REGISTER,
        env.UPSTASH_RATELIMIT_DURATION_REGISTER as Duration
    ),
    analytics: true,
    ephemeralCache,
    prefix: "@upstash/ratelimit/register-user",
});
/**
 * Ratelimit for registering a new user
 * Rate limit is 1 request per minute
 */
export const checkRatelimitRegisterUser = async (ip: string) => {
    if (!env.UPSTASH_RATELIMIT_ENABLE_REGISTER) return true;

    const result = await ratelimitRegisterUser.limit(ip);
    return result.success;
};
//#endregion Register User

//#region PaymentRouter
const ratelimitPaymentRouter: Ratelimit = new Ratelimit({
    redis: Redis.fromEnv(),
    limiter: Ratelimit.slidingWindow(
        env.UPSTASH_RATELIMIT_N_REQUESTS_PAYMENTROUTER_DB,
        env.UPSTASH_RATELIMIT_DURATION_PAYMENTROUTER_DB as Duration
    ),
    analytics: true,
    ephemeralCache,
    prefix: "@upstash/ratelimit/payment-router",
});
const ratelimitPaymentNoDB: Ratelimit = new Ratelimit({
    redis: Redis.fromEnv(),
    limiter: Ratelimit.slidingWindow(
        env.UPSTASH_RATELIMIT_N_REQUESTS_PAYMENTROUTER_NODB,
        env.UPSTASH_RATELIMIT_DURATION_PAYMENTROUTER_NODB as Duration
    ),
    analytics: true,
    ephemeralCache,
    prefix: "@upstash/ratelimit/payment-router-no-db",
});
/**
 * Ratelimit for payment router
 * Rate limit is 3 requests per 5 seconds for requests that use a database
 * Rate limit is 3 requests per 5 seconds for requests that don't use a database
 * @param ip IP address of the user
 * @param usesDB Whether the user uses a database or not
 * @returns Whether the request is allowed or not
 */
export const checkRatelimitPaymentRouter = async (
    ip: string,
    usesDB: boolean
) => {
    if (
        (!env.UPSTASH_RATELIMIT_ENABLE_PAYMENTROUTER_DB && usesDB) ||
        (!env.UPSTASH_RATELIMIT_ENABLE_PAYMENTROUTER_NODB && !usesDB)
    )
        return true;

    const result = await (usesDB
        ? ratelimitPaymentRouter
        : ratelimitPaymentNoDB
    ).limit(ip);
    return result.success;
};
//#endregion PaymentRouter

//#region Feature Voting
const ratelimitFeatureVoting: Ratelimit = new Ratelimit({
    redis: Redis.fromEnv(),
    limiter: Ratelimit.slidingWindow(
        env.UPSTASH_RATELIMIT_N_REQUESTS_FEATUREVOTINGROUTER,
        env.UPSTASH_RATELIMIT_DURATION_FEATUREVOTINGROUTER as Duration
    ),
    analytics: true,
    ephemeralCache,
    prefix: "@upstash/ratelimit/feature-voting",
});
const ratelimitFeatureVotingMutation: Ratelimit = new Ratelimit({
    redis: Redis.fromEnv(),
    limiter: Ratelimit.slidingWindow(
        env.UPSTASH_RATELIMIT_N_REQUESTS_FEATUREVOTINGROUTER_MUTATION,
        env.UPSTASH_RATELIMIT_DURATION_FEATUREVOTINGROUTER_MUTATION as Duration
    ),
    analytics: true,
    ephemeralCache,
    prefix: "@upstash/ratelimit/feature-voting-mutation",
});
/**
 * Ratelimit for feature voting
 * Rate limit is 3 requests per 10 seconds for queries
 * Rate limit is 1 request per minute for mutations
 * @param ip IP address of the user
 * @param isMutation Whether the request is a mutation or not
 * @returns Whether the request is allowed or not
 */
export const checkRatelimitFeatureVoting = async (
    ip: string,
    isMutation: boolean
) => {
    if (
        (!env.UPSTASH_RATELIMIT_ENABLE_FEATUREVOTINGROUTER && !isMutation) ||
        (!env.UPSTASH_RATELIMIT_ENABLE_FEATUREVOTINGROUTER_MUTATION &&
            isMutation)
    )
        return true;

    const result = await (isMutation
        ? ratelimitFeatureVotingMutation
        : ratelimitFeatureVoting
    ).limit(ip);
    return result.success;
};
//#endregion Feature Voting

//#region Notifyme
const ratelimitNotifymeRouter: Ratelimit = new Ratelimit({
    redis: Redis.fromEnv(),
    limiter: Ratelimit.slidingWindow(
        env.UPSTASH_RATELIMIT_N_REQUESTS_NOTIFYMEROUTER,
        env.UPSTASH_RATELIMIT_DURATION_NOTIFYMEROUTER as Duration
    ),
    analytics: true,
    ephemeralCache,
    prefix: "@upstash/ratelimit/notifyme",
});
/**
 * Ratelimit for notifyme router requests
 * Rate limit is 5 requests per minute
 */
export const checkRatelimitNotifyme = async (ip: string) => {
    if (!env.UPSTASH_RATELIMIT_ENABLE_NOTIFYMEROUTER) return true;

    const result = await ratelimitNotifymeRouter.limit(ip);
    return result.success;
};
//#endregion Notifyme

//#region AccountRouter
const ratelimitAccountRouterQuery: Ratelimit = new Ratelimit({
    redis: Redis.fromEnv(),
    limiter: Ratelimit.slidingWindow(
        env.UPSTASH_RATELIMIT_N_REQUESTS_ACCOUNTROUTER_QUERY,
        env.UPSTASH_RATELIMIT_DURATION_ACCOUNTROUTER_QUERY as Duration
    ),
    analytics: true,
    ephemeralCache,
    prefix: "@upstash/ratelimit/account-router-query",
});
const ratelimitAccountRouterMutation: Ratelimit = new Ratelimit({
    redis: Redis.fromEnv(),
    limiter: Ratelimit.slidingWindow(
        env.UPSTASH_RATELIMIT_N_REQUESTS_ACCOUNTROUTER_MUTATION,
        env.UPSTASH_RATELIMIT_DURATION_ACCOUNTROUTER_MUTATION as Duration
    ),
    analytics: true,
    ephemeralCache,
    prefix: "@upstash/ratelimit/account-router-mutation",
});
/**
 * Ratelimit for account router requests
 * Rate limit is 4 requests per 10 seconds for queries
 * Rate limit is 5 requests per 5 seconds for mutations
 * @param ip IP address of the user
 * @param isMutation Whether the request is a mutation or not
 * @returns Whether the request is allowed or not
 */
export const checkRatelimitAccountRouter = async (
    ip: string,
    isMutation: boolean
) => {
    if (
        (!env.UPSTASH_RATELIMIT_ENABLE_ACCOUNTROUTER_QUERY && !isMutation) ||
        (!env.UPSTASH_RATELIMIT_ENABLE_ACCOUNTROUTER_MUTATION && isMutation)
    )
        return true;

    const result = await (isMutation
        ? ratelimitAccountRouterMutation
        : ratelimitAccountRouterQuery
    ).limit(ip);
    return result.success;
};

//#endregion AccountRouter

//#region API - Pusher
const ratelimitPusherRouter: Ratelimit = new Ratelimit({
    redis: Redis.fromEnv(),
    limiter: Ratelimit.slidingWindow(
        env.UPSTASH_RATELIMIT_N_REQUESTS_API_PUSHER,
        env.UPSTASH_RATELIMIT_DURATION_API_PUSHER as Duration
    ),
    analytics: true,
    ephemeralCache,
    prefix: "@upstash/ratelimit/pusher",
});
/**
 * Ratelimit for pusher router requests
 * Rate limit is 5 requests per 30 seconds
 * @param ip IP address of the user
 * @returns Whether the request is allowed or not
 */
export const checkRatelimitPusher = async (ip: string) => {
    if (!env.UPSTASH_RATELIMIT_ENABLE_API_PUSHER) return true;

    const result = await ratelimitPusherRouter.limit(ip);
    return result.success;
};
//#endregion API - Pusher

export const trpcRatelimitError = new TRPCError({
    code: "PRECONDITION_FAILED",
    message: "Too many requests.",
});
