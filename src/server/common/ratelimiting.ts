import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { TRPCError } from "@trpc/server";

type Unit = "ms" | "s" | "m" | "h" | "d";
type Duration = `${number} ${Unit}` | `${number}${Unit}`;

export const trpcRatelimitError = new TRPCError({
    code: "PRECONDITION_FAILED",
    message: "Too many requests.",
});

// Emphermeral storage
const ephemeralCache = new Map();

/**
 * A generic ratelimit checker that can make use of environment variables to override the default values.
 * All of the ratelimits are disabled by default.
 * @note To enable a ratelimit, set the environment variable `RATELIMIT_{envVar}_ENABLE` to `true`.
 * @note To override the number of requests, set the environment variable `RATELIMIT_{envVar}_N_REQUESTS` to the desired number.
 * @note To override the duration, set the environment variable `RATELIMIT_{envVar}_DURATION` to the desired duration.
 * @param clientIdentifier The client identifier
 * @param envVar Environment variable override name
 * @param tokens Number of tokens in a duration
 * @param duration The duration during which we limit the number of requests
 * @throws {TRPCError} If the request is not allowed
 */
export const checkRatelimitter = async (
    clientIdentifier: string,
    envVar: string,
    tokens: number,
    duration: Duration,
) => {
    envVar = envVar.toUpperCase();
    const envVarPrefix = "RATELIMIT_" + envVar;

    let nRequests = tokens;
    let dur = duration;

    // If the ratelimit is not enabled, return true
    const envVarEnable = process.env[envVarPrefix + "_ENABLE"];
    if (envVarEnable == null || envVarEnable.toLowerCase() === "false") {
        return true;
    }

    // Parse the environment variable for the number of requests if it exist
    const nRequestsEnv = process.env[envVarPrefix + "_N_REQUESTS"];
    if (nRequestsEnv != null) {
        nRequests = parseInt(nRequestsEnv);
    }

    // Parse the environment variable for the duration if it exist
    const durationEnv = process.env[envVarPrefix + "_DURATION"];
    if (durationEnv != null) {
        dur = durationEnv as Duration;
    }

    const ratelimit: Ratelimit = new Ratelimit({
        redis: Redis.fromEnv(),
        limiter: Ratelimit.slidingWindow(nRequests, dur),
        analytics: true,
        ephemeralCache,
        prefix: "@upstash/ratelimit/" + envVar,
    });

    const result = await ratelimit.limit(clientIdentifier);

    // Throw the rate limit error if the request is not allowed
    if (!result.success) {
        throw trpcRatelimitError;
    }
};
