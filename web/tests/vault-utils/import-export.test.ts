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
import { ItemType } from "../../src/app_lib/proto/vault";
jest.mock("../../src/app_lib/vault-utils/vault", () => ({
    __esModule: true,
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
    Group: class {
        ID = "";
        Name = "";
        Icon = "";
        Color = "";
    },
}));
import {
    BitwardenJSON,
    CSV,
    CSVGetColNames,
    FieldsSchema,
    PossibleFields,
    Type,
    vaultToJSON,
    type FieldsSchemaType,
} from "../../src/app_lib/vault-utils/import-export";

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
        it("exports only groups and credentials and triggers download", async () => {
            const originalBlob = Blob;
            const blobPayloads: string[] = [];
            class MockBlob {
                constructor(parts: BlobPart[], _options?: BlobPropertyBag) {
                    blobPayloads.push(String(parts[0] ?? ""));
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
                Groups: [{ ID: "g1", Name: "Group 1", Icon: "x", Color: "y" }],
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
                    Groups: vault.Groups,
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

            vaultToJSON({ Groups: [], Credentials: [] } as any);

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
                GroupID: "",
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
        type FileReaderErrorLike = {
            onload: null | (() => void);
            onerror: null | (() => void);
            result: string | ArrayBuffer | null;
            error: Error | null;
            readAsText: (file: File) => void;
        };

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

            expect(output.groups).toEqual([
                {
                    ID: "folder-1",
                    Name: "Personal",
                    Icon: "",
                    Color: "",
                },
            ]);

            expect(output.credentials).toHaveLength(4);
            expect(first).toBeDefined();
            expect(second).toBeDefined();
            expect(third).toBeDefined();
            expect(fourth).toBeDefined();

            expect(first).toMatchObject({
                Type: ItemType.Credentials,
                GroupID: "folder-1",
                Name: "Email account",
                Username: "alice",
                Password: "pw",
                URL: "https://mail.example.com",
                Notes: "mail note",
                Deleted: false,
            });
            expect(first?.TOTP?.Secret).toBe("TOTPSECRET");
            expect(first?.CustomFields).toHaveLength(3);
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

            expect(output.groups).toEqual([]);
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
            expect(fields).toHaveLength(1);
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
    });

    describe("Type enum and FieldsSchema", () => {
        it("exposes stable numeric Type enum values", () => {
            expect(Type.GenericCSV).toBe(0);
            expect(Type.Bitwarden).toBe(1);
            expect(Type.KeePass2).toBe(2);
        });

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
            ).toThrow();
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
