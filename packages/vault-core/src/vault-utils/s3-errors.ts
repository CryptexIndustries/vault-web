/** S3 failures, apart from the client so UI code can check them without loading it. */

export type S3ErrorCode =
    | "NETWORK"
    | "ACCESS_DENIED"
    | "CLOCK_SKEW"
    | "NO_SUCH_BUCKET"
    | "WRONG_REGION"
    | "NOT_FOUND"
    | "INVALID_RESPONSE"
    | "REJECTED";

const S3_ERROR_MESSAGES: Record<S3ErrorCode, string> = {
    NETWORK:
        "Couldn't reach the bucket. Check the endpoint and your connection.",
    ACCESS_DENIED:
        "The bucket refused the access key. Check the key, the secret and the key's permissions.",
    CLOCK_SKEW:
        "This device's clock is wrong. Correct the date and time, then try again.",
    NO_SUCH_BUCKET: "The bucket doesn't exist at this endpoint.",
    WRONG_REGION: "The region doesn't match the bucket.",
    NOT_FOUND: "The backup file is no longer in the bucket.",
    INVALID_RESPONSE: "The endpoint didn't answer like an S3 service.",
    REJECTED: "The bucket rejected the request.",
};

export class S3Error extends Error {
    readonly code: S3ErrorCode;
    readonly status?: number;
    readonly retryable: boolean;

    constructor(
        code: S3ErrorCode,
        options: { status?: number; cause?: unknown } = {},
    ) {
        const suffix = options.status ? ` (HTTP ${options.status})` : "";
        super(`${S3_ERROR_MESSAGES[code]}${suffix}`, { cause: options.cause });
        this.name = "S3Error";
        this.code = code;
        this.status = options.status;
        this.retryable =
            code === "NETWORK" ||
            (options.status != null &&
                (options.status === 408 ||
                    options.status === 429 ||
                    options.status >= 500));
    }
}
