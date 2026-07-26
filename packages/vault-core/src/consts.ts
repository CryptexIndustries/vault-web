import { TOTPAlgorithm } from "./proto/vault";

export const TOTPConstants = {
    PERIOD_DEFAULT: 30 as const,
    DIGITS_DEFAULT: 6 as const,
    ALGORITHM_DEFAULT: TOTPAlgorithm.SHA1 as const,
};

export const CredentialConstants = {
    TAG_SEPARATOR: ",|.|," as const,
};

export const BACKUP_FILE_EXTENSION = "cryx";
export const LINK_FILE_EXTENSION = "cryxlink";

export const REQUIRED_FIELD_ERROR = "This is a required field";

export const ONLINE_SERVICES_SELECTION_ID = "OnlineServices";
