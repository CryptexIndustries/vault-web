import { TOTPAlgorithm } from "../app_lib/proto/vault";

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

export const DIALOG_BLUR_TIME = 200;
export const REQUIRED_FIELD_ERROR = "This is a required field";

export const ONLINE_SERVICES_SELECTION_ID = "OnlineServices";

// TODO: Move this to a utils file
export const enumToRecord = (enumObject: object): Record<string, string> =>
    Object.keys(enumObject).reduce((acc, key) => {
        const _key = key as keyof typeof enumObject;

        // If the key is not a number, skip it
        if (isNaN(Number(_key))) return acc;

        acc[_key] = enumObject[_key];
        return acc;
    }, {});
