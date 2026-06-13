import Papa from "papaparse";
import { z } from "zod";

import { CredentialConstants } from "../../utils/consts";
import { Credential, ItemType } from "../proto/vault";
import { CustomField, Group, TOTP, Vault } from "./vault";

export const vaultToJSON = (vaultInstance: Vault) => {
    // Make sure to remove all unnecessary properties from the vault by manually creating a new object
    const sanitizedVault = {
        Groups: vaultInstance.Groups,
        Credentials: vaultInstance.Credentials,
    };

    const stringifiedData = JSON.stringify(sanitizedVault, null, 4);

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
    | "DateCreatedTimestamp"
    | "DateModifiedTimestamp"
    | "DatePasswordChangedTimestamp"
    | "Deleted";
export const PossibleFields: Array<{ fieldText: string; field: Fields }> = [
    { fieldText: "Name", field: "Name" },
    { fieldText: "Username", field: "Username" },
    { fieldText: "Password", field: "Password" },
    { fieldText: "2FA Secret", field: "TOTP" },
    { fieldText: "Tags", field: "Tags" },
    { fieldText: "URL", field: "URL" },
    { fieldText: "Notes", field: "Notes" },
    { fieldText: "DateCreatedTimestamp", field: "DateCreatedTimestamp" },
    { fieldText: "DateModifiedTimestamp", field: "DateModifiedTimestamp" },
    {
        fieldText: "DatePasswordChangedTimestamp",
        field: "DatePasswordChangedTimestamp",
    },
    { fieldText: "Deleted", field: "Deleted" },
];

export const FieldsSchema = z.object({
    Name: z.string().nullable(),
    Username: z.string().nullable(),
    Password: z.string().nullable(),
    TOTP: z.string().nullable(),
    Tags: z.string().nullable(),
    URL: z.string().nullable(),
    Notes: z.string().nullable(),
    DateCreatedTimestamp: z.number().nullable(),
    DateModifiedTimestamp: z.number().nullable(),
    DatePasswordChangedTimestamp: z.number().nullable(),
    TagDelimiter: z.string().nullable(),
    Deleted: z.string().nullable(),
});
export type FieldsSchemaType = z.infer<typeof FieldsSchema>;

//#region Bitwarden
interface BitwardenFolder {
    id: string;
    name: string;
}
interface BitwardenItem {
    id: string;
    folderId?: string;
    name: string;
    notes?: string;
    creationDate?: string;
    type: number;
    login?: {
        username: string;
        password: string;
        totp: string;
        uris: {
            match: string;
            uri: string;
        }[];
    };
    revisionDate?: string;
    passwordRevisionDate?: string;
    passwordHistory?: {
        password: string;
        lastUsedDate: string;
    }[];
    card?: {
        cardholderName: string;
        brand: string;
        number: string;
        expMonth: number;
        expYear: number;
        code: string;
    };
    fields?: {
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
    onSuccess: (credentials: Credential[]) => Promise<void>,
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
            ): string | null => {
                const key = (fields[field] ?? field) as keyof typeof row;
                const value = row[key] ?? defaultValue;
                if (value == undefined || value === "") return null;
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

            const tryParseNumber = (value: string | null): number | null => {
                if (value == null || value === "") return null;
                // Try to parse the value as a number
                const parsed = Number(value);
                // If we failed to parse the number, return null
                if (isNaN(parsed)) return null;
                // Otherwise, return the parsed number
                return parsed;
            };

            const credentials: Credential[] = [];

            try {
                for (const row of results.data as object[]) {
                    const parsedCredential: Credential = {
                        ID: "",
                        Version: 0,

                        Type: ItemType.Credentials,
                        GroupID: "",
                        Name:
                            extractValue(row, "Name", "Import") ??
                            "Unnamed item",
                        Username: extractValue(row, "Username") ?? "",
                        Password: extractValue(row, "Password") ?? "",
                        Tags: parseTags(extractValue(row, "Tags") ?? ""),
                        URL: extractValue(row, "URL") ?? "",
                        Notes: extractValue(row, "Notes") ?? "",
                        CustomFields: [],

                        // TODO: Remove these fields after August 2026
                        DateCreated: "",
                        DateModified: undefined,
                        DatePasswordChanged: undefined,

                        DateCreatedTimestamp: 0,
                        DateModifiedTimestamp: 0,
                        DatePasswordChangedTimestamp: 0,
                        Deleted:
                            extractValue(row, "Deleted", "false") === "true",
                        Hash: "",
                    };

                    const totp = extractValue(row, "TOTP");
                    if (totp != null && totp !== "") {
                        parsedCredential.TOTP = new TOTP();
                        parsedCredential.TOTP.Secret = totp;
                    }

                    const now = Date.now();

                    // Parse the csv dates to timestamps and hash the credential
                    const dateCreated =
                        tryParseNumber(
                            extractValue(row, "DateCreatedTimestamp"),
                        ) ?? now;
                    if (dateCreated != null) {
                        parsedCredential.DateCreatedTimestamp = dateCreated;
                    }

                    const dateModified =
                        tryParseNumber(
                            extractValue(row, "DateModifiedTimestamp"),
                        ) ?? now;
                    if (dateModified != null) {
                        parsedCredential.DateModifiedTimestamp = dateModified;
                    }

                    const datePasswordChanged =
                        tryParseNumber(
                            extractValue(row, "DatePasswordChangedTimestamp"),
                        ) ?? now;
                    if (datePasswordChanged != null) {
                        parsedCredential.DatePasswordChangedTimestamp =
                            datePasswordChanged;
                    }

                    credentials.push(parsedCredential);
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
    credentials: Credential[];
    groups: Group[];
}> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        const parseTimestamp = (
            value: string | undefined,
            fallback: number,
        ): number => {
            if (!value) return fallback;
            const parsed = new Date(value).getTime();
            return Number.isFinite(parsed) ? parsed : fallback;
        };

        const mapBitwardenItemType = (type: number): ItemType => {
            // Bitwarden: 1=login, 2=secure note, 3=card, 4=identity
            // Cryptex: SSHKey=0, Credentials=1, Note=2, Identity=3
            switch (type) {
                case 2:
                    return ItemType.Note;
                case 4:
                    return ItemType.Identity;
                case 1:
                case 3:
                default:
                    return ItemType.Credentials;
            }
        };

        reader.onload = () => {
            const credentials: Credential[] = [];
            const groups: Group[] = [];

            // NOTE: The whole thing is wrapped in a try-catch block because we need to reject the promise if something goes wrong
            try {
                const json = reader.result as string;
                const parsed = JSON.parse(json) as BitwardenJSON;

                for (const item of parsed.items) {
                    const now = Date.now();
                    const createdTimestamp = parseTimestamp(
                        item.creationDate ?? item.revisionDate,
                        now,
                    );
                    const modifiedTimestamp = parseTimestamp(
                        item.revisionDate ?? item.passwordRevisionDate,
                        createdTimestamp,
                    );
                    const passwordChangedTimestamp = parseTimestamp(
                        item.passwordRevisionDate ??
                            item.passwordHistory?.[0]?.lastUsedDate,
                        createdTimestamp,
                    );

                    const credential: Credential = {
                        ID: "",
                        Version: 0,
                        Type: mapBitwardenItemType(item.type),
                        GroupID: item.folderId ?? "",
                        Name: item.name ?? "Import",
                        Username: item.login?.username ?? "",
                        Password: item.login?.password ?? "",
                        URL: item.login?.uris?.[0]?.uri ?? "",
                        Notes: item.notes ?? "",

                        // TODO: Remove these fields after August 2026
                        DateCreated: "",
                        DateModified: undefined,
                        DatePasswordChanged: undefined,

                        DateCreatedTimestamp: createdTimestamp,
                        DateModifiedTimestamp: modifiedTimestamp,
                        DatePasswordChangedTimestamp: passwordChangedTimestamp,
                        Deleted: false,
                        CustomFields: [],
                        Hash: "",
                    };

                    if (item.login?.totp) {
                        credential.TOTP = new TOTP();
                        credential.TOTP.Secret = item.login.totp;
                    }

                    // Set custom fields
                    item.fields?.forEach((field) => {
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
