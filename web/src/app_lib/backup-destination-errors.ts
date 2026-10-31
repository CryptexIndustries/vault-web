import { S3Error } from "@cryptex-industries/vault-core/vault-utils/s3-errors";

/** Browsers report a CORS refusal as a plain network error. */
export function describeBackupDestinationError(error: unknown): string | null {
    if (!(error instanceof S3Error)) return null;
    return error.code === "NETWORK"
        ? "Couldn't reach the bucket. Check the endpoint, and that the bucket's CORS rules allow this site."
        : error.message;
}
