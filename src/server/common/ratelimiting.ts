import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { TRPCError } from "@trpc/server";
import { env } from "../../env/server.mjs";

type Unit = "ms" | "s" | "m" | "h" | "d";
type Duration = `${number} ${Unit}` | `${number}${Unit}`;

// Emphermeral storage
const ephemeralCache = new Map();

//#region Auth
/**
 * Ratelimit for all requests
 * @param ip IP address of the user
 * @returns Whether the request is allowed or not
 */
export const checkAuthRatelimit = async (ip: string) => {
    if (!env.UPSTASH_RATELIMIT_ENABLE_AUTH) return true;

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

    const result = await ratelimitAuth.limit(ip);
    return result.success;
};
//#endregion Auth

//#region User Verification
/**
 * Ratelimit for user verification
 * @param ip IP address of the user
 * @returns Whether the request is allowed or not
 */
export const checkRatelimitUserVerification = async (ip: string) => {
    if (!env.UPSTASH_RATELIMIT_ENABLE_USER_VERIFICATION) return true;

    const ratelimitUserVerification: Ratelimit = new Ratelimit({
        redis: Redis.fromEnv(),
        limiter: Ratelimit.slidingWindow(
            env.UPSTASH_RATELIMIT_N_REQUESTS_USER_VERIFICATION,
            env.UPSTASH_RATELIMIT_DURATION_USER_VERIFICATION as Duration
        ),
        analytics: true,
        ephemeralCache,
        prefix: "@upstash/ratelimit/user-verification",
    });

    const result = await ratelimitUserVerification.limit(ip);
    return result.success;
};
//#endregion User Verification

//#region Recovery
/**
 * Ratelimit for recovering an account
 * @param ip IP address of the user
 * @returns Whether the request is allowed or not
 */
export const checkRatelimitUserRecovery = async (ip: string) => {
    if (!env.UPSTASH_RATELIMIT_ENABLE_RECOVERY) return true;

    const ratelimitUserRecovery: Ratelimit = new Ratelimit({
        redis: Redis.fromEnv(),
        limiter: Ratelimit.slidingWindow(
            env.UPSTASH_RATELIMIT_N_REQUESTS_RECOVERY,
            env.UPSTASH_RATELIMIT_DURATION_RECOVERY as Duration
        ),
        analytics: true,
        ephemeralCache,
        prefix: "@upstash/ratelimit/user-recovery",
    });

    const result = await ratelimitUserRecovery.limit(ip);
    return result.success;
};

/**
 * Ratelimit for creating/clearing a recovery token
 * @param ip The IP address of the user
 * @returns Whether the request is allowed or not
 */
export const checkRatelimitUserRecoveryCreate = async (ip: string) => {
    if (!env.UPSTASH_RATELIMIT_ENABLE_RECOVERY_CREATE) return true;

    const ratelimitUserRecoveryCreate: Ratelimit = new Ratelimit({
        redis: Redis.fromEnv(),
        limiter: Ratelimit.slidingWindow(
            env.UPSTASH_RATELIMIT_N_REQUESTS_RECOVERY_CREATE,
            env.UPSTASH_RATELIMIT_DURATION_RECOVERY_CREATE as Duration
        ),
        analytics: true,
        ephemeralCache,
        prefix: "@upstash/ratelimit/user-recovery-create",
    });

    const result = await ratelimitUserRecoveryCreate.limit(ip);
    return result.success;
};
//#endregion Recovery

//#region Register User
/**
 * Ratelimit for registering a new user
 * @param ip IP address of the user
 * @returns Whether the request is allowed or not
 */
export const checkRatelimitRegisterUser = async (ip: string) => {
    if (!env.UPSTASH_RATELIMIT_ENABLE_REGISTER) return true;

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

    const result = await ratelimitRegisterUser.limit(ip);
    return result.success;
};
//#endregion Register User

//#region PaymentRouter
/**
 * Ratelimit for payment router
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

    let result = false;

    if (usesDB) {
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

        result = (await ratelimitPaymentRouter.limit(ip)).success;
    } else {
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

        result = (await ratelimitPaymentNoDB.limit(ip)).success;
    }

    return result;
};
//#endregion PaymentRouter

//#region Feature Voting
/**
 * Ratelimit for feature voting
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

    let result = false;

    if (isMutation) {
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

        result = (await ratelimitFeatureVotingMutation.limit(ip)).success;
    } else {
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

        result = (await ratelimitFeatureVoting.limit(ip)).success;
    }

    return result;
};
//#endregion Feature Voting

//#region Notifyme
/**
 * Ratelimit for notifyme router requests
 * @param ip IP address of the user
 * @returns Whether the request is allowed or not
 */
export const checkRatelimitNotifyme = async (ip: string) => {
    if (!env.UPSTASH_RATELIMIT_ENABLE_NOTIFYMEROUTER) return true;

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

    const result = await ratelimitNotifymeRouter.limit(ip);
    return result.success;
};
//#endregion Notifyme

//#region AccountRouter
/**
 * Ratelimit for account router requests
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

    let result = false;

    if (isMutation) {
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

        result = (await ratelimitAccountRouterMutation.limit(ip)).success;
    } else {
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

        result = (await ratelimitAccountRouterQuery.limit(ip)).success;
    }

    return result;
};

//#endregion AccountRouter

//#region API - Pusher
/**
 * Ratelimit for pusher router requests
 * @param ip IP address of the user
 * @returns Whether the request is allowed or not
 */
export const checkRatelimitPusher = async (ip: string) => {
    if (!env.UPSTASH_RATELIMIT_ENABLE_API_PUSHER) return true;

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

    const result = await ratelimitPusherRouter.limit(ip);
    return result.success;
};
//#endregion API - Pusher

export const trpcRatelimitError = new TRPCError({
    code: "PRECONDITION_FAILED",
    message: "Too many requests.",
});
