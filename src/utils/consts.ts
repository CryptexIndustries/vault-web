export const DIALOG_BLUR_TIME = 200;
export const ONLINE_SERVICES_SELECTION_ID = "OnlineServices";

export const enumToRecord = (enumObject: object): Record<string, string> =>
    Object.keys(enumObject).reduce((acc, key) => {
        const _key = key as keyof typeof enumObject;

        // If the key is not a number, skip it
        if (isNaN(Number(_key))) return acc;

        acc[_key] = enumObject[_key];
        return acc;
    }, {});
