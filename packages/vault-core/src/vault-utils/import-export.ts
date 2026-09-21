import JSZip from "jszip";
import Papa from "papaparse";

import { CredentialConstants, TOTPConstants } from "../consts";
import { isCredentialUrlRuleValid } from "../credential-url";
import {
    type Credential,
    CredentialURLMatchMode,
    type CredentialURL,
    CustomFieldType,
    ItemType,
    type PasskeyData,
    TOTPAlgorithm,
} from "../proto/vault";
import {
    assimilateImportedCredential,
    createDirectory,
    CredentialFormSchema,
    CustomField,
    type Directory,
    parseTOTPURI,
    TOTP,
    Vault,
    VaultCredential,
} from "./vault";

/** Sanitized cleartext JSON for migration export (no download side effects). */
export const vaultToJSONString = (vaultInstance: Vault): string => {
    const sanitizedVault = {
        Directories: vaultInstance.Directories.filter((item) => !item.Deleted),
        Credentials: vaultInstance.Credentials,
    };
    return JSON.stringify(sanitizedVault, null, 4);
};

export const vaultToJSON = (vaultInstance: Vault) => {
    const blob = new Blob([vaultToJSONString(vaultInstance)], {
        type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `cryptexvault-export-${Date.now()}.json`;
    anchor.click();
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

export type ImportNoticeKind =
    | "items-skipped"
    | "saved-differently"
    | "not-imported";

export type ImportNotice = {
    code: string;
    kind: ImportNoticeKind;
    title: string;
    detail?: string;
    count: number;
    itemNames: string[];
    requiresConfirmation?: boolean;
};

export type ImportResult = {
    source: ImportSource;
    credentials: Credential[];
    directories: Directory[];
    notices: ImportNotice[];
    skippedItems: number;
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

export const MAX_IMPORT_FILE_BYTES = 1024 * 1024 * 1024;

export class ImportFileError extends Error {
    public readonly code: string;

    constructor(code: string, message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = "ImportFileError";
        this.code = code;
    }
}

export const getImportErrorMessage = (error: unknown): string =>
    error instanceof ImportFileError
        ? error.message
        : "Could not parse this export file. Check that the selected source and file match.";

const asString = (value: unknown): string => {
    if (value == null) return "";
    if (typeof value === "string") return value;
    if (
        typeof value === "number" ||
        typeof value === "boolean" ||
        typeof value === "bigint"
    ) {
        return value.toString();
    }
    return JSON.stringify(value) ?? "";
};

const hasValue = (value: unknown): boolean =>
    value != null && asString(value).length > 0;

const isRecord = (value: unknown): value is Record<string, unknown> =>
    value != null && typeof value === "object" && !Array.isArray(value);

const normalizedKey = (value: string): string =>
    value
        .replace(/^\uFEFF/u, "")
        .trim()
        .toLowerCase();

const readFileAsText = (file: File): Promise<string> =>
    typeof file.text === "function"
        ? file.text()
        : new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => {
                  if (typeof reader.result === "string") {
                      resolve(reader.result);
                  } else if (reader.result instanceof ArrayBuffer) {
                      resolve(new TextDecoder().decode(reader.result));
                  } else {
                      resolve("");
                  }
              };
              reader.onerror = () => reject(reader.error);
              reader.readAsText(file);
          });

const readFileAsArrayBuffer = (file: File): Promise<ArrayBuffer> =>
    typeof file.arrayBuffer === "function"
        ? file.arrayBuffer()
        : new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => {
                  if (reader.result instanceof ArrayBuffer) {
                      resolve(reader.result);
                  } else {
                      reject(new Error("File did not contain binary data"));
                  }
              };
              reader.onerror = () => reject(reader.error);
              reader.readAsArrayBuffer(file);
          });

const parseJsonFile = async <T>(file: File, sourceName: string): Promise<T> => {
    try {
        return JSON.parse(await readFileAsText(file)) as T;
    } catch (error) {
        throw new ImportFileError(
            "INVALID_JSON",
            `${sourceName} export is not valid JSON.`,
            { cause: error },
        );
    }
};

type CsvDocument = {
    rows: Record<string, string>[];
    headers: string[];
};

const parseCsvText = (
    text: string,
    source: ImportSource,
    escapeChar?: string,
): CsvDocument => {
    const parsed = Papa.parse<Record<string, string>>(text, {
        header: true,
        skipEmptyLines: "greedy",
        transformHeader: (header) => header.replace(/^\uFEFF/u, "").trim(),
        ...(escapeChar ? { escapeChar } : {}),
    });
    if (parsed.errors.length > 0) {
        const first = parsed.errors[0];
        throw new ImportFileError(
            "INVALID_CSV",
            `${ImportSourceLabels[source]} could not be read as CSV${first?.row == null ? "." : ` near row ${first.row + 1}.`}`,
        );
    }
    const headers = parsed.meta.fields ?? [];
    if (headers.length === 0) {
        throw new ImportFileError(
            "CSV_HEADERS_MISSING",
            `${ImportSourceLabels[source]} is missing its header row.`,
        );
    }
    return { rows: parsed.data, headers };
};

const parseCsvDocument = async (
    file: File,
    source: ImportSource,
): Promise<CsvDocument> => parseCsvText(await readFileAsText(file), source);

const assertCsvHeaders = (
    document: CsvDocument,
    source: ImportSource,
    required: string[],
) => {
    const actual = new Set(document.headers.map(normalizedKey));
    const missing = required.filter(
        (header) => !actual.has(normalizedKey(header)),
    );
    if (missing.length > 0) {
        throw new ImportFileError(
            "CSV_SCHEMA_MISMATCH",
            `${ImportSourceLabels[source]} is missing required column${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}. Check that the selected source matches the export file.`,
        );
    }
};

const rowEntry = (
    row: Record<string, string>,
    ...names: string[]
): [string, string] | undefined => {
    const wanted = new Set(names.map(normalizedKey));
    return Object.entries(row).find(([key]) => wanted.has(normalizedKey(key)));
};

const rowValue = (row: Record<string, string>, ...names: string[]): string =>
    rowEntry(row, ...names)?.[1] ?? "";

const parseTimestamp = (value: unknown): number | undefined => {
    if (!hasValue(value)) return undefined;
    const raw = asString(value);
    const numeric = Number(raw);
    if (Number.isFinite(numeric)) {
        if (Math.abs(numeric) >= 100_000_000_000_000) return numeric / 1000;
        if (Math.abs(numeric) < 10_000_000_000) return numeric * 1000;
        return numeric;
    }
    const parsed = new Date(raw).getTime();
    return Number.isFinite(parsed) ? parsed : undefined;
};

const parseBoolean = (value: unknown): boolean | undefined => {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    if (typeof value !== "string" || value.length === 0) return undefined;
    const normalized = value.trim().toLowerCase();
    if (
        ["1", "true", "yes", "y", "favorite", "archived"].includes(normalized)
    ) {
        return true;
    }
    if (["0", "false", "no", "n", "none", "active"].includes(normalized)) {
        return false;
    }
    return undefined;
};

const encodeTags = (tags: string[]): string | undefined => {
    const present = tags.filter((tag) => tag.length > 0);
    return present.length
        ? present.join(CredentialConstants.TAG_SEPARATOR)
        : undefined;
};

const splitTags = (
    value: string | undefined,
    delimiter: string | RegExp,
): string[] =>
    (value ?? "")
        .split(delimiter)
        .map((tag) => tag.trim())
        .filter(Boolean);

type PendingImportNotice = Omit<ImportNotice, "count" | "itemNames"> & {
    count?: number;
    itemName?: string;
};

const addImportNotice = (
    notices: ImportNotice[],
    notice: PendingImportNotice,
) => {
    const count = notice.count ?? 1;
    if (count < 1) return;
    const existing = notices.find((entry) => entry.code === notice.code);
    if (existing) {
        existing.count += count;
        if (notice.itemName) existing.itemNames.push(notice.itemName);
        return;
    }
    notices.push({
        code: notice.code,
        kind: notice.kind,
        title: notice.title,
        detail: notice.detail,
        count,
        itemNames: notice.itemName ? [notice.itemName] : [],
        requiresConfirmation: notice.requiresConfirmation,
    });
};

const addCustomField = (
    credential: Credential,
    name: string,
    value: unknown,
    type: CustomFieldType = CustomFieldType.Text,
) => {
    const booleanValue =
        type === CustomFieldType.Boolean ? parseBoolean(value) : undefined;
    const fieldType =
        type === CustomFieldType.Boolean && booleanValue == null
            ? CustomFieldType.Text
            : type;
    const stringValue =
        booleanValue == null ? asString(value) : String(booleanValue);
    if (!name.trim() || stringValue.length === 0) return;
    const field = new CustomField();
    field.Name = name.trim();
    field.Value = stringValue;
    field.Type = fieldType;
    credential.CustomFields.push(field);
};

const addUnknownScalarFields = (
    credential: Credential,
    source: Record<string, unknown> | undefined,
    prefix: string,
    consumedKeys: string[],
) => {
    if (!source) return;
    const consumed = new Set(consumedKeys.map(normalizedKey));
    for (const [key, value] of Object.entries(source)) {
        if (
            consumed.has(normalizedKey(key)) ||
            !["string", "number", "boolean"].includes(typeof value)
        ) {
            continue;
        }
        addCustomField(credential, `${prefix} ${key}`, value);
    }
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
            let nextID = `import-field-${index + 1}`;
            while (seen.has(nextID)) nextID += "-copy";
            seen.add(nextID);
            return { ...field, ID: nextID };
        },
    );
    return credential;
};

const safeDirectoryName = (name: string): string => {
    const normalized = name.trim() || "Imported";
    return normalized.length <= 100
        ? normalized
        : `${normalized.slice(0, 97)}...`;
};

const addFolderAdjustmentNotice = (
    notices: ImportNotice[],
    count = 1,
    itemName?: string,
) =>
    addImportNotice(notices, {
        code: "FOLDER_STRUCTURE_ADJUSTED",
        kind: "saved-differently",
        title: "Folder structure will be adjusted",
        detail: "Nested paths become folder names, long names are shortened, and items whose source folder is missing are added without a folder.",
        count,
        itemName,
    });

const makeDirectory = (id: string, name: string): Directory => ({
    ID: id || name,
    Name: safeDirectoryName(name),
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
    notes?: string;
    tags?: string;
    createdAt?: number;
    modifiedAt?: number;
    passwordChangedAt?: number;
}): Credential => {
    const now = Date.now();
    const createdAt = data.createdAt ?? now;
    const name = data.name ?? "";
    return {
        ID: "",
        Version: 0,
        Type: data.type ?? ItemType.Credentials,
        DirectoryID: data.directoryId ?? "",
        Name: name.trim() ? name : "Unnamed item",
        Username: data.username ?? "",
        Password: data.password ?? "",
        Tags: data.tags,
        URL: "",
        URLMatchMode: CredentialURLMatchMode.ExactHost,
        AdditionalURLs: [],
        Notes: data.notes ?? "",
        CustomFields: [],
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

const finishCredential = (credential: Credential): Credential => {
    credential.CustomFields = credential.CustomFields.map((field) =>
        field.Type === CustomFieldType.Date
            ? { ...field, Type: CustomFieldType.Text }
            : field,
    );
    return ensureUniqueCustomFieldIDs(credential);
};

const assignNativeUrls = (
    credential: Credential,
    candidates: Array<CredentialURL & { label?: string }>,
    sourceLabel: string,
    notices: ImportNotice[],
) => {
    const supported: CredentialURL[] = credential.URL
        ? [
              {
                  URL: credential.URL,
                  MatchMode: credential.URLMatchMode,
              },
              ...credential.AdditionalURLs,
          ]
        : [...credential.AdditionalURLs];
    const seen = new Set<string>();
    supported.forEach((rule) =>
        seen.add(`${rule.MatchMode}:${rule.URL.trim().toLowerCase()}`),
    );
    const existingCount = supported.length;
    candidates.forEach((candidate, index) => {
        if (candidate.label) {
            addCustomField(
                credential,
                `${sourceLabel} URL ${existingCount + index + 1} label`,
                candidate.label,
            );
        }
        if (!candidate.URL) return;
        if (isCredentialUrlRuleValid(candidate)) {
            const key = `${candidate.MatchMode}:${candidate.URL.trim().toLowerCase()}`;
            if (seen.has(key)) return;
            seen.add(key);
            supported.push({
                URL: candidate.URL,
                MatchMode: candidate.MatchMode,
            });
        } else {
            addCustomField(
                credential,
                `${sourceLabel} URL ${index + 1}`,
                candidate.URL,
            );
            addImportNotice(notices, {
                code: "URL_SAVED_AS_TEXT",
                kind: "saved-differently",
                title: "Website addresses will be saved as text",
                detail: "Cryptex Vault cannot use these addresses for autofill.",
                itemName: credential.Name,
            });
        }
    });
    const [primary, ...additional] = supported;
    if (primary) {
        credential.URL = primary.URL;
        credential.URLMatchMode = primary.MatchMode;
        credential.AdditionalURLs = additional;
    }
};

const assignTotp = (
    credential: Credential,
    raw: unknown,
    notices: ImportNotice[],
    sourceLabel: string,
    fieldName = `${sourceLabel} additional authenticator`,
) => {
    const value = asString(raw);
    if (!value) return;
    const normalized = value.trim().toLowerCase();
    const preserveUnsupported = (kind: string, message: string) => {
        addCustomField(
            credential,
            `${sourceLabel} ${kind} configuration`,
            value,
            CustomFieldType.MaskedText,
        );
        addImportNotice(notices, {
            code: "TOTP_CONFIGURATION_UNSUPPORTED",
            kind: "saved-differently",
            title: "Authenticator setups will be saved as hidden text",
            detail: message,
            itemName: credential.Name,
            requiresConfirmation: true,
        });
    };
    if (normalized.startsWith("otpauth://hotp/")) {
        preserveUnsupported(
            "HOTP",
            "Cryptex Vault cannot generate codes from HOTP configurations, so they will be preserved as hidden custom fields.",
        );
        return;
    }
    if (normalized.startsWith("otpauth://")) {
        try {
            const uri = new URL(value.trim());
            const algorithm = uri.searchParams
                .get("algorithm")
                ?.toUpperCase()
                .replaceAll("-", "");
            if (
                algorithm &&
                !["SHA1", "SHA256", "SHA512"].includes(algorithm)
            ) {
                throw new Error("Unsupported OTP algorithm");
            }
            const parsed = parseTOTPURI(value.trim());
            if (!/^[A-Z2-7]+=*$/iu.test(parsed.Secret)) {
                throw new Error("Invalid OTP secret");
            }
            if (credential.TOTP) {
                addCustomField(
                    credential,
                    fieldName,
                    value,
                    CustomFieldType.MaskedText,
                );
            } else {
                credential.TOTP = parsed;
            }
        } catch {
            preserveUnsupported(
                "OTP",
                "Cryptex Vault cannot generate codes from invalid or unsupported one-time-password configurations, so they will be preserved as hidden custom fields.",
            );
        }
        return;
    }
    if (!/^[A-Z2-7]+=*$/iu.test(value)) {
        preserveUnsupported(
            "authenticator",
            "Invalid authenticator secrets will be preserved as hidden custom fields.",
        );
        return;
    }
    const totp = new TOTP();
    totp.Secret = value;
    if (credential.TOTP) {
        addCustomField(
            credential,
            fieldName,
            value,
            CustomFieldType.MaskedText,
        );
    } else {
        credential.TOTP = totp;
    }
};

const addUnknownCsvFields = (
    credential: Credential,
    row: Record<string, string>,
    consumedHeaders: string[],
) => {
    const consumed = new Set(consumedHeaders.map(normalizedKey));
    for (const [header, value] of Object.entries(row)) {
        if (consumed.has(normalizedKey(header)) || !hasValue(value)) continue;
        addCustomField(credential, header, value, CustomFieldType.Text);
    }
};

interface BitwardenPasskey {
    credentialId?: string;
    keyType?: string;
    keyAlgorithm?: string;
    keyCurve?: string;
    keyValue?: string;
    rpId?: string;
    userHandle?: string;
    userName?: string;
    counter?: string | number;
    rpName?: string;
    userDisplayName?: string;
    discoverable?: string | boolean;
    creationDate?: string;
}

interface BitwardenItem {
    id?: string;
    folderId?: string;
    organizationId?: string;
    collectionIds?: string[];
    name?: string;
    notes?: string;
    favorite?: boolean;
    archived?: boolean;
    reprompt?: number;
    creationDate?: string;
    revisionDate?: string;
    passwordRevisionDate?: string;
    deletedDate?: string | null;
    type?: number;
    login?: {
        username?: string;
        password?: string;
        totp?: string;
        uris?: Array<{ match?: string | number | null; uri?: string }>;
        fido2Credentials?: BitwardenPasskey[];
    };
    secureNote?: Record<string, unknown>;
    card?: Record<string, unknown>;
    identity?: Record<string, unknown>;
    sshKey?: Record<string, unknown>;
    fields?: Array<{
        name?: string;
        value?: string | null;
        type?: number;
        linkedId?: number;
    }>;
    passwordHistory?: Array<{ password?: string; lastUsedDate?: string }>;
    attachments?: unknown[];
}

interface BitwardenExport {
    encrypted?: boolean;
    folders?: Array<{ id?: string; name?: string }>;
    items?: BitwardenItem[];
}

const bitwardenItemType = (type: number | undefined): ItemType => {
    if (type === 2) return ItemType.Note;
    if (type === 4) return ItemType.Identity;
    if (type === 5) return ItemType.SSHKey;
    return ItemType.Credentials;
};

const bitwardenUriMode = (match: string | number | null | undefined) => {
    if (match == null || Number(match) === 0) {
        return {
            supported: true,
            mode: CredentialURLMatchMode.Domain,
        } as const;
    }
    if (Number(match) === 1) {
        return {
            supported: true,
            mode: CredentialURLMatchMode.ExactHost,
        } as const;
    }
    const names: Record<number, string> = {
        2: "Starts with",
        3: "Exact URL",
        4: "Regular expression",
        5: "Never",
    };
    return {
        supported: false,
        name: names[Number(match)] ?? `Unknown (${asString(match)})`,
    } as const;
};

const base64UrlBytes = (value: string): Uint8Array => {
    const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const binary = atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const convertBitwardenPasskey = async (
    source: BitwardenPasskey,
): Promise<PasskeyData> => {
    if (
        source.keyType !== "public-key" ||
        source.keyAlgorithm?.toUpperCase() !== "ECDSA" ||
        source.keyCurve?.toUpperCase() !== "P-256" ||
        !source.keyValue ||
        !source.credentialId ||
        !source.rpId
    ) {
        throw new Error("Unsupported Bitwarden passkey algorithm");
    }
    const privateKey = await crypto.subtle.importKey(
        "pkcs8",
        base64UrlBytes(source.keyValue).slice().buffer as ArrayBuffer,
        { name: "ECDSA", namedCurve: "P-256" },
        true,
        ["sign"],
    );
    const privateJwk = await crypto.subtle.exportKey("jwk", privateKey);
    const publicJwk: JsonWebKey = { ...privateJwk, key_ops: ["verify"] };
    delete publicJwk.d;
    return {
        CredentialID: source.credentialId,
        RPID: source.rpId,
        RPName: source.rpName ?? source.rpId,
        UserHandle: source.userHandle ?? "",
        UserName: source.userName ?? "",
        UserDisplayName: source.userDisplayName ?? source.userName ?? "",
        PublicKey: JSON.stringify(publicJwk),
        PrivateKey: JSON.stringify(privateJwk),
        Algorithm: -7,
        SignCount: Math.max(0, Number(source.counter) || 0),
        Discoverable: parseBoolean(source.discoverable) ?? false,
    };
};

const preserveBitwardenPasskey = (
    credential: Credential,
    passkey: BitwardenPasskey,
    index: number,
) => {
    for (const [key, value] of Object.entries(passkey)) {
        addCustomField(
            credential,
            `Bitwarden passkey ${index + 1} ${key}`,
            value,
            key === "keyValue"
                ? CustomFieldType.MaskedText
                : CustomFieldType.Text,
        );
    }
};

const parseBitwardenJSON = async (file: File): Promise<ImportResult> => {
    const parsed = await parseJsonFile<BitwardenExport>(file, "Bitwarden");
    const rawParsed: unknown = parsed;
    if (!isRecord(rawParsed)) {
        throw new ImportFileError(
            "BITWARDEN_SCHEMA_MISMATCH",
            "This file is not a Bitwarden vault JSON export.",
        );
    }
    if (parsed.encrypted) {
        throw new ImportFileError(
            "ENCRYPTED_EXPORT_UNSUPPORTED",
            "Encrypted Bitwarden exports are not supported. Export an unencrypted JSON file from Bitwarden and try again.",
        );
    }
    if (!Array.isArray(parsed.items)) {
        throw new ImportFileError(
            "BITWARDEN_ITEMS_MISSING",
            "This file is not a Bitwarden vault JSON export: the items array is missing.",
        );
    }
    parsed.items.forEach((item, index) => {
        const rawItem: unknown = item;
        if (
            !isRecord(rawItem) ||
            typeof item.name !== "string" ||
            typeof item.type !== "number" ||
            !Number.isInteger(item.type) ||
            item.type < 1 ||
            item.type > 5
        ) {
            throw new ImportFileError(
                "BITWARDEN_ITEM_INVALID",
                `This file can't be imported because Bitwarden item ${index + 1} is missing a valid name or type. Nothing was imported.`,
            );
        }
        const expectedContainer =
            item.type === 1
                ? item.login
                : item.type === 2
                  ? item.secureNote
                  : item.type === 3
                    ? item.card
                    : item.type === 4
                      ? item.identity
                      : item.sshKey;
        if (!isRecord(expectedContainer as unknown)) {
            throw new ImportFileError(
                "BITWARDEN_ITEM_INVALID",
                `This file can't be imported because Bitwarden item ${index + 1} does not contain the data required for its type. Nothing was imported.`,
            );
        }
        if (
            item.fields != null &&
            (!Array.isArray(item.fields) ||
                item.fields.some((field) => !isRecord(field)))
        ) {
            throw new ImportFileError(
                "BITWARDEN_ITEM_INVALID",
                `This file can't be imported because the custom fields on Bitwarden item ${index + 1} are invalid. Nothing was imported.`,
            );
        }
        const loginUris = item.login?.uris;
        if (
            loginUris != null &&
            (!Array.isArray(loginUris) ||
                loginUris.some(
                    (uri) => !isRecord(uri) || typeof uri.uri !== "string",
                ))
        ) {
            throw new ImportFileError(
                "BITWARDEN_ITEM_INVALID",
                `This file can't be imported because the website addresses on Bitwarden item ${index + 1} are invalid. Nothing was imported.`,
            );
        }
    });
    if (parsed.folders != null && !Array.isArray(parsed.folders)) {
        throw new ImportFileError(
            "BITWARDEN_FOLDERS_INVALID",
            "This file can't be imported because the Bitwarden folders value is invalid. Nothing was imported.",
        );
    }
    parsed.folders?.forEach((folder, index) => {
        if (
            !isRecord(folder) ||
            typeof folder.id !== "string" ||
            !folder.id ||
            typeof folder.name !== "string" ||
            !folder.name
        ) {
            throw new ImportFileError(
                "BITWARDEN_FOLDER_INVALID",
                `This file can't be imported because Bitwarden folder ${index + 1} is missing a valid ID or name. Nothing was imported.`,
            );
        }
    });

    const notices: ImportNotice[] = [];
    const directories = (parsed.folders ?? []).map((folder) => {
        if (
            folder.name!.includes("/") ||
            folder.name!.includes("\\") ||
            safeDirectoryName(folder.name!) !== folder.name!.trim()
        ) {
            addFolderAdjustmentNotice(notices);
        }
        return makeDirectory(folder.id!, folder.name!);
    });
    const folderNames = new Map(
        (parsed.folders ?? []).flatMap((folder) =>
            folder.id && folder.name ? [[folder.id, folder.name] as const] : [],
        ),
    );
    const credentials: Credential[] = [];
    let skippedItems = 0;

    for (const item of parsed.items) {
        if (item.deletedDate) {
            skippedItems += 1;
            continue;
        }
        const history = item.passwordHistory ?? [];
        const credential = makeCredential({
            type: bitwardenItemType(item.type),
            directoryId: item.folderId,
            name: item.name,
            username: item.login?.username,
            password: item.login?.password,
            notes: item.notes,
            createdAt: parseTimestamp(item.creationDate),
            modifiedAt: parseTimestamp(item.revisionDate),
            passwordChangedAt: parseTimestamp(
                item.passwordRevisionDate ?? history[0]?.lastUsedDate,
            ),
        });

        const nativeUrls: CredentialURL[] = [];
        const seenNativeUrls = new Set<string>();
        (item.login?.uris ?? []).forEach((sourceUrl, index) => {
            const uri = sourceUrl.uri ?? "";
            const mapping = bitwardenUriMode(sourceUrl.match);
            if (
                mapping.supported &&
                uri &&
                isCredentialUrlRuleValid({ URL: uri, MatchMode: mapping.mode })
            ) {
                const key = `${mapping.mode}:${uri.trim().toLowerCase()}`;
                if (!seenNativeUrls.has(key)) {
                    seenNativeUrls.add(key);
                    nativeUrls.push({ URL: uri, MatchMode: mapping.mode });
                }
            } else if (uri) {
                addCustomField(
                    credential,
                    `Bitwarden URL ${index + 1}${mapping.supported ? "" : ` (${mapping.name})`}`,
                    uri,
                );
                addImportNotice(notices, {
                    code: "URL_SAVED_AS_TEXT",
                    kind: "saved-differently",
                    title: "Website matching settings will be saved as text",
                    detail: "Cryptex Vault cannot reproduce these matching rules safely, so they will not be used for autofill.",
                    itemName: credential.Name,
                });
            }
        });
        const [primaryUrl, ...additionalUrls] = nativeUrls;
        if (primaryUrl) {
            credential.URL = primaryUrl.URL;
            credential.URLMatchMode = primaryUrl.MatchMode;
            credential.AdditionalURLs = additionalUrls;
        }

        assignTotp(credential, item.login?.totp, notices, "Bitwarden");
        for (const field of item.fields ?? []) {
            if (field.type === 3) {
                addImportNotice(notices, {
                    code: "BITWARDEN_LINKED_FIELDS_UNSUPPORTED",
                    kind: "not-imported",
                    title: "Bitwarden linked fields can't be recreated",
                    detail: "The usernames, passwords, and other values they point to will still be added.",
                    itemName: credential.Name,
                });
                continue;
            }
            const fieldType =
                field.type === 1
                    ? CustomFieldType.MaskedText
                    : field.type === 2
                      ? CustomFieldType.Boolean
                      : CustomFieldType.Text;
            addCustomField(
                credential,
                field.name || "Bitwarden field",
                field.value,
                fieldType,
            );
        }
        if (item.card) {
            for (const [key, value] of Object.entries(item.card)) {
                addCustomField(
                    credential,
                    `Card ${key}`,
                    value,
                    CustomFieldType.MaskedText,
                );
            }
        }
        if (item.identity) {
            for (const [key, value] of Object.entries(item.identity)) {
                addCustomField(
                    credential,
                    `Identity ${key}`,
                    value,
                    CustomFieldType.MaskedText,
                );
            }
        }
        if (item.sshKey) {
            for (const [key, value] of Object.entries(item.sshKey)) {
                addCustomField(
                    credential,
                    `SSH ${key}`,
                    value,
                    CustomFieldType.MaskedText,
                );
            }
        }
        if (item.secureNote) {
            for (const [key, value] of Object.entries(item.secureNote)) {
                addCustomField(credential, `Secure note ${key}`, value);
            }
        }
        history.forEach((entry, index) => {
            addCustomField(
                credential,
                `Password history ${index + 1}`,
                entry.password,
                CustomFieldType.MaskedText,
            );
            addCustomField(
                credential,
                `Password history ${index + 1} date`,
                entry.lastUsedDate,
            );
        });
        addCustomField(credential, "Bitwarden item ID", item.id);
        addCustomField(
            credential,
            "Bitwarden favorite",
            item.favorite,
            CustomFieldType.Boolean,
        );
        if (item.archived) {
            addCustomField(
                credential,
                "Archived",
                true,
                CustomFieldType.Boolean,
            );
            addImportNotice(notices, {
                code: "ARCHIVED_STATUS_SAVED_AS_FIELD",
                kind: "saved-differently",
                title: 'Archived status will be saved as an "Archived" checkbox',
                itemName: credential.Name,
            });
        }
        addCustomField(credential, "Bitwarden reprompt", item.reprompt);
        addCustomField(
            credential,
            "Bitwarden organization ID",
            item.organizationId,
        );
        addCustomField(
            credential,
            "Bitwarden collection IDs",
            item.collectionIds?.join(", "),
        );
        const folderName = item.folderId && folderNames.get(item.folderId);
        if (folderName && safeDirectoryName(folderName) !== folderName.trim()) {
            addCustomField(credential, "Bitwarden folder name", folderName);
        }
        addUnknownScalarFields(
            credential,
            item as unknown as Record<string, unknown>,
            "Bitwarden",
            [
                "id",
                "folderId",
                "organizationId",
                "name",
                "notes",
                "favorite",
                "archived",
                "reprompt",
                "creationDate",
                "revisionDate",
                "passwordRevisionDate",
                "deletedDate",
                "type",
            ],
        );
        addUnknownScalarFields(
            credential,
            item.login as unknown as Record<string, unknown> | undefined,
            "Bitwarden login",
            ["username", "password", "totp"],
        );

        if (item.attachments?.length) {
            addImportNotice(notices, {
                code: "BITWARDEN_ATTACHMENTS_UNSUPPORTED",
                kind: "not-imported",
                title: "Attached files can't be carried over",
                detail: "The rest of each affected item will still be added.",
                count: item.attachments.length,
                itemName: credential.Name,
                requiresConfirmation: true,
            });
        }
        const passkeys = item.login?.fido2Credentials ?? [];
        for (let index = 0; index < passkeys.length; index += 1) {
            const passkey = passkeys[index]!;
            if (!credential.Passkey) {
                try {
                    credential.Passkey = await convertBitwardenPasskey(passkey);
                    addCustomField(
                        credential,
                        "Bitwarden passkey creation date",
                        passkey.creationDate,
                    );
                    continue;
                } catch {
                    // Preserve the complete record below.
                }
            }
            preserveBitwardenPasskey(credential, passkey, index);
            addImportNotice(notices, {
                code: "BITWARDEN_PASSKEY_UNSUPPORTED",
                kind: "saved-differently",
                title: "Some passkeys were saved as custom fields",
                detail: "Cryptex Vault could not import these as usable passkeys because their key format is unsupported or the item already has an imported passkey.",
                itemName: credential.Name,
                requiresConfirmation: true,
            });
        }
        credentials.push(finishCredential(credential));
    }

    if (skippedItems) {
        addImportNotice(notices, {
            code: "BITWARDEN_DELETED_ITEMS_SKIPPED",
            kind: "items-skipped",
            title: "Items in the source trash will not be added",
            count: skippedItems,
        });
    }
    return {
        source: "bitwarden-json",
        credentials,
        directories,
        notices,
        skippedItems,
    };
};

/** Backwards-compatible programmatic Bitwarden parser. */
export const BitwardenJSON = async (
    file: File,
): Promise<{ credentials: Credential[]; directories: Directory[] }> => {
    const result = await parseBitwardenJSON(file);
    return { credentials: result.credentials, directories: result.directories };
};

const createDirectoryForCsv = (
    directories: Map<string, Directory>,
    groupName: string,
    notices: ImportNotice[],
): string => {
    if (!groupName) return "";
    const id = `import-directory:${groupName}`;
    if (!directories.has(id)) {
        directories.set(id, makeDirectory(id, groupName));
        if (
            groupName.includes("/") ||
            groupName.includes("\\") ||
            safeDirectoryName(groupName) !== groupName.trim()
        ) {
            addFolderAdjustmentNotice(notices);
        }
    }
    return id;
};

const preserveShortenedDirectoryName = (
    credential: Credential,
    source: string,
    name: string,
) => {
    if (name && safeDirectoryName(name) !== name.trim()) {
        addCustomField(credential, `${source} directory name`, name);
    }
};

const parseOnePasswordCsv = async (file: File): Promise<ImportResult> => {
    const source = "onepassword-csv" as const;
    const document = await parseCsvDocument(file, source);
    assertCsvHeaders(document, source, [
        "Title",
        "Website",
        "Username",
        "Password",
        "One-time password",
        "Favorite status",
        "Archived status",
        "Tags",
        "Notes",
    ]);
    const notices: ImportNotice[] = [];
    const credentials = document.rows.map((row) => {
        const credential = makeCredential({
            name: rowValue(row, "Title"),
            username: rowValue(row, "Username"),
            password: rowValue(row, "Password"),
            notes: rowValue(row, "Notes"),
            tags: encodeTags(splitTags(rowValue(row, "Tags"), ",")),
        });
        assignNativeUrls(
            credential,
            [
                {
                    URL: rowValue(row, "Website", "URL"),
                    MatchMode: CredentialURLMatchMode.ExactHost,
                },
            ],
            "1Password",
            notices,
        );
        assignTotp(
            credential,
            rowValue(row, "One-time password", "OTPAuth"),
            notices,
            "1Password",
        );
        const favorite = rowEntry(row, "Favorite status");
        if (favorite) {
            addCustomField(
                credential,
                "1Password favorite",
                parseBoolean(favorite[1]) ?? favorite[1],
                CustomFieldType.Boolean,
            );
        }
        const archived = rowEntry(row, "Archived status");
        if (archived && parseBoolean(archived[1]) === true) {
            addCustomField(
                credential,
                "Archived",
                true,
                CustomFieldType.Boolean,
            );
            addImportNotice(notices, {
                code: "ARCHIVED_STATUS_SAVED_AS_FIELD",
                kind: "saved-differently",
                title: 'Archived status will be saved as an "Archived" checkbox',
                itemName: credential.Name,
            });
        }
        addUnknownCsvFields(credential, row, [
            "Title",
            "Website",
            "URL",
            "Username",
            "Password",
            "One-time password",
            "OTPAuth",
            "Favorite status",
            "Archived status",
            "Tags",
            "Notes",
        ]);
        return finishCredential(credential);
    });
    return {
        source,
        credentials,
        directories: [],
        notices,
        skippedItems: 0,
    };
};

const parseKeePassCsv = async (file: File): Promise<ImportResult> => {
    const source = "keepass-csv" as const;
    const text = await readFileAsText(file);
    const usesKeePass1Escaping = text
        .replace(/^\uFEFF/u, "")
        .trimStart()
        .startsWith('"Account","Login Name","Password","Web Site","Comments"');
    const document = parseCsvText(
        text,
        source,
        usesKeePass1Escaping ? "\\" : undefined,
    );
    const headers = new Set(document.headers.map(normalizedKey));
    const isKeePass1 = [
        "account",
        "login name",
        "password",
        "web site",
        "comments",
    ].every((header) => headers.has(header));
    const isKeePassXc = [
        "group",
        "title",
        "username",
        "password",
        "url",
        "notes",
    ].every((header) => headers.has(header));
    if (!isKeePass1 && !isKeePassXc) {
        throw new ImportFileError(
            "CSV_SCHEMA_MISMATCH",
            "KeePass CSV must be either KeePass 1.x CSV (Account, Login Name, Password, Web Site, Comments) or KeePassXC CSV (Group, Title, Username, Password, URL, Notes).",
        );
    }
    if (isKeePass1 && usesKeePass1Escaping) {
        document.rows = document.rows.map((row) =>
            Object.fromEntries(
                Object.entries(row).map(([key, value]) => [
                    key,
                    value.replaceAll("\\\\", "\\"),
                ]),
            ),
        );
    }
    const directories = new Map<string, Directory>();
    const notices: ImportNotice[] = [];
    const credentials = document.rows.map((row) => {
        const groupName = rowValue(row, "Group", "Grouping");
        const credential = makeCredential({
            directoryId: createDirectoryForCsv(directories, groupName, notices),
            name: rowValue(row, "Account", "Title"),
            username: rowValue(row, "Login Name", "Username"),
            password: rowValue(row, "Password"),
            notes: rowValue(row, "Comments", "Notes"),
            tags: encodeTags(splitTags(rowValue(row, "Tags"), ";")),
            createdAt: parseTimestamp(rowValue(row, "Created")),
            modifiedAt: parseTimestamp(rowValue(row, "Last Modified")),
        });
        assignNativeUrls(
            credential,
            [
                {
                    URL: rowValue(row, "Web Site", "URL"),
                    MatchMode: CredentialURLMatchMode.ExactHost,
                },
            ],
            "KeePass",
            notices,
        );
        preserveShortenedDirectoryName(credential, "KeePass", groupName);
        assignTotp(
            credential,
            rowValue(row, "TOTP", "OTPAuth"),
            notices,
            "KeePass",
        );
        addUnknownCsvFields(credential, row, [
            "Account",
            "Title",
            "Login Name",
            "Username",
            "Password",
            "Web Site",
            "URL",
            "Comments",
            "Notes",
            "Group",
            "Grouping",
            "Tags",
            "TOTP",
            "OTPAuth",
            "Created",
            "Last Modified",
        ]);
        return finishCredential(credential);
    });
    return {
        source,
        credentials,
        directories: [...directories.values()],
        notices,
        skippedItems: 0,
    };
};

const parseLastPassSecureNote = (value: string) => {
    const lines = value.split(/\r?\n/u);
    const typeMatch = /^NoteType:(.*)$/iu.exec(lines[0] ?? "");
    if (!typeMatch) return null;
    const fields: Array<[string, string]> = [];
    for (const line of lines.slice(1)) {
        if (!line) continue;
        const separator = line.indexOf(":");
        if (separator < 1) return null;
        fields.push([line.slice(0, separator), line.slice(separator + 1)]);
    }
    const noteType = typeMatch[1]?.trim() || "Secure Note";
    const identityTypes = new Set([
        "address",
        "driver's license",
        "passport",
        "social security",
    ]);
    const protectedTypes = new Set([
        "bank account",
        "credit card",
        "database",
        "driver's license",
        "email account",
        "health insurance",
        "instant messenger",
        "membership",
        "passport",
        "server",
        "social security",
        "software license",
        "ssh key",
        "wi-fi password",
    ]);
    const normalizedType = noteType.toLowerCase();
    return {
        noteType,
        itemType: identityTypes.has(normalizedType)
            ? ItemType.Identity
            : normalizedType === "secure note"
              ? ItemType.Note
              : ItemType.Credentials,
        protected: protectedTypes.has(normalizedType),
        fields,
    };
};

const parseLastPassCsv = async (file: File): Promise<ImportResult> => {
    const source = "lastpass-csv" as const;
    const document = await parseCsvDocument(file, source);
    assertCsvHeaders(document, source, [
        "url",
        "username",
        "password",
        "extra",
        "name",
        "grouping",
        "fav",
    ]);
    const directories = new Map<string, Directory>();
    const notices: ImportNotice[] = [];
    const credentials = document.rows.map((row) => {
        const isSecureNote =
            rowValue(row, "url").trim().toLowerCase() === "http://sn";
        const extra = rowValue(row, "extra");
        const structuredNote = isSecureNote
            ? parseLastPassSecureNote(extra)
            : null;
        const structuredNotes = structuredNote?.fields.find(
            ([name]) => normalizedKey(name) === "notes",
        )?.[1];
        const groupName = rowValue(row, "grouping");
        const credential = makeCredential({
            type:
                structuredNote?.itemType ??
                (isSecureNote ? ItemType.Note : ItemType.Credentials),
            directoryId: createDirectoryForCsv(directories, groupName, notices),
            name: rowValue(row, "name"),
            username: rowValue(row, "username"),
            password: rowValue(row, "password"),
            notes: structuredNote ? structuredNotes : extra,
        });
        if (!isSecureNote) {
            assignNativeUrls(
                credential,
                [
                    {
                        URL: rowValue(row, "url"),
                        MatchMode: CredentialURLMatchMode.ExactHost,
                    },
                ],
                "LastPass",
                notices,
            );
        }
        if (structuredNote) {
            addCustomField(
                credential,
                "LastPass note type",
                structuredNote.noteType,
            );
            for (const [name, value] of structuredNote.fields) {
                if (normalizedKey(name) === "notes") continue;
                addCustomField(
                    credential,
                    name,
                    value,
                    structuredNote.protected
                        ? CustomFieldType.MaskedText
                        : CustomFieldType.Text,
                );
            }
        }
        assignTotp(credential, rowValue(row, "totp"), notices, "LastPass");
        preserveShortenedDirectoryName(credential, "LastPass", groupName);
        addCustomField(
            credential,
            "LastPass favorite",
            parseBoolean(rowValue(row, "fav")) ?? rowValue(row, "fav"),
            CustomFieldType.Boolean,
        );
        addUnknownCsvFields(credential, row, [
            "url",
            "username",
            "password",
            "extra",
            "name",
            "grouping",
            "fav",
            "totp",
        ]);
        return finishCredential(credential);
    });
    return {
        source,
        credentials,
        directories: [...directories.values()],
        notices,
        skippedItems: 0,
    };
};

const parseChromeCsv = async (file: File): Promise<ImportResult> => {
    const source = "chrome-csv" as const;
    const document = await parseCsvDocument(file, source);
    assertCsvHeaders(document, source, ["name", "url", "username", "password"]);
    const notices: ImportNotice[] = [];
    const credentials = document.rows.map((row) => {
        const credential = makeCredential({
            name: rowValue(row, "name"),
            username: rowValue(row, "username"),
            password: rowValue(row, "password"),
            notes: rowValue(row, "note"),
        });
        assignNativeUrls(
            credential,
            [
                {
                    URL: rowValue(row, "url"),
                    MatchMode: CredentialURLMatchMode.ExactHost,
                },
            ],
            "Chrome",
            notices,
        );
        addUnknownCsvFields(credential, row, [
            "name",
            "url",
            "username",
            "password",
            "note",
        ]);
        return finishCredential(credential);
    });
    return {
        source,
        credentials,
        directories: [],
        notices,
        skippedItems: 0,
    };
};

const parseFirefoxCsv = async (file: File): Promise<ImportResult> => {
    const source = "firefox-csv" as const;
    const document = await parseCsvDocument(file, source);
    assertCsvHeaders(document, source, [
        "url",
        "username",
        "password",
        "httpRealm",
        "formActionOrigin",
        "guid",
        "timeCreated",
        "timeLastUsed",
        "timePasswordChanged",
    ]);
    const notices: ImportNotice[] = [];
    const credentials = document.rows.map((row) => {
        const url = rowValue(row, "url");
        let name = url;
        try {
            name = new URL(url.trim()).hostname || url;
        } catch {
            // The original value is preserved below if it is not a native URL.
        }
        const created = parseTimestamp(rowValue(row, "timeCreated"));
        const passwordChanged = parseTimestamp(
            rowValue(row, "timePasswordChanged"),
        );
        const credential = makeCredential({
            name,
            username: rowValue(row, "username"),
            password: rowValue(row, "password"),
            createdAt: created,
            modifiedAt: passwordChanged ?? created,
            passwordChangedAt: passwordChanged ?? created,
        });
        assignNativeUrls(
            credential,
            [{ URL: url, MatchMode: CredentialURLMatchMode.ExactHost }],
            "Firefox",
            notices,
        );
        addCustomField(
            credential,
            "Firefox HTTP realm",
            rowValue(row, "httpRealm"),
        );
        addCustomField(
            credential,
            "Firefox form action origin",
            rowValue(row, "formActionOrigin"),
        );
        addCustomField(credential, "Firefox GUID", rowValue(row, "guid"));
        addCustomField(
            credential,
            "Firefox last used",
            rowValue(row, "timeLastUsed"),
        );
        addUnknownCsvFields(credential, row, [
            "url",
            "username",
            "password",
            "httpRealm",
            "formActionOrigin",
            "guid",
            "timeCreated",
            "timeLastUsed",
            "timePasswordChanged",
        ]);
        return finishCredential(credential);
    });
    return {
        source,
        credentials,
        directories: [],
        notices,
        skippedItems: 0,
    };
};

const directChildren = (element: Element, tag?: string): Element[] =>
    Array.from(element.children).filter(
        (child) => !tag || child.localName.toLowerCase() === tag.toLowerCase(),
    );

const directChild = (element: Element, tag: string): Element | undefined =>
    directChildren(element, tag)[0];

const directText = (element: Element, tag: string): string =>
    directChild(element, tag)?.textContent ?? "";

const configureKeePassTotp = (
    credential: Credential,
    values: Record<string, string>,
    notices: ImportNotice[],
) => {
    const find = (...keys: string[]) => {
        const wanted = new Set(keys.map(normalizedKey));
        return Object.entries(values).find(([key]) =>
            wanted.has(normalizedKey(key)),
        )?.[1];
    };
    const uri = find("otp", "TOTP Seed");
    if (uri) {
        assignTotp(credential, uri, notices, "KeePass");
        return;
    }
    const secret = find("TimeOtp-Secret-Base32");
    if (!secret) return;
    const periodValue = find("TimeOtp-Period");
    const digitsValue = find("TimeOtp-Length");
    const algorithmValue = find("TimeOtp-Algorithm");
    const period = periodValue
        ? Number(periodValue)
        : TOTPConstants.PERIOD_DEFAULT;
    const digits = digitsValue
        ? Number(digitsValue)
        : TOTPConstants.DIGITS_DEFAULT;
    const algorithm = (
        algorithmValue || TOTPAlgorithm[TOTPConstants.ALGORITHM_DEFAULT]
    )
        .toUpperCase()
        .replaceAll("-", "");
    const algorithms: Record<string, TOTPAlgorithm> = {
        SHA1: TOTPAlgorithm.SHA1,
        SHA256: TOTPAlgorithm.SHA256,
        SHA512: TOTPAlgorithm.SHA512,
    };
    const isValid =
        /^[A-Z2-7]+=*$/iu.test(secret) &&
        Number.isInteger(period) &&
        period > 0 &&
        Number.isInteger(digits) &&
        digits > 0 &&
        algorithms[algorithm] != null;
    if (!isValid) {
        addCustomField(
            credential,
            "KeePass authenticator configuration",
            JSON.stringify({
                secret,
                period: periodValue,
                digits: digitsValue,
                algorithm: algorithmValue,
            }),
            CustomFieldType.MaskedText,
        );
        addImportNotice(notices, {
            code: "TOTP_CONFIGURATION_UNSUPPORTED",
            kind: "saved-differently",
            title: "Authenticator setups will be saved as hidden text",
            detail: "Cryptex Vault cannot generate codes from these settings. Missing KeePass settings use KeePass defaults.",
            itemName: credential.Name,
            requiresConfirmation: true,
        });
        return;
    }
    credential.TOTP = Object.assign(new TOTP(), {
        Secret: secret,
        Period: period,
        Digits: digits,
        Algorithm: algorithms[algorithm],
    });
};

const keepassTotpKeys = new Set(
    [
        "otp",
        "TOTP Seed",
        "TimeOtp-Secret-Base32",
        "TimeOtp-Period",
        "TimeOtp-Length",
        "TimeOtp-Algorithm",
    ].map(normalizedKey),
);

const parseKeePass2Xml = (doc: XMLDocument): ImportResult => {
    const root = directChild(doc.documentElement, "Root");
    const rootGroup = root && directChild(root, "Group");
    if (!rootGroup) {
        throw new ImportFileError(
            "KEEPASS_ROOT_MISSING",
            "KeePass 2.x XML is missing Root > Group.",
        );
    }
    const directories: Directory[] = [];
    const credentials: Credential[] = [];
    const notices: ImportNotice[] = [];
    const meta = directChild(doc.documentElement, "Meta");
    const recycleBinUuid = meta ? directText(meta, "RecycleBinUUID") : "";
    let skipped = 0;

    const validateGroup = (group: Element, path: string) => {
        for (const [entryIndex, entry] of directChildren(
            group,
            "Entry",
        ).entries()) {
            for (const [fieldIndex, field] of directChildren(
                entry,
                "String",
            ).entries()) {
                if (
                    !directChild(field, "Key") ||
                    !directChild(field, "Value")
                ) {
                    throw new ImportFileError(
                        "KEEPASS_ENTRY_INVALID",
                        `This file can't be imported because field ${fieldIndex + 1} on KeePass item ${entryIndex + 1} in "${path}" is invalid. Nothing was imported.`,
                    );
                }
            }
        }
        for (const child of directChildren(group, "Group")) {
            validateGroup(
                child,
                `${path}/${directText(child, "Name") || "Unnamed group"}`,
            );
        }
    };
    validateGroup(rootGroup, directText(rootGroup, "Name") || "KeePass");

    const readStrings = (entry: Element): Record<string, string> => {
        const values: Record<string, string> = {};
        for (const stringElement of directChildren(entry, "String")) {
            const key = directText(stringElement, "Key");
            if (key) values[key] = directText(stringElement, "Value");
        }
        return values;
    };

    const protectedKeys = (entry: Element): Set<string> =>
        new Set(
            directChildren(entry, "String").flatMap((field) => {
                const value = directChild(field, "Value");
                return value?.getAttribute("Protected")?.toLowerCase() ===
                    "true"
                    ? [normalizedKey(directText(field, "Key"))]
                    : [];
            }),
        );

    const addHistory = (credential: Credential, entry: Element) => {
        const history = directChild(entry, "History");
        if (!history) return;
        directChildren(history, "Entry").forEach((oldEntry, index) => {
            const oldValues = readStrings(oldEntry);
            for (const [key, value] of Object.entries(oldValues)) {
                addCustomField(
                    credential,
                    `History ${index + 1} ${key}`,
                    value,
                    normalizedKey(key) === "password"
                        ? CustomFieldType.MaskedText
                        : CustomFieldType.Text,
                );
            }
            const oldTimes = directChild(oldEntry, "Times");
            if (oldTimes) {
                addCustomField(
                    credential,
                    `History ${index + 1} modified`,
                    directText(oldTimes, "LastModificationTime"),
                );
            }
        });
    };

    const countEntries = (group: Element): number =>
        directChildren(group, "Entry").length +
        directChildren(group, "Group").reduce(
            (total, child) => total + countEntries(child),
            0,
        );

    const walkGroup = (group: Element, parentPath = "") => {
        const uuid = directText(group, "UUID");
        if (recycleBinUuid && uuid === recycleBinUuid) {
            skipped += countEntries(group);
            return;
        }
        const name = directText(group, "Name") || "KeePass";
        const path = parentPath ? `${parentPath}/${name}` : name;
        const directoryId = uuid || `keepass:${path}`;
        directories.push(makeDirectory(directoryId, path));
        const pathWasShortened = safeDirectoryName(path) !== path.trim();
        if (parentPath || pathWasShortened) addFolderAdjustmentNotice(notices);
        if (directText(group, "Notes")) {
            addImportNotice(notices, {
                code: "KEEPASS_GROUP_METADATA_UNSUPPORTED",
                kind: "not-imported",
                title: "Folder notes can't be carried over",
                requiresConfirmation: true,
            });
        }

        for (const entry of directChildren(group, "Entry")) {
            const values = readStrings(entry);
            const protectedFields = protectedKeys(entry);
            const times = directChild(entry, "Times");
            const credential = makeCredential({
                directoryId,
                name: values.Title,
                username: values.UserName,
                password: values.Password,
                notes: values.Notes,
                tags: encodeTags([
                    ...splitTags(directText(entry, "Tags"), ";"),
                    ...splitTags(values.Tags, ";"),
                ]),
                createdAt: parseTimestamp(
                    times && directText(times, "CreationTime"),
                ),
                modifiedAt: parseTimestamp(
                    times && directText(times, "LastModificationTime"),
                ),
            });
            assignNativeUrls(
                credential,
                [
                    {
                        URL: values.URL ?? "",
                        MatchMode: CredentialURLMatchMode.ExactHost,
                    },
                ],
                "KeePass",
                notices,
            );
            configureKeePassTotp(credential, values, notices);
            for (const [key, value] of Object.entries(values)) {
                if (
                    [
                        "title",
                        "username",
                        "password",
                        "url",
                        "notes",
                        "tags",
                    ].includes(normalizedKey(key)) ||
                    keepassTotpKeys.has(normalizedKey(key))
                ) {
                    continue;
                }
                addCustomField(
                    credential,
                    key,
                    value,
                    protectedFields.has(normalizedKey(key))
                        ? CustomFieldType.MaskedText
                        : CustomFieldType.Text,
                );
            }
            addCustomField(
                credential,
                "KeePass entry UUID",
                directText(entry, "UUID"),
            );
            if (pathWasShortened) {
                addCustomField(credential, "KeePass group path", path);
            }
            if (times) {
                addCustomField(
                    credential,
                    "KeePass last access time",
                    directText(times, "LastAccessTime"),
                );
                addCustomField(
                    credential,
                    "KeePass expiry time",
                    directText(times, "ExpiryTime"),
                );
                addCustomField(
                    credential,
                    "KeePass expires",
                    directText(times, "Expires"),
                    CustomFieldType.Boolean,
                );
            }
            addCustomField(
                credential,
                "KeePass override URL",
                directText(entry, "OverrideURL"),
            );
            const autoType = directChild(entry, "AutoType");
            if (autoType) {
                addCustomField(
                    credential,
                    "KeePass auto-type enabled",
                    directText(autoType, "Enabled"),
                    CustomFieldType.Boolean,
                );
                addCustomField(
                    credential,
                    "KeePass auto-type sequence",
                    directText(autoType, "DefaultSequence"),
                );
            }
            const handledEntryElements = new Set(
                [
                    "string",
                    "uuid",
                    "times",
                    "tags",
                    "overrideurl",
                    "autotype",
                    "binary",
                    "history",
                ].map(normalizedKey),
            );
            for (const metadata of directChildren(entry)) {
                if (
                    handledEntryElements.has(
                        normalizedKey(metadata.localName),
                    ) ||
                    metadata.children.length > 0
                ) {
                    continue;
                }
                addCustomField(
                    credential,
                    `KeePass ${metadata.localName}`,
                    metadata.textContent,
                );
            }
            const attachments = directChildren(entry, "Binary");
            if (attachments.length) {
                addImportNotice(notices, {
                    code: "KEEPASS_ATTACHMENTS_UNSUPPORTED",
                    kind: "not-imported",
                    title: "Attached files can't be carried over",
                    detail: "The rest of each affected item will still be added.",
                    count: attachments.length,
                    itemName: credential.Name,
                    requiresConfirmation: true,
                });
            }
            addHistory(credential, entry);
            credentials.push(finishCredential(credential));
        }
        for (const child of directChildren(group, "Group")) {
            walkGroup(child, path);
        }
    };

    walkGroup(rootGroup);
    if (skipped) {
        addImportNotice(notices, {
            code: "KEEPASS_DELETED_ITEMS_SKIPPED",
            kind: "items-skipped",
            title: "Items in the source trash will not be added",
            count: skipped,
        });
    }
    return {
        source: "keepass-xml",
        credentials,
        directories,
        notices,
        skippedItems: skipped,
    };
};

const parseKeePass1Xml = (doc: XMLDocument): ImportResult => {
    const entries = directChildren(doc.documentElement, "pwentry");
    const requiredFields = [
        "group",
        "title",
        "username",
        "url",
        "password",
        "notes",
    ];
    entries.forEach((entry, index) => {
        if (requiredFields.some((field) => !directChild(entry, field))) {
            throw new ImportFileError(
                "KEEPASS_ENTRY_INVALID",
                `This file can't be imported because KeePass 1.x item ${index + 1} does not match the documented XML format. Nothing was imported.`,
            );
        }
    });
    const directories = new Map<string, Directory>();
    const credentials: Credential[] = [];
    const notices: ImportNotice[] = [];
    for (const entry of entries) {
        const groupElement = directChild(entry, "group");
        const groupName = groupElement?.textContent ?? "KeePass";
        const parent = groupElement?.getAttribute("tree") ?? "";
        const path = [parent, groupName].filter(Boolean).join("/");
        const directoryId = `keepass1:${path}`;
        if (!directories.has(directoryId)) {
            directories.set(directoryId, makeDirectory(directoryId, path));
            if (
                parent ||
                path.includes("/") ||
                safeDirectoryName(path) !== path.trim()
            ) {
                addFolderAdjustmentNotice(notices);
            }
        }
        const credential = makeCredential({
            directoryId,
            name: directText(entry, "title"),
            username: directText(entry, "username"),
            password: directText(entry, "password"),
            notes: directText(entry, "notes"),
            createdAt: parseTimestamp(directText(entry, "creationtime")),
            modifiedAt: parseTimestamp(directText(entry, "lastmodtime")),
        });
        if (safeDirectoryName(path) !== path.trim()) {
            addCustomField(credential, "KeePass group path", path);
        }
        assignNativeUrls(
            credential,
            [
                {
                    URL: directText(entry, "url"),
                    MatchMode: CredentialURLMatchMode.ExactHost,
                },
            ],
            "KeePass",
            notices,
        );
        addCustomField(
            credential,
            "KeePass entry UUID",
            directText(entry, "uuid"),
        );
        addCustomField(credential, "KeePass icon", directText(entry, "image"));
        addCustomField(
            credential,
            "KeePass last access time",
            directText(entry, "lastaccesstime"),
        );
        const expiry = directChild(entry, "expiretime");
        if (expiry) {
            addCustomField(
                credential,
                "KeePass expires",
                expiry.getAttribute("expires"),
                CustomFieldType.Boolean,
            );
            addCustomField(
                credential,
                "KeePass expiry time",
                expiry.textContent,
            );
        }
        credentials.push(finishCredential(credential));
    }
    return {
        source: "keepass-xml",
        credentials,
        directories: [...directories.values()],
        notices,
        skippedItems: 0,
    };
};

const parseKeePassXML = async (file: File): Promise<ImportResult> => {
    const doc = new DOMParser().parseFromString(
        await readFileAsText(file),
        "application/xml",
    );
    if (doc.querySelector("parsererror")) {
        throw new ImportFileError(
            "INVALID_XML",
            "The selected file is not valid XML.",
        );
    }
    const rootName = doc.documentElement.localName.toLowerCase();
    if (rootName === "keepassfile") return parseKeePass2Xml(doc);
    if (rootName === "pwlist") return parseKeePass1Xml(doc);
    throw new ImportFileError(
        "KEEPASS_XML_SCHEMA_MISMATCH",
        "This is not a KeePass 1.x or KeePass 2.x XML export.",
    );
};

type OnePasswordField = {
    title?: string;
    id?: string;
    value?: unknown;
    type?: string;
};

const onePasswordValue = (
    value: unknown,
): { value: string; type: CustomFieldType; kind: string } => {
    if (value == null)
        return { value: "", type: CustomFieldType.Text, kind: "" };
    if (typeof value !== "object") {
        return { value: asString(value), type: CustomFieldType.Text, kind: "" };
    }
    const entries = Object.entries(value as Record<string, unknown>);
    const scalar = entries.find(([, entry]) =>
        ["string", "number", "boolean"].includes(typeof entry),
    );
    if (!scalar) {
        return {
            value: JSON.stringify(value),
            type: CustomFieldType.Text,
            kind: "structured",
        };
    }
    const [kind, raw] = scalar;
    const normalizedKind = normalizedKey(kind);
    return {
        value: asString(raw),
        type:
            normalizedKind === "concealed" ||
            normalizedKind === "creditcardnumber" ||
            normalizedKind === "credit card number"
                ? CustomFieldType.MaskedText
                : CustomFieldType.Text,
        kind: normalizedKind,
    };
};

const onePasswordItemType = (category: string | undefined): ItemType => {
    switch (category) {
        case "003":
        case "100":
        case "111":
        case "113":
            return ItemType.Note;
        case "004":
        case "103":
        case "104":
        case "105":
        case "106":
        case "107":
        case "108":
            return ItemType.Identity;
        case "114":
            return ItemType.SSHKey;
        default:
            return ItemType.Credentials;
    }
};

const onePasswordSensitiveCategories = new Set([
    "002",
    "004",
    "005",
    "100",
    "101",
    "102",
    "103",
    "104",
    "105",
    "106",
    "107",
    "108",
    "109",
    "110",
    "111",
    "112",
    "113",
    "114",
]);

const parseOnePassword1Pux = async (file: File): Promise<ImportResult> => {
    let zip: JSZip;
    try {
        zip = await JSZip.loadAsync(await readFileAsArrayBuffer(file));
    } catch (error) {
        throw new ImportFileError(
            "INVALID_1PUX",
            "The selected file is not a valid 1Password 1PUX archive.",
            { cause: error },
        );
    }
    const attributesFile = zip.file("export.attributes");
    if (!attributesFile) {
        throw new ImportFileError(
            "ONEPASSWORD_ATTRIBUTES_MISSING",
            "The 1PUX archive is missing export.attributes.",
        );
    }
    let attributes: unknown;
    try {
        attributes = JSON.parse(await attributesFile.async("string"));
    } catch (error) {
        throw new ImportFileError(
            "INVALID_1PUX_ATTRIBUTES",
            "The 1PUX export.attributes file is not valid JSON.",
            { cause: error },
        );
    }
    if (
        !isRecord(attributes) ||
        attributes.version !== 3 ||
        attributes.description !== "1Password Unencrypted Export" ||
        typeof attributes.createdAt !== "number"
    ) {
        throw new ImportFileError(
            "ONEPASSWORD_ATTRIBUTES_INVALID",
            "The 1PUX export.attributes file does not match the supported 1Password format version 3.",
        );
    }
    const exportData = zip.file("export.data");
    if (!exportData) {
        throw new ImportFileError(
            "ONEPASSWORD_DATA_MISSING",
            "The 1PUX archive is missing export.data.",
        );
    }
    type OnePasswordData = {
        accounts?: Array<{
            attrs?: Record<string, unknown>;
            vaults?: Array<{
                attrs?: { name?: string; uuid?: string };
                items?: Array<{
                    uuid?: string;
                    favIndex?: number;
                    createdAt?: number;
                    updatedAt?: number;
                    state?: string;
                    categoryUuid?: string;
                    file?: {
                        attrs?: Record<string, unknown>;
                        path?: string;
                    };
                    overview?: {
                        title?: string;
                        subtitle?: string;
                        url?: string;
                        urls?: Array<{ label?: string; url?: string }>;
                        tags?: string[];
                    };
                    details?: {
                        password?: string;
                        notesPlain?: string;
                        loginFields?: Array<{
                            designation?: string;
                            fieldType?: string;
                            name?: string;
                            id?: string;
                            value?: string;
                        }>;
                        sections?: Array<{
                            title?: string;
                            name?: string;
                            fields?: OnePasswordField[];
                        }>;
                        passwordHistory?: Array<{
                            value?: string;
                            time?: number;
                        }>;
                        documentAttributes?: Record<string, unknown>;
                    };
                }>;
            }>;
        }>;
    };
    let data: OnePasswordData;
    try {
        data = JSON.parse(await exportData.async("string")) as OnePasswordData;
    } catch (error) {
        throw new ImportFileError(
            "INVALID_1PUX_DATA",
            "The 1PUX export.data file is not valid JSON.",
            { cause: error },
        );
    }
    if (!Array.isArray(data.accounts)) {
        throw new ImportFileError(
            "ONEPASSWORD_ACCOUNTS_MISSING",
            "The 1PUX export is missing its accounts array.",
        );
    }

    const directories: Directory[] = [];
    const credentials: Credential[] = [];
    const notices: ImportNotice[] = [];
    let skippedItems = 0;

    for (const [accountIndex, account] of data.accounts.entries()) {
        if (!isRecord(account) || !isRecord(account.attrs)) {
            throw new ImportFileError(
                "ONEPASSWORD_ACCOUNT_INVALID",
                `This file can't be imported because 1Password account ${accountIndex + 1} is missing its attributes. Nothing was imported.`,
            );
        }
        if (!Array.isArray(account.vaults)) {
            throw new ImportFileError(
                "ONEPASSWORD_VAULTS_INVALID",
                `This file can't be imported because the vaults in 1Password account ${accountIndex + 1} are invalid. Nothing was imported.`,
            );
        }
        for (const [vaultIndex, vault] of (account.vaults ?? []).entries()) {
            if (
                !isRecord(vault) ||
                !isRecord(vault.attrs) ||
                typeof vault.attrs.name !== "string" ||
                !vault.attrs.name ||
                typeof vault.attrs.uuid !== "string" ||
                !vault.attrs.uuid
            ) {
                throw new ImportFileError(
                    "ONEPASSWORD_VAULT_INVALID",
                    `This file can't be imported because 1Password vault ${vaultIndex + 1} in account ${accountIndex + 1} is missing its name or UUID. Nothing was imported.`,
                );
            }
            if (!Array.isArray(vault.items)) {
                throw new ImportFileError(
                    "ONEPASSWORD_ITEMS_INVALID",
                    `This file can't be imported because the items in 1Password vault ${vaultIndex + 1} are invalid. Nothing was imported.`,
                );
            }
            const vaultName = vault.attrs?.name || "1Password";
            const directoryId =
                vault.attrs?.uuid ||
                `1pux:${accountIndex + 1}:${vaultIndex + 1}:${vaultName}`;
            directories.push(makeDirectory(directoryId, vaultName));
            if (safeDirectoryName(vaultName) !== vaultName.trim()) {
                addFolderAdjustmentNotice(notices);
            }
            for (const [itemIndex, item] of (vault.items ?? []).entries()) {
                if (
                    !isRecord(item) ||
                    typeof item.uuid !== "string" ||
                    !item.uuid ||
                    typeof item.categoryUuid !== "string" ||
                    !item.categoryUuid ||
                    !isRecord(item.overview) ||
                    typeof item.overview.title !== "string" ||
                    !isRecord(item.details) ||
                    (item.state != null &&
                        (typeof item.state !== "string" ||
                            !["active", "archived", "deleted"].includes(
                                item.state.toLowerCase(),
                            )))
                ) {
                    throw new ImportFileError(
                        "ONEPASSWORD_ITEM_INVALID",
                        `This file can't be imported because item ${itemIndex + 1} in 1Password vault "${vaultName}" does not match the documented 1PUX item structure. Nothing was imported.`,
                    );
                }
                const urlsAreValid =
                    item.overview.urls == null ||
                    (Array.isArray(item.overview.urls) &&
                        item.overview.urls.every(
                            (url) =>
                                isRecord(url) && typeof url.url === "string",
                        ));
                const tagsAreValid =
                    item.overview.tags == null ||
                    (Array.isArray(item.overview.tags) &&
                        item.overview.tags.every(
                            (tag) => typeof tag === "string",
                        ));
                const loginFieldsAreValid =
                    item.details.loginFields == null ||
                    (Array.isArray(item.details.loginFields) &&
                        item.details.loginFields.every(isRecord));
                const sectionsAreValid =
                    item.details.sections == null ||
                    (Array.isArray(item.details.sections) &&
                        item.details.sections.every((section) => {
                            if (!isRecord(section)) return false;
                            return (
                                section.fields == null ||
                                (Array.isArray(section.fields) &&
                                    section.fields.every(isRecord))
                            );
                        }));
                const historyIsValid =
                    item.details.passwordHistory == null ||
                    (Array.isArray(item.details.passwordHistory) &&
                        item.details.passwordHistory.every(isRecord));
                const fileIsValid =
                    item.file == null ||
                    (isRecord(item.file) &&
                        isRecord(item.file.attrs) &&
                        typeof item.file.path === "string");

                if (
                    !urlsAreValid ||
                    !tagsAreValid ||
                    !loginFieldsAreValid ||
                    !sectionsAreValid ||
                    !historyIsValid ||
                    !fileIsValid
                ) {
                    throw new ImportFileError(
                        "ONEPASSWORD_ITEM_INVALID",
                        `This file can't be imported because item ${itemIndex + 1} in 1Password vault "${vaultName}" contains invalid fields. Nothing was imported.`,
                    );
                }
                if (item.state?.toLowerCase() === "deleted") {
                    skippedItems += 1;
                    continue;
                }
                if (item.categoryUuid === "006") {
                    skippedItems += 1;
                    addImportNotice(notices, {
                        code: "ONEPASSWORD_DOCUMENTS_SKIPPED",
                        kind: "items-skipped",
                        title: "Documents whose files are not supported will not be added",
                        itemName: item.overview?.title || "Unnamed item",
                    });
                    continue;
                }
                const loginFields = item.details?.loginFields ?? [];
                const history = item.details?.passwordHistory ?? [];
                const hasSensitiveFields = onePasswordSensitiveCategories.has(
                    item.categoryUuid,
                );
                const designatedPassword = loginFields.find(
                    (field) => field.designation === "password",
                )?.value;
                const categoryPassword = item.details?.password;
                const credential = makeCredential({
                    type: onePasswordItemType(item.categoryUuid),
                    directoryId,
                    name: item.overview?.title,
                    username:
                        loginFields.find(
                            (field) => field.designation === "username",
                        )?.value ?? "",
                    password:
                        item.categoryUuid === "005"
                            ? (categoryPassword ?? designatedPassword)
                            : (designatedPassword ?? categoryPassword),
                    notes: item.details?.notesPlain,
                    tags: encodeTags(item.overview?.tags ?? []),
                    createdAt: parseTimestamp(item.createdAt),
                    modifiedAt: parseTimestamp(item.updatedAt),
                    passwordChangedAt: parseTimestamp(history[0]?.time),
                });
                const urls = [
                    ...(item.overview?.url
                        ? [{ url: item.overview.url, label: "" }]
                        : []),
                    ...(item.overview?.urls ?? []),
                ];
                assignNativeUrls(
                    credential,
                    urls.map(({ url, label }) => ({
                        URL: url ?? "",
                        MatchMode: CredentialURLMatchMode.ExactHost,
                        label,
                    })),
                    "1Password",
                    notices,
                );

                const alternatePassword =
                    item.categoryUuid === "005"
                        ? designatedPassword
                        : categoryPassword;
                if (
                    alternatePassword &&
                    alternatePassword !== credential.Password
                ) {
                    addCustomField(
                        credential,
                        "1Password alternate password",
                        alternatePassword,
                        CustomFieldType.MaskedText,
                    );
                }

                for (const field of loginFields) {
                    if (
                        field.designation === "username" ||
                        field.designation === "password"
                    ) {
                        continue;
                    }
                    if (field.fieldType === "U") {
                        assignNativeUrls(
                            credential,
                            [
                                {
                                    URL: field.value ?? "",
                                    MatchMode: CredentialURLMatchMode.ExactHost,
                                    label: field.name,
                                },
                            ],
                            "1Password",
                            notices,
                        );
                        continue;
                    }
                    addCustomField(
                        credential,
                        field.name || field.id || "1Password login field",
                        field.value,
                        field.fieldType === "C"
                            ? CustomFieldType.Boolean
                            : field.fieldType === "P" || hasSensitiveFields
                              ? CustomFieldType.MaskedText
                              : CustomFieldType.Text,
                    );
                }
                for (const section of item.details?.sections ?? []) {
                    for (const field of section.fields ?? []) {
                        const parsedValue = onePasswordValue(field.value);
                        const fieldName =
                            field.title || field.id || "1Password field";
                        const qualifiedName = section.title
                            ? `${section.title}: ${fieldName}`
                            : fieldName;
                        const fieldType = normalizedKey(field.type ?? "");
                        const fieldId = normalizedKey(field.id ?? "");
                        const isTotp =
                            parsedValue.kind === "totp" ||
                            ["totp", "otp", "one time password"].includes(
                                fieldType,
                            ) ||
                            ["totp", "otp"].includes(fieldId);
                        if (isTotp) {
                            assignTotp(
                                credential,
                                parsedValue.value,
                                notices,
                                "1Password",
                                qualifiedName,
                            );
                            if (credential.TOTP && !credential.TOTP.Label) {
                                credential.TOTP.Label = field.title ?? "";
                            }
                        } else if (
                            parsedValue.kind === "url" ||
                            normalizedKey(field.type ?? "") === "url"
                        ) {
                            assignNativeUrls(
                                credential,
                                [
                                    {
                                        URL: parsedValue.value,
                                        MatchMode:
                                            CredentialURLMatchMode.ExactHost,
                                        label: qualifiedName,
                                    },
                                ],
                                "1Password",
                                notices,
                            );
                        } else {
                            addCustomField(
                                credential,
                                qualifiedName,
                                parsedValue.value,
                                hasSensitiveFields
                                    ? CustomFieldType.MaskedText
                                    : parsedValue.type,
                            );
                        }
                    }
                }
                history.forEach((entry, index) => {
                    addCustomField(
                        credential,
                        `Password history ${index + 1}`,
                        entry.value,
                        CustomFieldType.MaskedText,
                    );
                    addCustomField(
                        credential,
                        `Password history ${index + 1} date`,
                        entry.time,
                    );
                });
                addCustomField(credential, "1Password item ID", item.uuid);
                addCustomField(
                    credential,
                    "1Password category",
                    item.categoryUuid,
                );
                addCustomField(
                    credential,
                    "1Password favorite",
                    (item.favIndex ?? 0) > 0,
                    CustomFieldType.Boolean,
                );
                if (item.state?.toLowerCase() === "archived") {
                    addCustomField(
                        credential,
                        "Archived",
                        true,
                        CustomFieldType.Boolean,
                    );
                    addImportNotice(notices, {
                        code: "ARCHIVED_STATUS_SAVED_AS_FIELD",
                        kind: "saved-differently",
                        title: 'Archived status will be saved as an "Archived" checkbox',
                        itemName: credential.Name,
                    });
                }
                addCustomField(
                    credential,
                    "1Password subtitle",
                    item.overview?.subtitle,
                );
                if (safeDirectoryName(vaultName) !== vaultName.trim()) {
                    addCustomField(
                        credential,
                        "1Password vault name",
                        vaultName,
                    );
                }
                addUnknownScalarFields(
                    credential,
                    item as unknown as Record<string, unknown>,
                    "1Password",
                    [
                        "uuid",
                        "favIndex",
                        "createdAt",
                        "updatedAt",
                        "state",
                        "categoryUuid",
                    ],
                );
                addUnknownScalarFields(
                    credential,
                    item.overview as unknown as
                        | Record<string, unknown>
                        | undefined,
                    "1Password overview",
                    ["title", "subtitle", "url", "tags"],
                );
                addUnknownScalarFields(
                    credential,
                    item.details as unknown as
                        | Record<string, unknown>
                        | undefined,
                    "1Password details",
                    ["password", "notesPlain"],
                );
                if (item.file || item.details?.documentAttributes) {
                    addImportNotice(notices, {
                        code: "ONEPASSWORD_ATTACHMENTS_UNSUPPORTED",
                        kind: "not-imported",
                        title: "Attached files can't be carried over",
                        detail: "The rest of each affected item will still be added.",
                        itemName: credential.Name,
                        requiresConfirmation: true,
                    });
                }
                credentials.push(finishCredential(credential));
            }
        }
    }

    if (skippedItems) {
        const deletedItems =
            skippedItems -
            (notices.find(
                (notice) => notice.code === "ONEPASSWORD_DOCUMENTS_SKIPPED",
            )?.count ?? 0);
        addImportNotice(notices, {
            code: "ONEPASSWORD_DELETED_ITEMS_SKIPPED",
            kind: "items-skipped",
            title: "Items in the source trash will not be added",
            count: deletedItems,
        });
    }
    return {
        source: "onepassword-1pux",
        credentials,
        directories,
        notices,
        skippedItems,
    };
};

const parseCryptexJSON = async (file: File): Promise<ImportResult> => {
    const parsed = await parseJsonFile<{
        Directories?: Directory[];
        Credentials?: Credential[];
    }>(file, "Cryptex Vault");
    if (
        !Array.isArray(parsed.Directories) ||
        !Array.isArray(parsed.Credentials)
    ) {
        throw new ImportFileError(
            "CRYPTEX_SCHEMA_MISMATCH",
            "This is not a current Cryptex Vault JSON export. Expected Directories and Credentials arrays.",
        );
    }
    parsed.Directories.forEach((directory, index) => {
        if (
            !directory ||
            typeof directory !== "object" ||
            Array.isArray(directory)
        ) {
            throw new ImportFileError(
                "CRYPTEX_DIRECTORY_INVALID",
                `This file can't be imported because Cryptex Vault folder ${index + 1} is invalid. Nothing was imported.`,
            );
        }
    });
    parsed.Credentials.forEach((credential, index) => {
        if (
            !credential ||
            typeof credential !== "object" ||
            Array.isArray(credential)
        ) {
            throw new ImportFileError(
                "CRYPTEX_CREDENTIAL_INVALID",
                `This file can't be imported because Cryptex Vault item ${index + 1} is invalid. Nothing was imported.`,
            );
        }
    });
    const notices: ImportNotice[] = [];
    let skippedItems = 0;
    let skippedDirectories = 0;
    const directories = parsed.Directories.filter((directory) => {
        if (!directory.Deleted) return true;
        skippedDirectories += 1;
        return false;
    });
    const credentials = parsed.Credentials.flatMap((rawCredential) => {
        if (rawCredential.Deleted) {
            skippedItems += 1;
            return [];
        }
        if (typeof rawCredential.Name !== "string") {
            throw new ImportFileError(
                "CRYPTEX_CREDENTIAL_INVALID",
                "A Cryptex Vault credential is missing its name.",
            );
        }
        const credential = Object.assign(new VaultCredential(), rawCredential);
        credential.URLMatchMode =
            rawCredential.URLMatchMode ?? CredentialURLMatchMode.ExactHost;
        credential.AdditionalURLs = Array.isArray(rawCredential.AdditionalURLs)
            ? rawCredential.AdditionalURLs.map((entry) =>
                  typeof entry === "string"
                      ? {
                            URL: entry,
                            MatchMode: CredentialURLMatchMode.ExactHost,
                        }
                      : entry,
              )
            : [];
        if (rawCredential.TOTP) {
            credential.TOTP = Object.assign(new TOTP(), rawCredential.TOTP);
        }
        credential.CustomFields = rawCredential.CustomFields ?? [];
        credential.Deleted = false;
        return [finishCredential(credential)];
    });
    if (skippedItems) {
        addImportNotice(notices, {
            code: "CRYPTEX_DELETED_RECORDS_SKIPPED",
            kind: "items-skipped",
            title: "Items in the source trash will not be added",
            count: skippedItems,
        });
    }
    if (skippedDirectories) {
        addImportNotice(notices, {
            code: "CRYPTEX_DELETED_DIRECTORIES_SKIPPED",
            kind: "not-imported",
            title: "Folders in the source trash will not be created",
            count: skippedDirectories,
        });
    }
    return {
        source: "cryptex-json",
        credentials,
        directories,
        notices,
        skippedItems,
    };
};

const validateImportResult = (result: ImportResult): ImportResult => {
    const directoryIds = new Set<string>();
    result.directories.forEach((directory, index) => {
        if (
            !directory.ID ||
            typeof directory.Name !== "string" ||
            !directory.Name.trim() ||
            directory.Name.length > 100
        ) {
            throw new ImportFileError(
                "IMPORT_DIRECTORY_INVALID",
                `This file can't be imported because folder ${index + 1} has an invalid name or ID. Nothing was imported.`,
            );
        }
        if (directoryIds.has(directory.ID)) {
            throw new ImportFileError(
                "IMPORT_DIRECTORY_ID_DUPLICATE",
                `This file can't be imported because more than one folder uses the ID "${directory.ID}". Nothing was imported.`,
            );
        }
        directoryIds.add(directory.ID);
    });

    result.credentials.forEach((credential, index) => {
        const validation = CredentialFormSchema.safeParse(credential);
        if (!validation.success) {
            const issue = validation.error.issues[0];
            const field = issue?.path.join(".");
            throw new ImportFileError(
                "IMPORT_ITEM_INVALID",
                `This file can't be imported because item ${index + 1}, "${credential.Name || "Unnamed item"}", has an invalid${field ? ` ${field}` : " value"}: ${issue?.message ?? "unknown error"}. Nothing was imported.`,
            );
        }
        if (
            credential.DirectoryID &&
            !directoryIds.has(credential.DirectoryID)
        ) {
            credential.DirectoryID = "";
            addFolderAdjustmentNotice(result.notices, 1, credential.Name);
        }
    });
    return result;
};

export const parseImportFile = async (
    source: ImportSource,
    file: File,
): Promise<ImportResult> => {
    if (file.size > MAX_IMPORT_FILE_BYTES) {
        throw new ImportFileError(
            "IMPORT_FILE_TOO_LARGE",
            "This file is larger than the 1 GB import limit.",
        );
    }
    let result: ImportResult;
    switch (source) {
        case "cryptex-json":
            result = await parseCryptexJSON(file);
            break;
        case "bitwarden-json":
            result = await parseBitwardenJSON(file);
            break;
        case "onepassword-csv":
            result = await parseOnePasswordCsv(file);
            break;
        case "onepassword-1pux":
            result = await parseOnePassword1Pux(file);
            break;
        case "keepass-xml":
            result = await parseKeePassXML(file);
            break;
        case "keepass-csv":
            result = await parseKeePassCsv(file);
            break;
        case "lastpass-csv":
            result = await parseLastPassCsv(file);
            break;
        case "chrome-csv":
            result = await parseChromeCsv(file);
            break;
        case "firefox-csv":
            result = await parseFirefoxCsv(file);
            break;
        default:
            throw new ImportFileError(
                "UNSUPPORTED_IMPORT_SOURCE",
                "The selected import source is not supported.",
            );
    }
    return validateImportResult(result);
};

const uniqueImportedDirectoryName = (
    directories: Directory[],
    requestedName: string,
): string => {
    const base = safeDirectoryName(requestedName);
    const isTaken = (name: string) =>
        directories.some(
            (directory) =>
                !directory.Deleted &&
                directory.Name.localeCompare(name, undefined, {
                    sensitivity: "base",
                }) === 0,
        );
    if (!isTaken(base)) return base;
    let copy = 2;
    while (true) {
        const suffix = ` (${copy})`;
        const candidate = `${base.slice(0, 100 - suffix.length)}${suffix}`;
        if (!isTaken(candidate)) return candidate;
        copy += 1;
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
        const created = await createDirectory(vaultCopy.Directories, {
            ID: null,
            Name: uniqueImportedDirectoryName(
                vaultCopy.Directories,
                directory.Name,
            ),
        });
        importedDirectories += 1;
        directoryIdMap.set(directory.ID, created.ID);
    }

    for (const credential of result.credentials) {
        const directoryID = directoryIdMap.get(credential.DirectoryID);
        const assimilated = await assimilateImportedCredential(
            ensureUniqueCustomFieldIDs({
                ...credential,
                DirectoryID: directoryID ?? "",
                Deleted: false,
            }),
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
