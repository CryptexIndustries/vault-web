import { t } from "@lingui/core/macro";
import type { BackupDestinationField } from "@cryptex-industries/vault-core/vault-utils/backup-destinations";
import { S3Error } from "@cryptex-industries/vault-core/vault-utils/s3-errors";

function s3Message(error: S3Error): string {
    switch (error.code) {
        case "NETWORK":
            return t`Couldn't reach the bucket. Check the endpoint and your connection.`;
        case "ACCESS_DENIED":
            return t`The bucket refused the access key. Check the key, the secret and the key's permissions.`;
        case "CLOCK_SKEW":
            return t`This device's clock is wrong. Correct the date and time, then try again.`;
        case "NO_SUCH_BUCKET":
            return t`The bucket doesn't exist at this endpoint.`;
        case "WRONG_REGION":
            return t`The region doesn't match the bucket.`;
        case "NOT_FOUND":
            return t`The backup file is no longer in the bucket.`;
        case "INVALID_RESPONSE":
            return t`The endpoint didn't answer like an S3 service.`;
        case "REJECTED":
            return t`The bucket rejected the request.`;
    }
}

/** vault-core's S3 errors in the app's language; null for other errors. */
export function describeBackupDestinationError(error: unknown): string | null {
    if (!(error instanceof S3Error)) return null;
    const message = s3Message(error);
    return error.status ? `${message} (HTTP ${error.status})` : message;
}

/** vault-core's validation message for the field, in the app's language. */
export function backupDestinationFieldError(
    field: BackupDestinationField,
    fallback: string,
): string {
    switch (field) {
        case "Name":
            return t`Enter a name of up to 64 characters.`;
        case "Endpoint":
            return t`Enter the endpoint as an https:// address with no path.`;
        case "Region":
            return t`Enter a region such as us-east-1, or auto for R2.`;
        case "Bucket":
            return t`Enter a bucket name of 3 to 63 letters, digits, dots or hyphens.`;
        case "Prefix":
            return t`Use folder names separated by /, without . or .. parts.`;
        case "AccessKeyID":
            return t`Enter the access key ID.`;
        case "SecretAccessKey":
            return t`Enter the secret access key.`;
        default:
            return fallback;
    }
}
