import {
    describe,
    it,
    expect,
    jest,
    beforeEach,
    afterEach,
} from "@jest/globals";

jest.mock("papaparse", () => ({
    __esModule: true,
    default: {
        parse: jest.fn(),
    },
}));

import Papa from "papaparse";

import { CredentialConstants } from "../../src/utils/consts";
import {
    CredentialURLMatchMode,
    ItemType,
} from "@cryptex-industries/vault-core/proto";
jest.mock("@cryptex-industries/vault-core/vault-utils/vault", () => ({
    __esModule: true,
    assimilateImportedCredential: jest.fn(async (credential: any) => ({
        ...credential,
        ID: `assimilated-${credential.Name}`,
        Hash: `hash-${credential.Name}`,
    })),
    createDirectory: jest.fn(async (directories: any[], form: any) => {
        const directory = {
            ...form,
            ID: form.ID ?? `directory-${form.Name}`,
            Version: 0,
            Hash: `hash-${form.Name}`,
            DateModifiedTimestamp: 1,
            Deleted: false,
        };
        directories.push(directory);
        return directory;
    }),
    Directory: class {},
    Vault: class {
        Directories: any[] = [];
        Credentials: any[] = [];
    },
    VaultCredential: class {
        ID = "";
        Name = "";
        Hash = "";
    },
    TOTP: class {
        Label = "";
        Secret = "";
        Period = 30;
        Digits = 6;
        Algorithm = 0;
    },
    CustomField: class {
        ID = "-1";
        Name = "";
        Type = 0;
        Value = "";
    },
}));
import {
    BitwardenJSON,
    CSV,
    CSVGetColNames,
    FieldsSchema,
    PossibleFields,
    applyImportToVault,
    parseImportFile,
    vaultToJSON,
    type FieldsSchemaType,
    type ImportResult,
} from "@cryptex-industries/vault-core/vault-utils/import-export";

describe("vault-utils/import-export", () => {
    const mockPapaParse = Papa.parse as jest.Mock;
    type ParseOptions = {
        step?: (
            row: unknown,
            parser: {
                abort: () => void;
            },
        ) => void;
        complete?: (results: unknown) => void | Promise<void>;
        error?: (error: Error) => void;
    };

    beforeEach(() => {
        jest.clearAllMocks();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe("vaultToJSON", () => {
        it("exports only directories and credentials and triggers download", async () => {
            const originalBlob = Blob;
            const blobPayloads: string[] = [];
            class MockBlob {
                constructor(parts: BlobPart[], _options?: BlobPropertyBag) {
                    blobPayloads.push(
                        typeof parts[0] === "string" ? parts[0] : "",
                    );
                }
            }
            Object.defineProperty(globalThis, "Blob", {
                configurable: true,
                writable: true,
                value: MockBlob as unknown as typeof Blob,
            });

            const createObjectURL = jest
                .fn()
                .mockReturnValue("blob:download-url");
            const revokeObjectURL = jest.fn();
            Object.defineProperty(URL, "createObjectURL", {
                configurable: true,
                writable: true,
                value: createObjectURL,
            });
            Object.defineProperty(URL, "revokeObjectURL", {
                configurable: true,
                writable: true,
                value: revokeObjectURL,
            });
            const click = jest.fn();
            const createElement = jest
                .spyOn(document, "createElement")
                .mockReturnValue({
                    href: "",
                    download: "",
                    click,
                } as unknown as HTMLAnchorElement);

            const vault = {
                Directories: [
                    {
                        ID: "d1",
                        Name: "Directory 1",
                        Deleted: false,
                    },
                ],
                Credentials: [{ ID: "c1", Name: "Credential 1" }],
                LinkedDevices: { ID: "should-not-export" },
            } as any;

            try {
                vaultToJSON(vault);

                expect(createElement).toHaveBeenCalledWith("a");
                expect(createObjectURL).toHaveBeenCalledTimes(1);
                expect(revokeObjectURL).toHaveBeenCalledWith(
                    "blob:download-url",
                );
                expect(click).toHaveBeenCalledTimes(1);

                expect(blobPayloads).toHaveLength(1);
                const payload = blobPayloads[0] ?? "";
                const parsed = JSON.parse(payload);

                expect(parsed).toEqual({
                    Directories: vault.Directories,
                    Credentials: vault.Credentials,
                });
                expect(parsed.LinkedDevices).toBeUndefined();
            } finally {
                Object.defineProperty(globalThis, "Blob", {
                    configurable: true,
                    writable: true,
                    value: originalBlob,
                });
            }
        });

        it("uses timestamped export filename", () => {
            jest.spyOn(Date, "now").mockReturnValue(1701234567890);

            const createObjectURL = jest.fn().mockReturnValue("blob:test");
            const revokeObjectURL = jest.fn();
            Object.defineProperty(URL, "createObjectURL", {
                configurable: true,
                writable: true,
                value: createObjectURL,
            });
            Object.defineProperty(URL, "revokeObjectURL", {
                configurable: true,
                writable: true,
                value: revokeObjectURL,
            });

            const anchor = { href: "", download: "", click: jest.fn() };
            jest.spyOn(document, "createElement").mockReturnValue(
                anchor as unknown as HTMLAnchorElement,
            );

            vaultToJSON({ Directories: [], Credentials: [] } as any);

            expect(anchor.download).toBe(
                "cryptexvault-export-1701234567890.json",
            );
        });
    });

    describe("CSVGetColNames", () => {
        it("returns CSV header field names and aborts parsing after first step", () => {
            const onSuccess = jest.fn();
            const onFailure = jest.fn();
            const abort = jest.fn();

            mockPapaParse.mockImplementation((_file, options) => {
                const parseOptions = options as ParseOptions;
                parseOptions.step?.({}, { abort });
                parseOptions.complete?.({
                    data: [],
                    errors: [],
                    meta: {
                        fields: ["Name", "Username", "Password"],
                    },
                });
            });

            CSVGetColNames({} as File, onSuccess, onFailure);

            expect(abort).toHaveBeenCalledTimes(1);
            expect(onSuccess).toHaveBeenCalledWith([
                "Name",
                "Username",
                "Password",
            ]);
            expect(onFailure).not.toHaveBeenCalled();
        });

        it("forwards parser errors to onFailure", () => {
            const onSuccess = jest.fn();
            const onFailure = jest.fn();
            const parseError = new Error("CSV parse failed");

            mockPapaParse.mockImplementation((_file, options) => {
                const parseOptions = options as ParseOptions;
                parseOptions.error?.(parseError);
            });

            CSVGetColNames({} as File, onSuccess, onFailure);

            expect(onFailure).toHaveBeenCalledWith(parseError);
            expect(onSuccess).not.toHaveBeenCalled();
        });

        it("returns empty headers when parser complete has null meta", () => {
            const onSuccess = jest.fn();
            const onFailure = jest.fn();

            mockPapaParse.mockImplementation((_file, options) => {
                const parseOptions = options as ParseOptions;
                parseOptions.complete?.(null);
            });

            CSVGetColNames({} as File, onSuccess, onFailure);

            expect(onSuccess).toHaveBeenCalledWith([]);
            expect(onFailure).not.toHaveBeenCalled();
        });
    });

    describe("CSV", () => {
        const fields = {
            Name: "display_name",
            Username: "user_name",
            Password: "pass_value",
            TOTP: "totp_secret",
            Tags: "labels",
            URL: "website",
            Notes: "comment",
            DateCreatedTimestamp: "created_ts",
            DateModifiedTimestamp: "modified_ts",
            DatePasswordChangedTimestamp: "password_changed_ts",
            TagDelimiter: ";",
            Deleted: "is_deleted",
        } as unknown as FieldsSchemaType;

        it("maps CSV rows into credentials with defaults and conversions", async () => {
            const now = 1700000000000;
            jest.spyOn(Date, "now").mockReturnValue(now);

            const onSuccess = jest.fn(async (_credentials: unknown[]) => {});
            const onFailure = jest.fn();

            mockPapaParse.mockImplementation((_file, options) => {
                const parseOptions = options as ParseOptions;
                void parseOptions.complete?.({
                    data: [
                        {
                            display_name: "Mail",
                            user_name: "alice",
                            pass_value: "s3cret",
                            totp_secret: "BASE32SECRET",
                            labels: "work;important",
                            website: "https://mail.example.com",
                            comment: "main account",
                            created_ts: "100",
                            modified_ts: "200",
                            password_changed_ts: "300",
                            is_deleted: "true",
                        },
                        {
                            display_name: "",
                            user_name: "",
                            pass_value: "",
                            labels: "",
                            website: "",
                            comment: "",
                            created_ts: "invalid-number",
                        },
                    ],
                    errors: [],
                    meta: {},
                });
            });

            await CSV({} as File, fields, onSuccess, onFailure);

            expect(onFailure).not.toHaveBeenCalled();
            expect(onSuccess).toHaveBeenCalledTimes(1);

            const firstCall = onSuccess.mock.calls.at(0);
            expect(firstCall).toBeDefined();
            if (!firstCall) throw new Error("Missing onSuccess call");

            const credentials = firstCall[0] as Array<{
                TOTP?: { Secret: string };
                DateCreatedTimestamp: number;
                DateModifiedTimestamp: number;
                DatePasswordChangedTimestamp: number;
            }>;
            expect(credentials).toHaveLength(2);
            const [first, second] = credentials;
            expect(first).toBeDefined();
            expect(second).toBeDefined();

            expect(first).toMatchObject({
                Type: ItemType.Credentials,
                DirectoryID: "",
                Name: "Mail",
                Username: "alice",
                Password: "s3cret",
                Tags: `work${CredentialConstants.TAG_SEPARATOR}important`,
                URL: "https://mail.example.com",
                Notes: "main account",
                DateCreatedTimestamp: 100,
                DateModifiedTimestamp: 200,
                DatePasswordChangedTimestamp: 300,
                Deleted: true,
            });
            expect(first?.TOTP?.Secret).toBe("BASE32SECRET");

            expect(second).toMatchObject({
                Name: "Unnamed item",
                Username: "",
                Password: "",
                Tags: undefined,
                URL: "",
                Notes: "",
                DateCreatedTimestamp: now,
                DateModifiedTimestamp: now,
                DatePasswordChangedTimestamp: now,
                Deleted: false,
            });
            expect(second?.TOTP).toBeUndefined();
        });

        it("forwards errors thrown by onSuccess", async () => {
            const onSuccessError = new Error("write failed");
            const onSuccess = jest.fn(async (_credentials: unknown[]) => {
                throw onSuccessError;
            });
            const onFailure = jest.fn();

            mockPapaParse.mockImplementation((_file, options) => {
                const parseOptions = options as ParseOptions;
                void parseOptions.complete?.({
                    data: [{}],
                    errors: [],
                    meta: {},
                });
            });

            await CSV({} as File, fields, onSuccess, onFailure);

            expect(onFailure).toHaveBeenCalledWith(onSuccessError);
        });

        it("forwards parser errors to onFailure", async () => {
            const onSuccess = jest.fn(async (_credentials: unknown[]) => {});
            const onFailure = jest.fn();
            const parseError = new Error("invalid csv");

            mockPapaParse.mockImplementation((_file, options) => {
                const parseOptions = options as ParseOptions;
                parseOptions.error?.(parseError);
            });

            await CSV({} as File, fields, onSuccess, onFailure);

            expect(onFailure).toHaveBeenCalledWith(parseError);
            expect(onSuccess).not.toHaveBeenCalled();
        });

        it("does not invoke callbacks when parser completes with null results", async () => {
            const onSuccess = jest.fn(async (_credentials: unknown[]) => {});
            const onFailure = jest.fn();

            mockPapaParse.mockImplementation((_file, options) => {
                const parseOptions = options as ParseOptions;
                void parseOptions.complete?.(null);
            });

            await CSV({} as File, fields, onSuccess, onFailure);

            expect(onSuccess).not.toHaveBeenCalled();
            expect(onFailure).not.toHaveBeenCalled();
        });

        it("fails safely when hostile CSV values break assumptions", async () => {
            const onSuccess = jest.fn(async (_credentials: unknown[]) => {});
            const onFailure = jest.fn();

            // Real-world malformed export: labels is numeric, which makes split() fail.
            mockPapaParse.mockImplementation((_file, options) => {
                const parseOptions = options as ParseOptions;
                void parseOptions.complete?.({
                    data: [
                        {
                            display_name: "Bad row",
                            labels: 12345,
                        },
                    ],
                    errors: [],
                    meta: {},
                });
            });

            await CSV({} as File, fields, onSuccess, onFailure);

            expect(onFailure).toHaveBeenCalledTimes(1);
            expect(onSuccess).not.toHaveBeenCalled();
        });
    });

    describe("BitwardenJSON", () => {
        class MockFileReader {
            static nextResult = "";

            static failWithError = false;

            static nextError: Error | null = null;

            onload: null | (() => void) = null;

            onerror: null | (() => void) = null;

            result: string | ArrayBuffer | null = null;

            error: Error | null = null;

            readAsText(_file: File) {
                if (MockFileReader.failWithError) {
                    this.error =
                        MockFileReader.nextError ?? new Error("read failed");
                    this.onerror?.();
                    return;
                }

                this.result = MockFileReader.nextResult;
                this.onload?.();
            }
        }

        beforeEach(() => {
            Object.defineProperty(window, "FileReader", {
                configurable: true,
                writable: true,
                value: MockFileReader,
            });
            MockFileReader.nextResult = "";
            MockFileReader.failWithError = false;
            MockFileReader.nextError = null;
        });

        it("imports Bitwarden items, maps types, groups and metadata", async () => {
            const now = 1710000000000;
            jest.spyOn(Date, "now").mockReturnValue(now);

            MockFileReader.nextResult = JSON.stringify({
                folders: [{ id: "folder-1", name: "Personal" }],
                items: [
                    {
                        id: "login-1",
                        folderId: "folder-1",
                        name: "Email account",
                        notes: "mail note",
                        creationDate: "2024-01-01T00:00:00.000Z",
                        revisionDate: "2024-01-02T00:00:00.000Z",
                        passwordRevisionDate: "2024-01-03T00:00:00.000Z",
                        type: 1,
                        login: {
                            username: "alice",
                            password: "pw",
                            totp: "TOTPSECRET",
                            uris: [
                                {
                                    match: "default",
                                    uri: "https://mail.example.com",
                                },
                            ],
                        },
                        fields: [
                            { name: "text", value: "value-1", type: 0 },
                            { name: "masked", value: "value-2", type: 1 },
                            { name: "bool", value: "true", type: 2 },
                            { name: "linked", value: "ignored", type: 3 },
                        ],
                    },
                    {
                        id: "secure-note-1",
                        type: 2,
                        name: "A secure note",
                        notes: "note body",
                    },
                    {
                        id: "identity-1",
                        type: 4,
                        name: "Identity item",
                        creationDate: "not-a-date",
                        revisionDate: "also-invalid",
                    },
                    {
                        id: "card-1",
                        type: 3,
                        name: "Card item",
                        passwordHistory: [
                            {
                                password: "x",
                                lastUsedDate: "2024-01-04T00:00:00.000Z",
                            },
                        ],
                    },
                ],
            });

            const output = await BitwardenJSON({} as File);
            const [first, second, third, fourth] = output.credentials;

            expect(output.directories).toEqual([
                expect.objectContaining({
                    ID: "folder-1",
                    Name: "Personal",
                }),
            ]);

            expect(output.credentials).toHaveLength(4);
            expect(first).toBeDefined();
            expect(second).toBeDefined();
            expect(third).toBeDefined();
            expect(fourth).toBeDefined();

            expect(first).toMatchObject({
                Type: ItemType.Credentials,
                DirectoryID: "folder-1",
                Name: "Email account",
                Username: "alice",
                Password: "pw",
                URL: "https://mail.example.com",
                Notes: "mail note",
                Deleted: false,
            });
            expect(first?.TOTP?.Secret).toBe("TOTPSECRET");
            expect(first?.CustomFields).toHaveLength(4);
            expect(first?.DateCreatedTimestamp).toBe(
                new Date("2024-01-01T00:00:00.000Z").getTime(),
            );
            expect(first?.DateModifiedTimestamp).toBe(
                new Date("2024-01-02T00:00:00.000Z").getTime(),
            );
            expect(first?.DatePasswordChangedTimestamp).toBe(
                new Date("2024-01-03T00:00:00.000Z").getTime(),
            );

            expect(second?.Type).toBe(ItemType.Note);
            expect(third?.Type).toBe(ItemType.Identity);
            expect(fourth?.Type).toBe(ItemType.Credentials);

            // Invalid date strings fall back to deterministic "now".
            expect(third?.DateCreatedTimestamp).toBe(now);
            expect(third?.DateModifiedTimestamp).toBe(now);
            expect(third?.DatePasswordChangedTimestamp).toBe(now);

            // Password history timestamp is used when passwordRevisionDate is absent.
            expect(fourth?.DatePasswordChangedTimestamp).toBe(
                new Date("2024-01-04T00:00:00.000Z").getTime(),
            );
        });

        it("rejects when JSON parsing fails", async () => {
            MockFileReader.nextResult = "{invalid-json";

            await expect(BitwardenJSON({} as File)).rejects.toBeTruthy();
        });

        it("rejects when file reader errors", async () => {
            MockFileReader.failWithError = true;
            MockFileReader.nextError = new Error("reader failed");

            await expect(BitwardenJSON({} as File)).rejects.toThrow(
                "reader failed",
            );
        });

        it("supports exports without folders and with timestamp fallback chain", async () => {
            MockFileReader.nextResult = JSON.stringify({
                items: [
                    {
                        id: "fallback-1",
                        type: 1,
                        name: "Fallback item",
                        revisionDate: "2025-01-02T00:00:00.000Z",
                        passwordHistory: [
                            {
                                password: "old",
                                lastUsedDate: "2025-01-03T00:00:00.000Z",
                            },
                        ],
                    },
                ],
            });

            const output = await BitwardenJSON({} as File);
            const first = output.credentials[0];

            expect(output.directories).toEqual([]);
            expect(output.credentials).toHaveLength(1);
            expect(first).toBeDefined();
            expect(first?.DateCreatedTimestamp).toBe(
                new Date("2025-01-02T00:00:00.000Z").getTime(),
            );
            expect(first?.DateModifiedTimestamp).toBe(
                new Date("2025-01-02T00:00:00.000Z").getTime(),
            );
            expect(first?.DatePasswordChangedTimestamp).toBe(
                new Date("2025-01-03T00:00:00.000Z").getTime(),
            );
        });

        it("rejects malformed Bitwarden payloads missing items", async () => {
            MockFileReader.nextResult = JSON.stringify({
                folders: [{ id: "f", name: "Folder" }],
            });

            await expect(BitwardenJSON({} as File)).rejects.toBeTruthy();
        });

        it("defaults item Name to 'Import' when missing", async () => {
            MockFileReader.nextResult = JSON.stringify({
                items: [
                    {
                        id: "nameless",
                        type: 1,
                        // name omitted on purpose
                    },
                ],
            });

            const output = await BitwardenJSON({} as File);
            expect(output.credentials).toHaveLength(1);
            expect(output.credentials[0]?.Name).toBe("Import");
            // Identity-style empty login: URL/Username/Password default to "".
            expect(output.credentials[0]?.Username).toBe("");
            expect(output.credentials[0]?.Password).toBe("");
            expect(output.credentials[0]?.URL).toBe("");
        });

        it("filters out custom fields of type >= 3 (linked fields)", async () => {
            MockFileReader.nextResult = JSON.stringify({
                items: [
                    {
                        id: "with-linked",
                        type: 1,
                        name: "linked-field-item",
                        fields: [
                            { name: "text", value: "ok", type: 0 },
                            { name: "linked", value: "drop", type: 3 },
                            { name: "future", value: "drop", type: 99 },
                        ],
                    },
                ],
            });

            const output = await BitwardenJSON({} as File);
            const fields = output.credentials[0]?.CustomFields ?? [];
            expect(fields).toHaveLength(2);
            expect(fields[0]?.Name).toBe("text");
            expect(fields[0]?.Type).toBe(0);
        });

        it("treats unknown Bitwarden item types as Credentials (default branch)", async () => {
            MockFileReader.nextResult = JSON.stringify({
                items: [
                    {
                        id: "unknown",
                        type: 99,
                        name: "Unknown type",
                    },
                ],
            });

            const output = await BitwardenJSON({} as File);
            expect(output.credentials[0]?.Type).toBe(ItemType.Credentials);
        });

        it("parses Bitwarden otpauth TOTP URLs into usable TOTP settings", async () => {
            MockFileReader.nextResult = JSON.stringify({
                items: [
                    {
                        id: "totp-url",
                        type: 1,
                        name: "TOTP URL",
                        login: {
                            username: "alice",
                            password: "pw",
                            totp: "otpauth://totp/Example:alice?secret=JBSWY3DPEHPK3PXP&issuer=Example&period=60&digits=8&algorithm=SHA256",
                            uris: [],
                        },
                    },
                ],
            });

            const output = await BitwardenJSON({} as File);

            expect(output.credentials[0]?.TOTP).toMatchObject({
                Label: "Example:alice",
                Secret: "JBSWY3DPEHPK3PXP",
                Period: 60,
                Digits: 8,
                Algorithm: 1,
            });
        });

        it("parseImportFile preserves Bitwarden extras and warnings", async () => {
            MockFileReader.nextResult = JSON.stringify({
                folders: [{ id: "cards", name: "Cards" }],
                items: [
                    {
                        id: "card-1",
                        folderId: "cards",
                        type: 3,
                        name: "Visa",
                        card: {
                            cardholderName: "Alice Example",
                            brand: "Visa",
                            number: "4111111111111111",
                            expMonth: 12,
                            expYear: 2030,
                            code: "123",
                        },
                        fido2Credentials: [{ credentialId: "passkey" }],
                    },
                    {
                        id: "login-1",
                        type: 1,
                        name: "Multi URL",
                        login: {
                            username: "alice",
                            password: "pw",
                            totp: "",
                            uris: [
                                { uri: "https://primary.example", match: null },
                                {
                                    uri: "https://secondary.example",
                                    match: null,
                                },
                            ],
                        },
                    },
                ],
            });

            const output = await parseImportFile("bitwarden-json", {} as File);
            const [card, login] = output.credentials;

            expect(output.directories).toHaveLength(1);
            expect(output.warnings).toEqual([
                expect.objectContaining({
                    code: "BITWARDEN_PASSKEYS_UNSUPPORTED",
                }),
            ]);
            expect(card?.CustomFields).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        Name: "Card number",
                        Value: "4111111111111111",
                    }),
                    expect.objectContaining({
                        Name: "Card security code",
                        Value: "123",
                    }),
                ]),
            );
            expect(
                new Set(card?.CustomFields.map((field) => field.ID)).size,
            ).toBe(card?.CustomFields.length);
            expect(card?.CustomFields.map((field) => field.ID)).not.toContain(
                "-1",
            );
            expect(login?.URL).toBe("https://primary.example");
            expect(login?.URLMatchMode).toBe(CredentialURLMatchMode.Domain);
            expect(login?.AdditionalURLs).toEqual([
                {
                    URL: "https://secondary.example",
                    MatchMode: CredentialURLMatchMode.Domain,
                },
            ]);
        });
    });

    describe("parseImportFile", () => {
        it("imports Cryptex Vault JSON exports and skips deleted tombstones", async () => {
            const fileContents = JSON.stringify({
                Directories: [
                    {
                        ID: "source-group",
                        Name: "Cryptex Group",
                        Version: 0,
                        Hash: "",
                        DateModifiedTimestamp: 1,
                        Deleted: false,
                    },
                ],
                Credentials: [
                    {
                        ID: "source-credential",
                        Version: 0,
                        Type: ItemType.Credentials,
                        DirectoryID: "source-group",
                        Name: "Cryptex Login",
                        Username: "alice",
                        Password: "pw",
                        URL: "https://cryptex.example.test",
                        AdditionalURLs: ["https://legacy.example.test"],
                        Notes: "from export",
                        CustomFields: [
                            {
                                ID: "-1",
                                Name: "Imported Field",
                                Type: 0,
                                Value: "value",
                            },
                        ],
                        DateCreated: "",
                        DateCreatedTimestamp: 100,
                        DateModifiedTimestamp: 200,
                        DatePasswordChangedTimestamp: 300,
                        Deleted: false,
                        Hash: "old-hash",
                    },
                    {
                        ID: "deleted",
                        Version: 0,
                        Type: ItemType.Credentials,
                        DirectoryID: "source-group",
                        Name: "Deleted Login",
                        Username: "",
                        Password: "",
                        URL: "",
                        Notes: "",
                        CustomFields: [],
                        DateCreated: "",
                        DateCreatedTimestamp: 100,
                        DateModifiedTimestamp: 100,
                        DatePasswordChangedTimestamp: 100,
                        Deleted: true,
                        Hash: "",
                    },
                ],
            });
            const file = {
                text: async () => fileContents,
            } as File;

            const output = await parseImportFile("cryptex-json", file);

            expect(output.source).toBe("cryptex-json");
            expect(output.directories).toHaveLength(1);
            expect(output.credentials).toHaveLength(1);
            expect(output.skipped).toBe(1);
            expect(output.warnings).toEqual([
                expect.objectContaining({
                    code: "CRYPTEX_DELETED_ITEMS_SKIPPED",
                }),
            ]);
            expect(output.credentials[0]).toMatchObject({
                DirectoryID: "source-group",
                Name: "Cryptex Login",
                Username: "alice",
                Password: "pw",
            });
            expect(output.credentials[0]?.URLMatchMode).toBe(
                CredentialURLMatchMode.ExactHost,
            );
            expect(output.credentials[0]?.AdditionalURLs).toEqual([
                {
                    URL: "https://legacy.example.test",
                    MatchMode: CredentialURLMatchMode.ExactHost,
                },
            ]);
            expect(output.credentials[0]?.CustomFields[0]?.ID).not.toBe("-1");
        });

        it("maps LastPass CSV into credentials and directories", async () => {
            mockPapaParse.mockImplementation((_file, options) => {
                const parseOptions = options as ParseOptions;
                parseOptions.complete?.({
                    data: [
                        {
                            url: "https://example.com",
                            username: "alice",
                            password: "pw",
                            extra: "note body",
                            name: "Example",
                            grouping: "Work",
                            fav: "1",
                        },
                    ],
                    errors: [],
                    meta: {},
                });
            });

            const output = await parseImportFile("lastpass-csv", {} as File);

            expect(output.directories).toEqual([
                expect.objectContaining({
                    ID: "import-directory:Work",
                    Name: "Work",
                }),
            ]);
            expect(output.credentials[0]).toMatchObject({
                DirectoryID: "import-directory:Work",
                Name: "Example",
                Username: "alice",
                Password: "pw",
                URL: "https://example.com",
                Notes: "note body",
            });
        });
    });

    describe("applyImportToVault", () => {
        it("imports every credential as a new item and does not mutate input vault", async () => {
            const vault = {
                Directories: [{ ID: "existing", Name: "Existing" }],
                Credentials: [{ ID: "old", Name: "Existing Login" }],
            } as any;
            const importResult = {
                source: "cryptex-json",
                directories: [{ ID: "d1", Name: "Imported" }],
                credentials: [
                    { ID: "source-1", Name: "Existing Login" },
                    { ID: "source-2", Name: "New Login" },
                ],
                warnings: [],
                skipped: 0,
            } as unknown as ImportResult;

            const output = await applyImportToVault(vault, importResult);

            expect(vault.Credentials).toHaveLength(1);
            expect(output.vault).not.toBe(vault);
            expect(output.vault.Directories).toHaveLength(2);
            expect(output.vault.Credentials).toHaveLength(3);
            expect(output.vault.Credentials.slice(1)).toEqual([
                expect.objectContaining({
                    ID: "assimilated-Existing Login",
                    Name: "Existing Login",
                }),
                expect.objectContaining({
                    ID: "assimilated-New Login",
                    Name: "New Login",
                }),
            ]);
        });

        it("remaps imported credential directories by matching names", async () => {
            const vault = {
                Directories: [{ ID: "target-directory", Name: "Imported" }],
                Credentials: [],
            } as any;
            const importResult = {
                source: "cryptex-json",
                directories: [
                    {
                        ID: "source-directory",
                        Name: "Imported",
                    },
                ],
                credentials: [
                    {
                        ID: "source-1",
                        DirectoryID: "source-directory",
                        Name: "Grouped Login",
                        CustomFields: [],
                    },
                ],
                warnings: [],
                skipped: 0,
            } as unknown as ImportResult;

            const output = await applyImportToVault(vault, importResult);

            expect(output.vault.Directories).toHaveLength(1);
            expect(output.vault.Credentials[0]).toEqual(
                expect.objectContaining({
                    DirectoryID: "target-directory",
                    Name: "Grouped Login",
                }),
            );
        });
    });

    describe("Type enum and FieldsSchema", () => {
        it("PossibleFields covers each importable Fields key", () => {
            const fieldNames = PossibleFields.map((f) => f.field).sort();
            expect(fieldNames).toEqual(
                [
                    "Name",
                    "Username",
                    "Password",
                    "TOTP",
                    "Tags",
                    "URL",
                    "Notes",
                    "DateCreatedTimestamp",
                    "DateModifiedTimestamp",
                    "DatePasswordChangedTimestamp",
                    "Deleted",
                ].sort(),
            );
        });

        it("parses a complete FieldsSchema mapping", () => {
            const parsed = FieldsSchema.parse({
                Name: "Name",
                Username: "Username",
                Password: "Password",
                TOTP: "TOTP",
                Tags: "Tags",
                URL: "URL",
                Notes: "Notes",
                DateCreatedTimestamp: 1,
                DateModifiedTimestamp: 2,
                DatePasswordChangedTimestamp: 3,
                TagDelimiter: ",",
                Deleted: "Deleted",
            });
            expect(parsed.Name).toBe("Name");
            expect(parsed.DateCreatedTimestamp).toBe(1);
            expect(parsed.TagDelimiter).toBe(",");
        });

        it("accepts null values for all FieldsSchema entries", () => {
            const parsed = FieldsSchema.parse({
                Name: null,
                Username: null,
                Password: null,
                TOTP: null,
                Tags: null,
                URL: null,
                Notes: null,
                DateCreatedTimestamp: null,
                DateModifiedTimestamp: null,
                DatePasswordChangedTimestamp: null,
                TagDelimiter: null,
                Deleted: null,
            });
            expect(parsed.Name).toBeNull();
            expect(parsed.DateCreatedTimestamp).toBeNull();
        });

        it("rejects FieldsSchema when a timestamp field is a string", () => {
            expect(() =>
                FieldsSchema.parse({
                    Name: "Name",
                    Username: "Username",
                    Password: "Password",
                    TOTP: "TOTP",
                    Tags: "Tags",
                    URL: "URL",
                    Notes: "Notes",
                    DateCreatedTimestamp: "not-a-number",
                    DateModifiedTimestamp: 2,
                    DatePasswordChangedTimestamp: 3,
                    TagDelimiter: ",",
                    Deleted: "Deleted",
                }),
            ).toThrow("Expected number");
        });
    });

    describe("CSV row defaults", () => {
        const fields = {
            Name: "display_name",
            Username: "user_name",
            Password: "pass_value",
            TOTP: "totp_secret",
            Tags: "labels",
            URL: "website",
            Notes: "comment",
            DateCreatedTimestamp: "created_ts",
            DateModifiedTimestamp: "modified_ts",
            DatePasswordChangedTimestamp: "password_changed_ts",
            TagDelimiter: ",",
            Deleted: "is_deleted",
        } as unknown as FieldsSchemaType;

        it("defaults Name to 'Import' when the mapped Name column is absent from row", async () => {
            const onSuccess = jest.fn(async (_credentials: unknown[]) => {});
            const onFailure = jest.fn();

            (Papa.parse as jest.Mock).mockImplementation((_file, options) => {
                const parseOptions = options as {
                    complete?: (results: unknown) => void | Promise<void>;
                };
                void parseOptions.complete?.({
                    data: [
                        // display_name column intentionally omitted; other
                        // mapped columns also missing — should not crash.
                        { user_name: "alice" },
                    ],
                    errors: [],
                    meta: {},
                });
            });

            await CSV({} as File, fields, onSuccess, onFailure);

            expect(onFailure).not.toHaveBeenCalled();
            const firstCall = onSuccess.mock.calls.at(0);
            const credentials = firstCall?.[0] as Array<{ Name: string }>;
            expect(credentials).toHaveLength(1);
            expect(credentials[0]?.Name).toBe("Import");
        });
    });
});
