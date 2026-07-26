import { TOTPAlgorithm } from "@cryptex-industries/vault-core/proto";

export {
    TOTPConstants,
    CredentialConstants,
    BACKUP_FILE_EXTENSION,
    LINK_FILE_EXTENSION,
    REQUIRED_FIELD_ERROR,
    ONLINE_SERVICES_SELECTION_ID,
} from "@cryptex-industries/vault-core/consts";

export const DIALOG_BLUR_TIME = 200;

// Re-export algorithm enum for local callers that historically imported via consts.
export { TOTPAlgorithm };
