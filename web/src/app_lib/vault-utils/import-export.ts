import Papa from "papaparse";
import JSZip from "jszip";
import * as OTPAuth from "otpauth";
import { z } from "zod";

import { CredentialConstants } from "../../utils/consts";
import {
    Credential,
    CustomFieldType,
    ItemType,
    TOTPAlgorithm,
} from "../proto/vault";
import {
    assimilateImportedCredential,
    CustomField,
    Directory,
    TOTP,
    createDirectory,
    Vault,
    VaultCredential,
} from "./vault";

export const vaultToJSON = (vaultInstance: Vault) => {
    // Make sure to remove all unnecessary properties from the vault by manually creating a new object
    const sanitizedVault = {
        Directories: vaultInstance.Directories.filter((item) => !item.Deleted),
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

export const ImportSources = [
    "cryptex-json",
    "bitwarden-json",
    "onepassword-csv",
    "onepassword-1pux",
    "keepass-xml",
    "keepass-csv",
    "lastpass-csv",
    "chrome-csv",
    "firefox-csv",
] as const;
export type ImportSource = (typeof ImportSources)[number];

export type ImportWarning = {
    code: string;
    message: string;
    itemName?: string;
};

export type ImportResult = {
    source: ImportSource;
    credentials: Credential[];
    directories: Directory[];
    warnings: ImportWarning[];
    skipped: number;
};

export type ApplyImportResult = {
    vault: Vault;
    importedCredentials: number;
    importedDirectories: number;
};

export const ImportSourceLabels: Record<ImportSource, string> = {
    "cryptex-json": "Cryptex Vault JSON",
    "bitwarden-json": "Bitwarden JSON",
    "onepassword-csv": "1Password CSV",
    "onepassword-1pux": "1Password 1PUX",
    "keepass-xml": "KeePass XML",
    "keepass-csv": "KeePass CSV",
    "lastpass-csv": "LastPass CSV",
    "chrome-csv": "Chrome CSV",
    "firefox-csv": "Firefox CSV",
};

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
    encrypted?: boolean;
    folders: BitwardenFolder[];
    items: BitwardenItem[];
}
//#endregion Bitwarden

const readFileAsText = (file: File): Promise<string> =>
    typeof file.text === "function"
        ? file.text()
        : new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => {
                  if (typeof reader.result === "string") {
                      resolve(reader.result);
                      return;
                  }
                  if (reader.result instanceof ArrayBuffer) {
                      resolve(new TextDecoder().decode(reader.result));
                      return;
                  }
                  resolve("");
              };
              reader.onerror = () => reject(reader.error);
              reader.readAsText(file);
          });

const parseCsvRows = <T = Record<string, unknown>>(file: File): Promise<T[]> =>
    new Promise((resolve, reject) => {
        Papa.parse<T>(file, {
            header: true,
            skipEmptyLines: true,
            download: false,
            // Keep parsing on the main thread: blob workers require relaxing CSP for plaintext secret imports.
            worker: false,
            complete: (results) => resolve(results.data),
            error: reject,
        });
    });

const asString = (value: unknown): string => {
    if (value == null) return "";
    if (typeof value === "string") return value.trim();
    if (
        typeof value === "number" ||
        typeof value === "boolean" ||
        typeof value === "bigint"
    ) {
        return value.toString().trim();
    }
    return JSON.stringify(value);
};

const firstValue = (
    row: Record<string, unknown>,
    ...names: string[]
): string => {
    const lookup = new Map(
        Object.keys(row).map((key) => [key.toLowerCase().trim(), key]),
    );
    for (const name of names) {
        const found = lookup.get(name.toLowerCase().trim());
        if (found) return asString(row[found]);
    }
    return "";
};

const parseTimestamp = (
    value: unknown,
    fallback: number = Date.now(),
): number => {
    if (value == null || value === "") return fallback;
    if (typeof value === "number" && Number.isFinite(value)) {
        return value < 10_000_000_000 ? value * 1000 : value;
    }

    const raw = asString(value);
    if (!raw) return fallback;
    const numeric = Number(raw);
    if (Number.isFinite(numeric)) {
        return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
    }

    const parsed = new Date(raw).getTime();
    return Number.isFinite(parsed) ? parsed : fallback;
};

const joinTags = (values: Array<string | undefined>): string | undefined => {
    const tags = values
        .flatMap((value) => (value ?? "").split(/[;,]/g))
        .map((tag) => tag.trim())
        .filter(Boolean);
    return tags.length
        ? Array.from(new Set(tags)).join(CredentialConstants.TAG_SEPARATOR)
        : undefined;
};

const makeCustomField = (
    name: string,
    value: unknown,
    type: CustomFieldType = CustomFieldType.Text,
): CustomField | null => {
    const stringValue = asString(value);
    if (!name.trim() || !stringValue) return null;

    const field = new CustomField();
    field.ID = `import-${name}-${Math.random().toString(36).slice(2)}`;
    field.Name = name.trim();
    field.Value = stringValue;
    field.Type = type;
    return field;
};

const addCustomField = (
    credential: Credential,
    name: string,
    value: unknown,
    type?: CustomFieldType,
) => {
    const field = makeCustomField(name, value, type);
    if (field) credential.CustomFields.push(field);
};

const ensureUniqueCustomFieldIDs = (credential: Credential): Credential => {
    const seen = new Set<string>();
    credential.CustomFields = (credential.CustomFields ?? []).map(
        (field, index) => {
            const candidate = field.ID?.trim();
            if (candidate && candidate !== "-1" && !seen.has(candidate)) {
                seen.add(candidate);
                return field;
            }

            const nextID = `import-field-${credential.Name}-${index + 1}`;
            seen.add(nextID);
            return {
                ...field,
                ID: nextID,
            };
        },
    );
    return credential;
};

const makeDirectory = (id: string, name: string): Directory => ({
    ID: id || name,
    Name: name || "Imported",
    Version: 0,
    Hash: "",
    DateModifiedTimestamp: Date.now(),
    Deleted: false,
});

const makeCredential = (data: {
    type?: ItemType;
    directoryId?: string;
    name?: string;
    username?: string;
    password?: string;
    url?: string;
    notes?: string;
    tags?: string;
    createdAt?: number;
    modifiedAt?: number;
    passwordChangedAt?: number;
}): Credential => {
    const now = Date.now();
    const createdAt = data.createdAt ?? now;
    return {
        ID: "",
        Version: 0,
        Type: data.type ?? ItemType.Credentials,
        DirectoryID: data.directoryId ?? "",
        Name: data.name?.trim() || "Unnamed item",
        Username: data.username ?? "",
        Password: data.password ?? "",
        Tags: data.tags,
        URL: data.url ?? "",
        Notes: data.notes ?? "",
        CustomFields: [],

        // TODO: Remove these fields after August 2026
        DateCreated: "",
        DateModified: undefined,
        DatePasswordChanged: undefined,

        DateCreatedTimestamp: createdAt,
        DateModifiedTimestamp: data.modifiedAt ?? createdAt,
        DatePasswordChangedTimestamp: data.passwordChangedAt ?? createdAt,
        Deleted: false,
        Hash: "",
    };
};

const mapTotpAlgorithm = (algorithm: string): TOTPAlgorithm => {
    const normalized = algorithm.toUpperCase();
    if (normalized in TOTPAlgorithm) {
        return TOTPAlgorithm[normalized as keyof typeof TOTPAlgorithm];
    }
    return TOTPAlgorithm.SHA1;
};

const normalizeTotp = (raw: unknown): TOTP | undefined => {
    const value = asString(raw);
    if (!value) return undefined;

    const totp = new TOTP();
    if (!value.toLowerCase().startsWith("otpauth://")) {
        totp.Secret = value;
        return totp;
    }

    try {
        const parsed = OTPAuth.URI.parse(value);
        if (!(parsed instanceof OTPAuth.TOTP)) {
            return undefined;
        }

        totp.Secret = parsed.secret.base32;
        totp.Label = parsed.issuer
            ? `${parsed.issuer}:${parsed.label}`
            : parsed.label;
        totp.Period = parsed.period;
        totp.Digits = parsed.digits;
        totp.Algorithm = mapTotpAlgorithm(parsed.algorithm);
    } catch {
        totp.Secret = value;
    }

    return totp;
};

const appendNotes = (...parts: Array<string | undefined>): string =>
    parts
        .map((part) => part?.trim())
        .filter(Boolean)
        .join("\n\n");

export const CSVGetColNames = (
    file: File,
    onSuccess: (columnNames: string[]) => void,
    onFailure: (error: Error) => void,
): void => {
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
        // Keep parsing on the main thread: blob workers require relaxing CSP for plaintext secret imports.
        worker: false,
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
                        DirectoryID: "",
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
    directories: Directory[];
}> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

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
            const directories: Directory[] = [];

            // NOTE: The whole thing is wrapped in a try-catch block because we need to reject the promise if something goes wrong
            try {
                const json = reader.result as string;
                const parsed = JSON.parse(json) as BitwardenJSON;
                if (parsed.encrypted) {
                    throw new Error(
                        "Encrypted Bitwarden exports are unsupported",
                    );
                }
                if (!Array.isArray(parsed.items)) {
                    throw new Error("Bitwarden export is missing items");
                }

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
                        DirectoryID: item.folderId ?? "",
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

                    credential.TOTP = normalizeTotp(item.login?.totp);

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

                    item.login?.uris?.slice(1).forEach((uri, index) => {
                        addCustomField(
                            credential,
                            `Bitwarden URI ${index + 2}`,
                            uri.uri,
                        );
                    });
                    addCustomField(credential, "Bitwarden item ID", item.id);
                    addCustomField(
                        credential,
                        "Bitwarden favorite",
                        (item as { favorite?: boolean }).favorite,
                        CustomFieldType.Boolean,
                    );

                    credentials.push(ensureUniqueCustomFieldIDs(credential));
                }

                if (parsed.folders) {
                    parsed.folders.forEach((folder) => {
                        directories.push(makeDirectory(folder.id, folder.name));
                    });
                }
            } catch (error) {
                reject(error);
            }

            resolve({
                credentials,
                directories,
            });
        };

        reader.onerror = () => {
            reject(reader.error);
        };

        reader.readAsText(file);
    });
};

const parseBitwardenJSON = async (file: File): Promise<ImportResult> => {
    const parsed = await BitwardenJSON(file);
    const warnings: ImportWarning[] = [];
    const text = await readFileAsText(file);
    const raw = JSON.parse(text) as {
        items?: Array<
            BitwardenItem & {
                attachments?: unknown[];
                fido2Credentials?: unknown[];
                favorite?: boolean;
                collectionIds?: unknown[];
                organizationId?: string;
                reprompt?: number;
                secureNote?: unknown;
                identity?: Record<string, unknown>;
                card?: Record<string, unknown>;
                sshKey?: Record<string, unknown>;
            }
        >;
    };

    raw.items?.forEach((item, index) => {
        const credential = parsed.credentials[index];
        if (!credential) return;

        if (item.type === 3 && item.card) {
            credential.Type = ItemType.Credentials;
            credential.Notes = appendNotes(
                credential.Notes,
                "Imported from Bitwarden card item.",
            );
            addCustomField(
                credential,
                "Cardholder name",
                item.card.cardholderName,
            );
            addCustomField(credential, "Card brand", item.card.brand);
            addCustomField(
                credential,
                "Card number",
                item.card.number,
                CustomFieldType.MaskedText,
            );
            addCustomField(credential, "Card expiry month", item.card.expMonth);
            addCustomField(credential, "Card expiry year", item.card.expYear);
            addCustomField(
                credential,
                "Card security code",
                item.card.code,
                CustomFieldType.MaskedText,
            );
        }

        if (item.type === 4 && item.identity) {
            credential.Type = ItemType.Identity;
            for (const [key, value] of Object.entries(item.identity)) {
                addCustomField(credential, `Identity ${key}`, value);
            }
        }

        if (item.sshKey) {
            credential.Type = ItemType.SSHKey;
            for (const [key, value] of Object.entries(item.sshKey)) {
                addCustomField(
                    credential,
                    `SSH ${key}`,
                    value,
                    key.toLowerCase().includes("private")
                        ? CustomFieldType.MaskedText
                        : CustomFieldType.Text,
                );
            }
        }

        if (item.passwordHistory?.length) {
            item.passwordHistory.forEach((entry, historyIndex) => {
                addCustomField(
                    credential,
                    `Password history ${historyIndex + 1}`,
                    entry.password,
                    CustomFieldType.MaskedText,
                );
                addCustomField(
                    credential,
                    `Password history ${historyIndex + 1} date`,
                    entry.lastUsedDate,
                );
            });
        }

        addCustomField(credential, "Bitwarden reprompt", item.reprompt);
        addCustomField(
            credential,
            "Bitwarden organization",
            item.organizationId,
        );
        addCustomField(
            credential,
            "Bitwarden collections",
            Array.isArray(item.collectionIds)
                ? item.collectionIds.join(", ")
                : undefined,
        );

        if (item.attachments?.length) {
            warnings.push({
                code: "BITWARDEN_ATTACHMENTS_UNSUPPORTED",
                itemName: item.name,
                message: `Attachments on "${item.name}" were not imported.`,
            });
        }
        if (item.fido2Credentials?.length) {
            warnings.push({
                code: "BITWARDEN_PASSKEYS_UNSUPPORTED",
                itemName: item.name,
                message: `Passkeys on "${item.name}" were not imported.`,
            });
        }
    });

    return {
        source: "bitwarden-json",
        credentials: parsed.credentials,
        directories: parsed.directories,
        warnings,
        skipped: 0,
    };
};

const parseGenericCsv = async (
    file: File,
    source: ImportSource,
): Promise<ImportResult> => {
    const rows = await parseCsvRows<Record<string, unknown>>(file);
    const directories = new Map<string, Directory>();
    const credentials: Credential[] = [];
    const warnings: ImportWarning[] = [];

    for (const row of rows) {
        const name =
            firstValue(row, "name", "title", "site", "account", "service") ||
            firstValue(row, "url", "website", "uri", "web site") ||
            "Imported item";
        const groupName = firstValue(
            row,
            "grouping",
            "group",
            "folder",
            "tags",
        );
        const directoryId = groupName ? `import-directory:${groupName}` : "";
        if (groupName && !directories.has(directoryId)) {
            directories.set(directoryId, makeDirectory(directoryId, groupName));
        }

        const credential = makeCredential({
            name,
            directoryId,
            username: firstValue(row, "username", "user", "login", "email"),
            password: firstValue(row, "password", "pass"),
            url: firstValue(row, "url", "website", "uri", "web site"),
            notes: firstValue(row, "notes", "note", "extra", "comments"),
            tags: joinTags([
                firstValue(row, "tags", "tag"),
                source === "lastpass-csv" ? firstValue(row, "fav") : "",
            ]),
            createdAt: parseTimestamp(
                firstValue(
                    row,
                    "datecreatedtimestamp",
                    "created",
                    "timeCreated",
                ),
            ),
            modifiedAt: parseTimestamp(
                firstValue(
                    row,
                    "datemodifiedtimestamp",
                    "updated",
                    "timeLastUsed",
                ),
            ),
            passwordChangedAt: parseTimestamp(
                firstValue(
                    row,
                    "datepasswordchangedtimestamp",
                    "passwordchangedat",
                    "timePasswordChanged",
                ),
            ),
        });

        const totp = normalizeTotp(
            firstValue(
                row,
                "totp",
                "2fa",
                "otp",
                "otpauth",
                "one-time password",
                "one-time password",
                "authenticator",
            ),
        );
        if (totp) credential.TOTP = totp;

        if (source === "firefox-csv" && !firstValue(row, "name", "title")) {
            try {
                credential.Name =
                    new URL(credential.URL).hostname || credential.Name;
            } catch {
                addCustomField(
                    credential,
                    "Firefox form action origin",
                    firstValue(row, "formActionOrigin"),
                );
            }
        }

        addCustomField(credential, "Source import", ImportSourceLabels[source]);
        credentials.push(credential);
    }

    if (!credentials.length) {
        warnings.push({
            code: "EMPTY_IMPORT",
            message: "File did not contain importable credentials.",
        });
    }

    return {
        source,
        credentials,
        directories: Array.from(directories.values()),
        warnings,
        skipped: 0,
    };
};

const getDirectChildText = (element: Element, tag: string): string => {
    for (const child of Array.from(element.children)) {
        if (child.tagName.toLowerCase() === tag.toLowerCase()) {
            return child.textContent?.trim() ?? "";
        }
    }
    return "";
};

const parseKeePassXML = async (file: File): Promise<ImportResult> => {
    const text = await readFileAsText(file);
    const doc = new DOMParser().parseFromString(text, "application/xml");
    const parserError = doc.querySelector("parsererror");
    if (parserError) throw new Error("Invalid KeePass XML");

    const directories: Directory[] = [];
    const credentials: Credential[] = [];
    const warnings: ImportWarning[] = [];

    const readEntryStrings = (entry: Element) => {
        const values: Record<string, string> = {};
        entry.querySelectorAll(":scope > String").forEach((stringElement) => {
            const key = getDirectChildText(stringElement, "Key");
            const value = getDirectChildText(stringElement, "Value");
            if (key) values[key] = value;
        });
        return values;
    };

    const walkGroup = (groupElement: Element, parentPath = "") => {
        const name = getDirectChildText(groupElement, "Name") || "KeePass";
        const uuid = getDirectChildText(groupElement, "UUID");
        const path = parentPath ? `${parentPath}/${name}` : name;
        const directoryId = uuid || `keepass:${path}`;
        directories.push(makeDirectory(directoryId, path));

        groupElement.querySelectorAll(":scope > Entry").forEach((entry) => {
            const values = readEntryStrings(entry);
            const times = entry.querySelector(":scope > Times");
            const credential = makeCredential({
                directoryId,
                name: values.Title,
                username: values.UserName,
                password: values.Password,
                url: values.URL,
                notes: values.Notes,
                tags: values.Tags,
                createdAt: parseTimestamp(
                    times?.querySelector("CreationTime")?.textContent,
                ),
                modifiedAt: parseTimestamp(
                    times?.querySelector("LastModificationTime")?.textContent,
                ),
            });

            const totpValue =
                values["otp"] ??
                values["TOTP Seed"] ??
                values["TimeOtp-Secret-Base32"];
            const totp = normalizeTotp(totpValue);
            if (totp) credential.TOTP = totp;

            for (const [key, value] of Object.entries(values)) {
                if (
                    [
                        "Title",
                        "UserName",
                        "Password",
                        "URL",
                        "Notes",
                        "Tags",
                    ].includes(key) ||
                    key.toLowerCase().includes("otp")
                ) {
                    continue;
                }
                addCustomField(credential, key, value);
            }

            credentials.push(credential);
        });

        groupElement
            .querySelectorAll(":scope > Group")
            .forEach((child) => walkGroup(child, path));
    };

    const rootGroup = doc.querySelector("KeePassFile > Root > Group");
    if (!rootGroup) {
        warnings.push({
            code: "KEEPASS_NO_ROOT_GROUP",
            message: "KeePass XML did not include a root group.",
        });
    } else {
        walkGroup(rootGroup);
    }

    return {
        source: "keepass-xml",
        credentials,
        directories,
        warnings,
        skipped: 0,
    };
};

const parseOnePassword1Pux = async (file: File): Promise<ImportResult> => {
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const exportData = zip.file("export.data");
    if (!exportData) throw new Error("1PUX archive missing export.data");

    const data = JSON.parse(await exportData.async("string")) as {
        accounts?: Array<{
            vaults?: Array<{
                attrs?: { name?: string; uuid?: string };
                items?: Array<{
                    uuid?: string;
                    title?: string;
                    createdAt?: number;
                    updatedAt?: number;
                    state?: string;
                    tags?: string[];
                    overview?: { urls?: Array<{ url?: string }>; url?: string };
                    details?: {
                        notesPlain?: string;
                        notes?: string;
                        loginFields?: Array<{
                            designation?: string;
                            name?: string;
                            value?: string;
                        }>;
                        fields?: Array<{
                            title?: string;
                            id?: string;
                            value?: { concealed?: string; string?: string };
                            type?: string;
                        }>;
                    };
                }>;
            }>;
        }>;
    };

    const directories: Directory[] = [];
    const credentials: Credential[] = [];
    const warnings: ImportWarning[] = [];
    let skipped = 0;

    for (const account of data.accounts ?? []) {
        for (const vault of account.vaults ?? []) {
            const directoryId =
                vault.attrs?.uuid || `1pux:${vault.attrs?.name}`;
            directories.push(
                makeDirectory(directoryId, vault.attrs?.name || "1Password"),
            );

            for (const item of vault.items ?? []) {
                if (item.state === "archived" || item.state === "deleted") {
                    skipped += 1;
                    continue;
                }
                const loginFields = item.details?.loginFields ?? [];
                const username =
                    loginFields.find((f) => f.designation === "username")
                        ?.value ?? "";
                const password =
                    loginFields.find((f) => f.designation === "password")
                        ?.value ?? "";
                const url =
                    item.overview?.url ??
                    item.overview?.urls?.find((entry) => entry.url)?.url ??
                    "";
                const credential = makeCredential({
                    directoryId,
                    name: item.title,
                    username,
                    password,
                    url,
                    notes:
                        item.details?.notesPlain ?? item.details?.notes ?? "",
                    tags: joinTags(item.tags ?? []),
                    createdAt: parseTimestamp(item.createdAt),
                    modifiedAt: parseTimestamp(item.updatedAt),
                });

                for (const field of item.details?.fields ?? []) {
                    const value = field.value?.concealed ?? field.value?.string;
                    const type =
                        field.value?.concealed != null
                            ? CustomFieldType.MaskedText
                            : CustomFieldType.Text;
                    addCustomField(
                        credential,
                        field.title || field.id || "1Password field",
                        value,
                        type,
                    );
                    if (
                        (field.title ?? field.id ?? "")
                            .toLowerCase()
                            .includes("one-time password")
                    ) {
                        const totp = normalizeTotp(value);
                        if (totp) credential.TOTP = totp;
                    }
                }

                addCustomField(credential, "1Password item ID", item.uuid);
                credentials.push(credential);
            }
        }
    }

    if (zip.folder("files")) {
        warnings.push({
            code: "ONEPASSWORD_ATTACHMENTS_UNSUPPORTED",
            message: "1Password attachments/documents were not imported.",
        });
    }

    return {
        source: "onepassword-1pux",
        credentials,
        directories,
        warnings,
        skipped,
    };
};

const parseCryptexJSON = async (file: File): Promise<ImportResult> => {
    const parsed = JSON.parse(await readFileAsText(file)) as {
        Directories?: Directory[];
        Credentials?: Credential[];
    };

    if (
        !Array.isArray(parsed.Directories) ||
        !Array.isArray(parsed.Credentials)
    ) {
        throw new Error("Invalid Cryptex Vault export");
    }

    const warnings: ImportWarning[] = [];
    let skipped = 0;
    const credentials = parsed.Credentials.flatMap((rawCredential) => {
        if (rawCredential.Deleted) {
            skipped += 1;
            return [];
        }

        const credential = Object.assign(new VaultCredential(), rawCredential);
        if (rawCredential.TOTP) {
            credential.TOTP =
                typeof rawCredential.TOTP.Secret === "string" &&
                rawCredential.TOTP.Secret.toLowerCase().startsWith("otpauth://")
                    ? normalizeTotp(rawCredential.TOTP.Secret)
                    : Object.assign(new TOTP(), rawCredential.TOTP);
        }
        credential.CustomFields = rawCredential.CustomFields ?? [];
        return [ensureUniqueCustomFieldIDs(credential)];
    });

    if (skipped) {
        warnings.push({
            code: "CRYPTEX_DELETED_ITEMS_SKIPPED",
            message: `${skipped} deleted Cryptex item(s) were skipped.`,
        });
    }

    return {
        source: "cryptex-json",
        credentials,
        directories: parsed.Directories,
        warnings,
        skipped,
    };
};

export const parseImportFile = async (
    source: ImportSource,
    file: File,
): Promise<ImportResult> => {
    switch (source) {
        case "cryptex-json":
            return parseCryptexJSON(file);
        case "bitwarden-json":
            return parseBitwardenJSON(file);
        case "onepassword-1pux":
            return parseOnePassword1Pux(file);
        case "keepass-xml":
            return parseKeePassXML(file);
        case "onepassword-csv":
        case "keepass-csv":
        case "lastpass-csv":
        case "chrome-csv":
        case "firefox-csv":
            return parseGenericCsv(file, source);
        default:
            throw new Error("Unsupported import source");
    }
};

export const applyImportToVault = async (
    vault: Vault,
    result: Pick<ImportResult, "credentials" | "directories">,
): Promise<ApplyImportResult> => {
    const vaultCopy = Object.assign(new Vault(), vault);
    vaultCopy.Directories = [...(vault.Directories ?? [])];
    vaultCopy.Credentials = [...(vault.Credentials ?? [])];

    let importedDirectories = 0;
    const directoryIdMap = new Map<string, string>();
    for (const directory of result.directories) {
        const existing =
            vaultCopy.Directories.find(
                (item) =>
                    !item.Deleted &&
                    (item.ID === directory.ID ||
                        item.Name.localeCompare(directory.Name, undefined, {
                            sensitivity: "base",
                        }) === 0),
            ) ?? null;
        const merged =
            existing ??
            (await createDirectory(vaultCopy.Directories, {
                ID: null,
                Name: directory.Name,
            }));
        if (!existing) {
            importedDirectories += 1;
        }
        directoryIdMap.set(directory.ID, merged.ID);
    }

    for (const credential of result.credentials) {
        const directoryID = directoryIdMap.get(credential.DirectoryID);
        const credentialToImport = directoryID
            ? {
                  ...credential,
                  DirectoryID: directoryID,
              }
            : { ...credential, DirectoryID: "" };
        const assimilated = await assimilateImportedCredential(
            ensureUniqueCustomFieldIDs(credentialToImport),
        );
        vaultCopy.Credentials.push(
            Object.assign(new VaultCredential(), assimilated),
        );
    }

    return {
        vault: vaultCopy,
        importedCredentials: result.credentials.length,
        importedDirectories,
    };
};
