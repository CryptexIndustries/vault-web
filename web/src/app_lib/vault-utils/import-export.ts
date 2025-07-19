import Papa from "papaparse";
import { z } from "zod";

import { CredentialConstants } from "../../utils/consts";
import * as VaultUtilTypes from "../proto/vault";
import { CustomField, Group, TOTP, Vault } from "./vault";

export const vaultToJSON = (vaultInstance: Vault) => {
    // Make sure to remove all unnecessary properties from the vault by manually creating a new object
    const sanitizedVault = {
        Groups: vaultInstance.Groups,
        Credentials: vaultInstance.Credentials,
    };

    const stringifiedData = JSON.stringify(sanitizedVault, null, 4);

    console.debug("Deserialized vault: ", stringifiedData);

    // Trigger data download
    const blob = new Blob([stringifiedData], {
        type: "application/json",
    });

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");

    a.href = url;
    a.download = `cryptexvault-export-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
};

export enum Type {
    GenericCSV = 0,
    Bitwarden = 1,
    KeePass2 = 2,
}

export type Fields =
    | "Name"
    | "Username"
    | "Password"
    | "TOTP"
    | "Tags"
    | "URL"
    | "Notes"
    | "DateCreated"
    | "DateModified"
    | "DatePasswordChanged";
export const PossibleFields: Array<{ fieldText: string; field: Fields }> = [
    { fieldText: "Name", field: "Name" },
    { fieldText: "Username", field: "Username" },
    { fieldText: "Password", field: "Password" },
    { fieldText: "2FA Secret", field: "TOTP" },
    { fieldText: "Tags", field: "Tags" },
    { fieldText: "URL", field: "URL" },
    { fieldText: "Notes", field: "Notes" },
    { fieldText: "DateCreated", field: "DateCreated" },
    { fieldText: "DateModified", field: "DateModified" },
    { fieldText: "DatePasswordChanged", field: "DatePasswordChanged" },
];

export const FieldsSchema = z.object({
    Name: z.string().nullable(),
    Username: z.string().nullable(),
    Password: z.string().nullable(),
    TOTP: z.string().nullable(),
    Tags: z.string().nullable(),
    URL: z.string().nullable(),
    Notes: z.string().nullable(),
    DateCreated: z.string().nullable(),
    DateModified: z.string().nullable(),
    DatePasswordChanged: z.string().nullable(),
    TagDelimiter: z.string().nullable(),
});
export type FieldsSchemaType = z.infer<typeof FieldsSchema>;

//#region Bitwarden
interface BitwardenFolder {
    id: string;
    name: string;
}
interface BitwardenItem {
    id: string;
    folderId: string;
    name: string;
    notes: string;
    type: number;
    login: {
        username: string;
        password: string;
        totp: string;
        uris: {
            match: string;
            uri: string;
        }[];
    };
    revisionDate: string;
    passwordRevisionDate: string;
    passwordHistory: {
        password: string;
        lastUsedDate: string;
    }[];
    card: {
        cardholderName: string;
        brand: string;
        number: string;
        expMonth: number;
        expYear: number;
        code: string;
    };
    fields: {
        name: string;
        value: string;
        type: number;
    }[];
}

interface BitwardenJSON {
    folders: BitwardenFolder[];
    items: BitwardenItem[];
}
//#endregion Bitwarden

export const CSVGetColNames = (
    file: File,
    onSuccess: (columnNames: string[]) => void,
    onFailure: (error: Error) => void,
): void => {
    // const Papa = dynamic(() => import("papaparse"));

    Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        download: false,
        // worker: true,
        step: function (_, parser) {
            parser.abort();
        },
        complete: function (results: Papa.ParseResult<unknown> | null) {
            // Call the onSuccess callback
            onSuccess(results?.meta?.fields ?? []);

            results = null; //Attempting to clear the results from memory
        },
        error: function (error) {
            // Call the onFailure callback
            onFailure(error);
        },
    });
};

export const CSV = async (
    file: File,
    fields: FieldsSchemaType,
    onSuccess: (
        credentials: VaultUtilTypes.PartialCredential[],
    ) => Promise<void>,
    onFailure: (error: Error) => void,
): Promise<void> => {
    Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        download: false,
        worker: true,
        complete: async function (results: Papa.ParseResult<unknown> | null) {
            if (!results) return;

            const extractValue = (
                row: object,
                field: Fields,
                defaultValue?: string,
            ): string | undefined => {
                const key = (fields[field] ?? field) as keyof typeof row;
                const value = row[key] ?? defaultValue;
                if (value == undefined || value === "") return undefined;
                return value;
            };

            const parseTags = (
                tags: string | undefined,
            ): string | undefined => {
                if (tags == undefined || tags === "") return undefined;
                return tags
                    .split(fields.TagDelimiter ?? ",")
                    .join(CredentialConstants.TAG_SEPARATOR);
            };

            const tryParseNumber = (
                value: string | undefined,
            ): string | number | undefined => {
                if (value == undefined || value === "") return undefined;
                // Try to parse the value as a number
                const parsed = Number(value);
                // If we failed to parse the number, return the original value
                if (isNaN(parsed)) return value;
                // Otherwise, return the parsed number
                return parsed;
            };

            const parseDate = (
                date: string | number | undefined,
            ): string | undefined => {
                if (date == undefined || date === "") return undefined;
                try {
                    return new Date(date).toISOString();
                } catch (error) {
                    console.error("Failed to parse value as a date.", error);
                    throw error;
                }
            };

            const createTOTP = (
                secret: string | undefined,
            ): TOTP | undefined => {
                if (secret == undefined || secret === "") return undefined;
                const totp = new TOTP();
                totp.Secret = String(secret);
                return totp;
            };

            const credentials: VaultUtilTypes.PartialCredential[] = [];

            try {
                for (const row of results.data as object[]) {
                    const credential: VaultUtilTypes.PartialCredential = {
                        ID: undefined,
                        Name: extractValue(row, "Name", "Import"),
                        Username: extractValue(row, "Username"),
                        Password: extractValue(row, "Password"),
                        Tags: parseTags(extractValue(row, "Tags")),
                        URL: extractValue(row, "URL"),
                        Notes: extractValue(row, "Notes"),
                        DateCreated: parseDate(
                            tryParseNumber(extractValue(row, "DateCreated")),
                        ),
                        DateModified: parseDate(
                            tryParseNumber(extractValue(row, "DateModified")),
                        ),
                        DatePasswordChanged: parseDate(
                            tryParseNumber(
                                extractValue(row, "DatePasswordChanged"),
                            ),
                        ),
                        TOTP: createTOTP(extractValue(row, "TOTP")),
                        CustomFields: [],
                    };
                    credentials.push(credential);
                }

                // Call the onSuccess callback
                await onSuccess(credentials);
            } catch (error) {
                onFailure(error as Error);
            }
        },
        error: function (error) {
            // Call the onFailure callback
            onFailure(error);
        },
    });
};

export const BitwardenJSON = (
    file: File,
): Promise<{
    credentials: VaultUtilTypes.PartialCredential[];
    groups: Group[];
}> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = () => {
            const credentials: VaultUtilTypes.PartialCredential[] = [];
            const groups: Group[] = [];

            // NOTE: The whole thing is wrapped in a try-catch block because we need to reject the promise if something goes wrong
            try {
                const json = reader.result as string;
                const parsed = JSON.parse(json) as BitwardenJSON;

                for (const item of parsed.items) {
                    const credential: VaultUtilTypes.PartialCredential = {
                        ID: undefined,
                        Type: item.type,
                        GroupID: item.folderId,
                        CustomFields: [],
                    };

                    // TODO: Set fields based on type (mainly type 4 - identity)

                    credential.Name = item.name ?? "Import";

                    if (item.login) {
                        credential.Username = item.login.username ?? undefined;
                        credential.Password = item.login.password ?? undefined;
                        if (item.login.uris)
                            credential.URL =
                                item.login.uris[0]?.uri ?? undefined;
                    }

                    // No data to fill - credential.Tags

                    credential.Notes = item.notes ?? undefined;

                    // Use the DateCreated field if it exists (fall back to today) but set it to undefined if it doesn't
                    credential.DateCreated = item.revisionDate
                        ? new Date(item.revisionDate).toISOString()
                        : undefined;

                    credential.DateModified = item.passwordRevisionDate
                        ? new Date(item.passwordRevisionDate).toISOString()
                        : undefined;

                    credential.DatePasswordChanged =
                        item.passwordHistory && item.passwordHistory[0]
                            ? new Date(
                                  item.passwordHistory[0].lastUsedDate,
                              ).toISOString()
                            : undefined;

                    if (item.login?.totp) {
                        credential.TOTP = new TOTP();
                        credential.TOTP.Secret = item.login.totp;
                    }

                    // Set custom fields
                    item.fields?.forEach((field) => {
                        if (!credential.CustomFields)
                            credential.CustomFields = [];

                        // Only import text, masked text and boolean fields
                        // The 3 type is for something called "linked fields" for which we don't have an equivalent
                        if (field.type < 3) {
                            const customField = new CustomField();
                            customField.Name = field.name;
                            customField.Value = field.value;
                            customField.Type = field.type;

                            credential.CustomFields.push(customField);
                        }
                    });

                    credentials.push(credential);
                }

                if (parsed.folders) {
                    parsed.folders.forEach((folder) => {
                        groups.push({
                            ID: folder.id,
                            Name: folder.name,
                            Icon: "",
                            Color: "",
                        });
                    });
                }
            } catch (error) {
                reject(error);
            }

            resolve({
                credentials,
                groups,
            });
        };

        reader.onerror = () => {
            reject(reader.error);
        };

        reader.readAsText(file);
    });
};
