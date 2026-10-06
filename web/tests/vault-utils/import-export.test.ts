import { describe, expect, it } from "@jest/globals";
import { webcrypto } from "node:crypto";
import { TextDecoder, TextEncoder } from "node:util";
import JSZip from "jszip";

Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: webcrypto,
});
Object.defineProperty(globalThis, "TextEncoder", {
    configurable: true,
    value: TextEncoder,
});
Object.defineProperty(globalThis, "TextDecoder", {
    configurable: true,
    value: TextDecoder,
});

import {
    applyImportToVault,
    getImportErrorMessage,
    ImportFileError,
    ImportSources,
    MAX_IMPORT_FILE_BYTES,
    parseImportFile,
    vaultToJSONString,
} from "@cryptex-industries/vault-core/vault-utils/import-export";
import {
    CredentialURLMatchMode,
    CustomFieldType,
    ItemType,
    TOTPAlgorithm,
} from "@cryptex-industries/vault-core/proto";
import {
    Directory,
    Vault,
} from "@cryptex-industries/vault-core/vault-utils/vault";

const textFile = (name: string, contents: string, type = "text/plain"): File =>
    new File([contents], name, { type });

const jsonFile = (value: unknown): File =>
    textFile("export.json", JSON.stringify(value), "application/json");

const customField = (
    credential: Awaited<
        ReturnType<typeof parseImportFile>
    >["credentials"][number],
    name: string,
) => credential.CustomFields.find((field) => field.Name === name);

const make1Pux = async (data: unknown, withFile = false): Promise<File> => {
    const zip = new JSZip();
    zip.file(
        "export.attributes",
        JSON.stringify({
            version: 3,
            description: "1Password Unencrypted Export",
            createdAt: 1_700_000_000,
        }),
    );
    zip.file("export.data", JSON.stringify(data));
    if (withFile) zip.file("files/document___receipt.txt", "contents");
    const bytes = await zip.generateAsync({ type: "uint8array" });
    const buffer = bytes.slice().buffer as ArrayBuffer;
    return new File([buffer], "export.1pux", { type: "application/zip" });
};

const baseCredential = (overrides: Record<string, unknown> = {}) => ({
    ID: "source-id",
    Version: 0,
    Type: ItemType.Credentials,
    DirectoryID: "",
    Name: "Example",
    Username: "user",
    Password: " secret ",
    URL: "https://example.com/login",
    URLMatchMode: CredentialURLMatchMode.ExactHost,
    AdditionalURLs: [],
    Notes: "notes",
    CustomFields: [],
    DateCreated: "",
    DateCreatedTimestamp: 1,
    DateModifiedTimestamp: 2,
    DatePasswordChangedTimestamp: 3,
    Deleted: false,
    Hash: "",
    ...overrides,
});

describe("vault import and export", () => {
    it("exports the current Cryptex structure without deleted directories", () => {
        const vault = Object.assign(new Vault(), {
            Directories: [
                { ID: "live", Name: "Live", Deleted: false },
                { ID: "gone", Name: "Gone", Deleted: true },
            ],
            Credentials: [baseCredential()],
        });

        const exported = JSON.parse(vaultToJSONString(vault));
        expect(exported.Directories).toHaveLength(1);
        expect(exported.Directories[0].Name).toBe("Live");
        expect(exported.Credentials[0].Password).toBe(" secret ");
    });

    it("lists every supported import source", () => {
        expect(ImportSources).toEqual([
            "cryptex-json",
            "bitwarden-json",
            "onepassword-csv",
            "onepassword-1pux",
            "keepass-xml",
            "keepass-csv",
            "lastpass-csv",
            "chrome-csv",
            "firefox-csv",
        ]);
    });

    it("rejects oversized files and invalid mapped items before returning any data", async () => {
        const oversized = textFile("large.csv", "name,url,username,password");
        Object.defineProperty(oversized, "size", {
            value: MAX_IMPORT_FILE_BYTES + 1,
        });
        await expect(
            parseImportFile("chrome-csv", oversized),
        ).rejects.toMatchObject({ code: "IMPORT_FILE_TOO_LARGE" });

        const invalidName = "x".repeat(256);
        await expect(
            parseImportFile(
                "chrome-csv",
                textFile(
                    "invalid.csv",
                    [
                        "name,url,username,password",
                        "Valid,https://valid.example,user,secret",
                        `${invalidName},https://invalid.example,user,secret`,
                    ].join("\n"),
                    "text/csv",
                ),
            ),
        ).rejects.toMatchObject({ code: "IMPORT_ITEM_INVALID" });
    });

    describe("Cryptex JSON", () => {
        it("round-trips current records verbatim and skips deleted records", async () => {
            const result = await parseImportFile(
                "cryptex-json",
                jsonFile({
                    Directories: [
                        {
                            ID: "dir",
                            Name: "Work",
                            Version: 0,
                            Hash: "",
                            DateModifiedTimestamp: 1,
                            Deleted: false,
                        },
                        {
                            ID: "deleted-dir",
                            Name: "Deleted",
                            Version: 0,
                            Hash: "",
                            DateModifiedTimestamp: 1,
                            Deleted: true,
                        },
                    ],
                    Credentials: [
                        baseCredential({
                            DirectoryID: "dir",
                            Password: "  exact password\n",
                            AdditionalURLs: [
                                {
                                    URL: "https://accounts.example.com/path",
                                    MatchMode: CredentialURLMatchMode.Domain,
                                },
                            ],
                            CustomFields: [
                                {
                                    ID: "field",
                                    Name: "Exact",
                                    Type: CustomFieldType.Text,
                                    Value: "  value  ",
                                },
                            ],
                        }),
                        baseCredential({ Name: "Deleted", Deleted: true }),
                    ],
                }),
            );

            expect(result.credentials).toHaveLength(1);
            expect(result.credentials[0]!.Password).toBe("  exact password\n");
            expect(result.credentials[0]!.CustomFields[0]!.Value).toBe(
                "  value  ",
            );
            expect(result.credentials[0]!.AdditionalURLs[0]!.URL).toBe(
                "https://accounts.example.com/path",
            );
            expect(result.directories).toHaveLength(1);
            expect(result.skippedItems).toBe(1);
            expect(result.notices).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        code: "CRYPTEX_DELETED_RECORDS_SKIPPED",
                        count: 1,
                    }),
                    expect.objectContaining({
                        code: "CRYPTEX_DELETED_DIRECTORIES_SKIPPED",
                        count: 1,
                    }),
                ]),
            );
        });

        it("rejects malformed and legacy Cryptex exports clearly", async () => {
            await expect(
                parseImportFile(
                    "cryptex-json",
                    textFile("bad.json", "{not json"),
                ),
            ).rejects.toMatchObject({ code: "INVALID_JSON" });
            await expect(
                parseImportFile(
                    "cryptex-json",
                    jsonFile({ Groups: [], Credentials: [] }),
                ),
            ).rejects.toMatchObject({ code: "CRYPTEX_SCHEMA_MISMATCH" });
        });
    });

    describe("Bitwarden JSON", () => {
        it("maps all native fields, preserves unsupported URL modes, and skips deleted items", async () => {
            const result = await parseImportFile(
                "bitwarden-json",
                jsonFile({
                    encrypted: false,
                    folders: [{ id: "folder", name: "Personal" }],
                    items: [
                        {
                            id: "item-id",
                            folderId: "folder",
                            type: 1,
                            name: "Bitwarden login",
                            notes: "note",
                            favorite: false,
                            archived: true,
                            creationDate: "2024-01-01T00:00:00Z",
                            revisionDate: "2024-02-01T00:00:00Z",
                            passwordRevisionDate: "2024-01-15T00:00:00Z",
                            login: {
                                username: "user@example.com",
                                password: "  do not trim  ",
                                totp: "otpauth://totp/Example:user?secret=JBSWY3DPEHPK3PXP&issuer=Example&algorithm=SHA256&digits=8&period=60",
                                uris: [
                                    {
                                        match: 0,
                                        uri: "https://example.com/login",
                                    },
                                    {
                                        match: 1,
                                        uri: "https://auth.example.net",
                                    },
                                    {
                                        match: 2,
                                        uri: "https://example.org/start",
                                    },
                                    { match: 5, uri: "https://never.example" },
                                ],
                            },
                            fields: [
                                { name: "PIN", value: " 1234 ", type: 1 },
                                {
                                    name: "Linked username",
                                    value: null,
                                    type: 3,
                                    linkedId: 100,
                                },
                            ],
                            passwordHistory: [
                                {
                                    password: " old password ",
                                    lastUsedDate: "2023-01-01T00:00:00Z",
                                },
                            ],
                        },
                        {
                            id: "deleted",
                            type: 1,
                            name: "Deleted",
                            deletedDate: "2024-03-01T00:00:00Z",
                            login: {},
                        },
                    ],
                }),
            );

            const credential = result.credentials[0]!;
            expect(credential.Password).toBe("  do not trim  ");
            expect(credential.URLMatchMode).toBe(CredentialURLMatchMode.Domain);
            expect(credential.AdditionalURLs).toEqual([
                {
                    URL: "https://auth.example.net",
                    MatchMode: CredentialURLMatchMode.ExactHost,
                },
            ]);
            expect(
                customField(credential, "Bitwarden URL 3 (Starts with)")?.Value,
            ).toBe("https://example.org/start");
            expect(
                customField(credential, "Bitwarden URL 4 (Never)")?.Value,
            ).toBe("https://never.example");
            expect(customField(credential, "Linked username (linked)")).toBe(
                undefined,
            );
            expect(customField(credential, "Archived")?.Value).toBe("true");
            expect(customField(credential, "Bitwarden favorite")?.Value).toBe(
                "false",
            );
            expect(customField(credential, "PIN")?.Value).toBe(" 1234 ");
            expect(credential.TOTP).toMatchObject({
                Secret: "JBSWY3DPEHPK3PXP",
                Period: 60,
                Digits: 8,
                Algorithm: TOTPAlgorithm.SHA256,
            });
            expect(result.skippedItems).toBe(1);
            expect(result.notices).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        code: "BITWARDEN_LINKED_FIELDS_UNSUPPORTED",
                        count: 1,
                    }),
                    expect.objectContaining({
                        code: "ARCHIVED_STATUS_SAVED_AS_FIELD",
                        count: 1,
                    }),
                ]),
            );
            expect(result.directories[0]!.Name).toBe("Personal");
        });

        it("maps card, identity, and SSH fields into supported item structures", async () => {
            const result = await parseImportFile(
                "bitwarden-json",
                jsonFile({
                    items: [
                        {
                            id: "card",
                            type: 3,
                            name: "Card",
                            card: {
                                number: "4111",
                                code: "123",
                                brand: "Visa",
                            },
                        },
                        {
                            id: "identity",
                            type: 4,
                            name: "Identity",
                            identity: {
                                firstName: "Ada",
                                address1: "Main",
                                ssn: "123-45-6789",
                            },
                        },
                        {
                            id: "ssh",
                            type: 5,
                            name: "SSH",
                            sshKey: {
                                privateKey: "PRIVATE",
                                publicKey: "PUBLIC",
                            },
                        },
                    ],
                }),
            );

            expect(result.credentials.map((item) => item.Type)).toEqual([
                ItemType.Credentials,
                ItemType.Identity,
                ItemType.SSHKey,
            ]);
            expect(
                customField(result.credentials[0]!, "Card number")?.Type,
            ).toBe(CustomFieldType.MaskedText);
            expect(
                customField(result.credentials[0]!, "Card brand")?.Type,
            ).toBe(CustomFieldType.MaskedText);
            expect(
                customField(result.credentials[1]!, "Identity firstName")?.Type,
            ).toBe(CustomFieldType.MaskedText);
            expect(
                customField(result.credentials[2]!, "SSH publicKey")?.Type,
            ).toBe(CustomFieldType.MaskedText);
        });

        it("converts exported ES256 passkeys and gates genuinely unsupported data", async () => {
            const pair = (await webcrypto.subtle.generateKey(
                { name: "ECDSA", namedCurve: "P-256" },
                true,
                ["sign", "verify"],
            )) as CryptoKeyPair;
            const pkcs8 = await webcrypto.subtle.exportKey(
                "pkcs8",
                pair.privateKey,
            );
            const keyValue = Buffer.from(pkcs8).toString("base64url");
            const result = await parseImportFile(
                "bitwarden-json",
                jsonFile({
                    items: [
                        {
                            id: "passkey",
                            type: 1,
                            name: "Passkey login",
                            attachments: [{}, {}],
                            login: {
                                fido2Credentials: [
                                    {
                                        credentialId: "credential-id",
                                        keyType: "public-key",
                                        keyAlgorithm: "ECDSA",
                                        keyCurve: "P-256",
                                        keyValue,
                                        rpId: "example.com",
                                        userHandle: "user-handle",
                                        userName: "ada@example.com",
                                        userDisplayName: "Ada",
                                        counter: "7",
                                        rpName: "Example",
                                        discoverable: "true",
                                        creationDate: "2024-01-01T00:00:00Z",
                                    },
                                    {
                                        credentialId: "unsupported",
                                        keyType: "public-key",
                                        keyAlgorithm: "RSA",
                                        keyCurve: "RSA",
                                        keyValue: "raw-secret",
                                        rpId: "example.com",
                                    },
                                ],
                            },
                        },
                    ],
                }),
            );

            expect(result.credentials[0]!.Passkey).toMatchObject({
                CredentialID: "credential-id",
                RPID: "example.com",
                Algorithm: -7,
                SignCount: 7,
                Discoverable: true,
            });
            expect(
                JSON.parse(result.credentials[0]!.Passkey!.PrivateKey),
            ).toMatchObject({ kty: "EC", crv: "P-256" });
            expect(
                customField(
                    result.credentials[0]!,
                    "Bitwarden passkey creation date",
                )?.Value,
            ).toBe("2024-01-01T00:00:00Z");
            expect(
                result.notices.filter((notice) => notice.requiresConfirmation),
            ).toHaveLength(2);
            expect(result.notices).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        code: "BITWARDEN_ATTACHMENTS_UNSUPPORTED",
                        count: 2,
                        itemNames: ["Passkey login"],
                    }),
                ]),
            );
            expect(
                customField(
                    result.credentials[0]!,
                    "Bitwarden passkey 2 keyValue",
                )?.Type,
            ).toBe(CustomFieldType.MaskedText);
        });

        it("rejects encrypted and structurally invalid exports with useful errors", async () => {
            await expect(
                parseImportFile(
                    "bitwarden-json",
                    jsonFile({ encrypted: true }),
                ),
            ).rejects.toMatchObject({ code: "ENCRYPTED_EXPORT_UNSUPPORTED" });
            await expect(
                parseImportFile("bitwarden-json", jsonFile({ folders: [] })),
            ).rejects.toMatchObject({ code: "BITWARDEN_ITEMS_MISSING" });
            await expect(
                parseImportFile("bitwarden-json", jsonFile({ items: [{}] })),
            ).rejects.toMatchObject({ code: "BITWARDEN_ITEM_INVALID" });
        });

        it("keeps folder-only exports importable", async () => {
            const result = await parseImportFile(
                "bitwarden-json",
                jsonFile({
                    encrypted: false,
                    folders: [{ id: "empty-folder", name: "Empty folder" }],
                    items: [],
                }),
            );

            expect(result.credentials).toEqual([]);
            expect(result.directories).toEqual([
                expect.objectContaining({
                    ID: "empty-folder",
                    Name: "Empty folder",
                }),
            ]);
        });
    });

    describe("vendor CSV formats", () => {
        it("parses current 1Password CSV without turning tags into directories", async () => {
            const csv = [
                "Title,Website,Username,Password,One-time password,Favorite status,Archived status,Tags,Notes,Extra field",
                '"Example","https://example.com/login","ada","  exact secret  ","JBSWY3DPEHPK3PXP","true","true","work,important","line one\nline two","  custom  "',
            ].join("\n");
            const result = await parseImportFile(
                "onepassword-csv",
                textFile("onepassword.csv", csv, "text/csv"),
            );

            expect(result.directories).toEqual([]);
            expect(result.credentials[0]).toMatchObject({
                Name: "Example",
                Username: "ada",
                Password: "  exact secret  ",
                URL: "https://example.com/login",
                Notes: "line one\nline two",
            });
            expect(result.credentials[0]!.Tags).toContain("work");
            expect(customField(result.credentials[0]!, "Archived")?.Value).toBe(
                "true",
            );
            expect(
                customField(result.credentials[0]!, "Extra field")?.Value,
            ).toBe("  custom  ");
        });

        it("parses the exact KeePass 1.x CSV schema including Login Name", async () => {
            const result = await parseImportFile(
                "keepass-csv",
                textFile(
                    "keepass.csv",
                    '"Account","Login Name","Password","Web Site","Comments"\n"Mail","ada@example.com"," pass\\\"word\\\\path ","https://mail.example.com","multi\nline"',
                    "text/csv",
                ),
            );

            expect(result.credentials[0]).toMatchObject({
                Name: "Mail",
                Username: "ada@example.com",
                Password: ' pass"word\\path ',
                URL: "https://mail.example.com",
                Notes: "multi\nline",
            });
        });

        it("parses KeePassXC CSV, directories, TOTP, and unknown columns", async () => {
            const result = await parseImportFile(
                "keepass-csv",
                textFile(
                    "keepassxc.csv",
                    "Group,Title,Username,Password,URL,Notes,TOTP,Custom\nWork,Portal,ada,secret,https://portal.example,notes,JBSWY3DPEHPK3PXP,preserved",
                    "text/csv",
                ),
            );

            expect(result.directories[0]!.Name).toBe("Work");
            expect(result.credentials[0]!.TOTP?.Secret).toBe(
                "JBSWY3DPEHPK3PXP",
            );
            expect(customField(result.credentials[0]!, "Custom")?.Value).toBe(
                "preserved",
            );
        });

        it("maps LastPass TOTP and structured secure notes without using tags", async () => {
            const csv = [
                "url,username,password,extra,name,grouping,fav,totp,custom",
                '"https://example.com","user"," pass ","notes","Login","Work","1","JBSWY3DPEHPK3PXP","value"',
                '"http://sn","","","NoteType:Passport\nNumber:123456\nNotes:secure note body","Recovery","Notes","0","",""',
            ].join("\n");
            const result = await parseImportFile(
                "lastpass-csv",
                textFile("lastpass.csv", csv, "text/csv"),
            );

            expect(result.credentials[0]!.Tags).toBeUndefined();
            expect(result.credentials[0]!.Password).toBe(" pass ");
            expect(
                customField(result.credentials[0]!, "LastPass favorite")?.Value,
            ).toBe("true");
            expect(customField(result.credentials[0]!, "custom")?.Value).toBe(
                "value",
            );
            expect(result.credentials[0]!.TOTP?.Secret).toBe(
                "JBSWY3DPEHPK3PXP",
            );
            expect(result.credentials[1]).toMatchObject({
                Type: ItemType.Identity,
                URL: "",
                Notes: "secure note body",
            });
            expect(
                customField(result.credentials[1]!, "LastPass note type")
                    ?.Value,
            ).toBe("Passport");
            expect(customField(result.credentials[1]!, "Number")).toMatchObject(
                {
                    Value: "123456",
                    Type: CustomFieldType.MaskedText,
                },
            );
        });

        it("parses Chrome CSV with real quoting and preserves password whitespace", async () => {
            const result = await parseImportFile(
                "chrome-csv",
                textFile(
                    "chrome.csv",
                    'name,url,username,password,note,private key\n"Example, Inc.",https://example.com,ada,"  secret  ","line one\nline two",extra',
                    "text/csv",
                ),
            );

            expect(result.credentials[0]).toMatchObject({
                Name: "Example, Inc.",
                Password: "  secret  ",
                Notes: "line one\nline two",
            });
            expect(
                customField(result.credentials[0]!, "private key"),
            ).toMatchObject({
                Value: "extra",
                Type: CustomFieldType.Text,
            });
        });

        it("maps Firefox metadata without treating last-used as modified", async () => {
            const created = 1_700_000_000_000;
            const lastUsed = 1_720_000_000_000;
            const changed = 1_710_000_000_000;
            const result = await parseImportFile(
                "firefox-csv",
                textFile(
                    "firefox.csv",
                    [
                        "url,username,password,httpRealm,formActionOrigin,guid,timeCreated,timeLastUsed,timePasswordChanged",
                        `https://example.com/login,ada," secret ",Members,https://example.com/session,{guid},${created},${lastUsed},${changed}`,
                    ].join("\n"),
                    "text/csv",
                ),
            );

            const credential = result.credentials[0]!;
            expect(credential.Name).toBe("example.com");
            expect(credential.Password).toBe(" secret ");
            expect(credential.DateCreatedTimestamp).toBe(created);
            expect(credential.DateModifiedTimestamp).toBe(changed);
            expect(credential.DateModifiedTimestamp).not.toBe(lastUsed);
            expect(customField(credential, "Firefox HTTP realm")?.Value).toBe(
                "Members",
            );
            expect(
                customField(credential, "Firefox form action origin")?.Value,
            ).toBe("https://example.com/session");
            expect(customField(credential, "Firefox GUID")?.Value).toBe(
                "{guid}",
            );
            expect(customField(credential, "Firefox last used")?.Type).toBe(
                CustomFieldType.Text,
            );
        });

        it("rejects wrong schemas and malformed CSV instead of reporting success", async () => {
            await expect(
                parseImportFile(
                    "chrome-csv",
                    textFile("wrong.csv", "foo,bar\none,two", "text/csv"),
                ),
            ).rejects.toMatchObject({ code: "CSV_SCHEMA_MISMATCH" });
            await expect(
                parseImportFile(
                    "firefox-csv",
                    textFile(
                        "chrome.csv",
                        "name,url,username,password\nExample,https://example.com,u,p",
                        "text/csv",
                    ),
                ),
            ).rejects.toMatchObject({ code: "CSV_SCHEMA_MISMATCH" });
            await expect(
                parseImportFile(
                    "onepassword-csv",
                    textFile(
                        "broken.csv",
                        'Title,Website,Username,Password\n"unterminated',
                        "text/csv",
                    ),
                ),
            ).rejects.toMatchObject({ code: "INVALID_CSV" });
            await expect(
                parseImportFile(
                    "onepassword-csv",
                    textFile(
                        "incomplete.csv",
                        "Title,Website,Username,Password\nExample,https://example.com,user,secret",
                        "text/csv",
                    ),
                ),
            ).rejects.toMatchObject({ code: "CSV_SCHEMA_MISMATCH" });
        });
    });

    describe("KeePass XML", () => {
        it("supports KeePass 1.x XML and its group tree", async () => {
            const xml = `<?xml version="1.0" encoding="UTF-8"?>
                <pwlist>
                    <pwentry>
                        <group tree="General">Windows</group>
                        <title>Special</title>
                        <username>ada</username>
                        <url>https://example.com</url>
                        <password>  exact secret  </password>
                        <notes>multi\nline</notes>
                        <uuid>0123456789abcdef0123456789abcdef</uuid>
                        <image>34</image>
                        <creationtime>2006-12-31T11:52:01</creationtime>
                        <lastmodtime>2007-01-01T11:52:01</lastmodtime>
                        <lastaccesstime>2007-01-02T11:52:01</lastaccesstime>
                        <expiretime expires="true">2008-12-28T23:59:59</expiretime>
                    </pwentry>
                </pwlist>`;
            const result = await parseImportFile(
                "keepass-xml",
                textFile("keepass.xml", xml, "application/xml"),
            );

            expect(result.directories[0]!.Name).toBe("General/Windows");
            expect(result.credentials[0]).toMatchObject({
                Name: "Special",
                Username: "ada",
                Password: "  exact secret  ",
                URL: "https://example.com",
                Notes: "multi\nline",
            });
            expect(
                customField(result.credentials[0]!, "KeePass entry UUID")
                    ?.Value,
            ).toBe("0123456789abcdef0123456789abcdef");
            expect(
                customField(result.credentials[0]!, "KeePass expires")?.Value,
            ).toBe("true");
        });

        it("supports KeePass 2.x tags, TOTP settings, history, nested groups, and recycle-bin skipping", async () => {
            const xml = `<?xml version="1.0" encoding="UTF-8"?>
                <KeePassFile>
                    <Meta><RecycleBinUUID>recycle</RecycleBinUUID></Meta>
                    <Root>
                        <Group>
                            <UUID>root</UUID><Name>Root</Name>
                            <Group>
                                <UUID>work</UUID><Name>Work</Name>
                                <Entry>
                                    <UUID>entry-id</UUID>
                                    <String><Key>Title</Key><Value>Portal</Value></String>
                                    <String><Key>UserName</Key><Value>ada</Value></String>
                                    <String><Key>Password</Key><Value> password </Value></String>
                                    <String><Key>URL</Key><Value>https://portal.example</Value></String>
                                    <String><Key>Notes</Key><Value>notes</Value></String>
                                    <String><Key>Department</Key><Value>R&amp;D</Value></String>
                                    <String><Key>API Token</Key><Value Protected="True"> token </Value></String>
                                    <String><Key>TimeOtp-Secret-Base32</Key><Value>JBSWY3DPEHPK3PXP</Value></String>
                                    <String><Key>TimeOtp-Period</Key><Value>60</Value></String>
                                    <String><Key>TimeOtp-Length</Key><Value>8</Value></String>
                                    <String><Key>TimeOtp-Algorithm</Key><Value>SHA-512</Value></String>
                                    <Tags>work;important</Tags>
                                    <Times>
                                        <CreationTime>2024-01-01T00:00:00Z</CreationTime>
                                        <LastModificationTime>2024-02-01T00:00:00Z</LastModificationTime>
                                        <LastAccessTime>2024-03-01T00:00:00Z</LastAccessTime>
                                        <Expires>False</Expires>
                                    </Times>
                                    <Binary><Key>receipt.txt</Key><Value Ref="0" /></Binary>
                                    <History>
                                        <Entry>
                                            <String><Key>Password</Key><Value>old secret</Value></String>
                                            <Times><LastModificationTime>2023-01-01T00:00:00Z</LastModificationTime></Times>
                                        </Entry>
                                    </History>
                                </Entry>
                            </Group>
                            <Group>
                                <UUID>recycle</UUID><Name>Recycle Bin</Name>
                                <Entry><String><Key>Title</Key><Value>Deleted</Value></String></Entry>
                            </Group>
                        </Group>
                        <DeletedObjects>
                            <DeletedObject><UUID>gone</UUID></DeletedObject>
                        </DeletedObjects>
                    </Root>
                </KeePassFile>`;
            const result = await parseImportFile(
                "keepass-xml",
                textFile("keepass.xml", xml, "application/xml"),
            );

            expect(result.credentials).toHaveLength(1);
            expect(result.credentials[0]!.Password).toBe(" password ");
            expect(result.credentials[0]!.Tags).toContain("work");
            expect(result.credentials[0]!.TOTP).toMatchObject({
                Secret: "JBSWY3DPEHPK3PXP",
                Period: 60,
                Digits: 8,
                Algorithm: TOTPAlgorithm.SHA512,
            });
            expect(
                customField(result.credentials[0]!, "Department")?.Value,
            ).toBe("R&D");
            expect(customField(result.credentials[0]!, "API Token")?.Type).toBe(
                CustomFieldType.MaskedText,
            );
            expect(
                customField(result.credentials[0]!, "History 1 Password")?.Type,
            ).toBe(CustomFieldType.MaskedText);
            expect(result.skippedItems).toBe(1);
            expect(result.notices).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        code: "KEEPASS_ATTACHMENTS_UNSUPPORTED",
                        requiresConfirmation: true,
                    }),
                    expect.objectContaining({
                        code: "KEEPASS_DELETED_ITEMS_SKIPPED",
                    }),
                ]),
            );
        });

        it("preserves HOTP but requires explicit confirmation", async () => {
            const xml = `<KeePassFile><Root><Group><Name>Root</Name><Entry>
                <String><Key>Title</Key><Value>HOTP</Value></String>
                <String><Key>otp</Key><Value>otpauth://hotp/Test?secret=JBSWY3DPEHPK3PXP&amp;counter=1</Value></String>
            </Entry></Group></Root></KeePassFile>`;
            const result = await parseImportFile(
                "keepass-xml",
                textFile("hotp.xml", xml, "application/xml"),
            );

            expect(result.credentials[0]!.TOTP).toBeUndefined();
            expect(
                customField(
                    result.credentials[0]!,
                    "KeePass HOTP configuration",
                )?.Value,
            ).toContain("otpauth://hotp/");
            expect(result.notices).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        code: "TOTP_CONFIGURATION_UNSUPPORTED",
                        requiresConfirmation: true,
                    }),
                ]),
            );
        });

        it("uses KeePass TOTP defaults and preserves invalid explicit settings", async () => {
            const xml = `<KeePassFile><Root><Group><Name>Root</Name>
                <Entry>
                    <String><Key>Title</Key><Value>Defaults</Value></String>
                    <String><Key>TimeOtp-Secret-Base32</Key><Value>JBSWY3DPEHPK3PXP</Value></String>
                </Entry>
                <Entry>
                    <String><Key>Title</Key><Value>Invalid</Value></String>
                    <String><Key>TimeOtp-Secret-Base32</Key><Value>JBSWY3DPEHPK3PXP</Value></String>
                    <String><Key>TimeOtp-Algorithm</Key><Value>MD5</Value></String>
                </Entry>
            </Group></Root></KeePassFile>`;
            const result = await parseImportFile(
                "keepass-xml",
                textFile("totp.xml", xml, "application/xml"),
            );

            expect(result.credentials[0]!.TOTP).toMatchObject({
                Secret: "JBSWY3DPEHPK3PXP",
                Period: 30,
                Digits: 6,
                Algorithm: TOTPAlgorithm.SHA1,
            });
            expect(result.credentials[1]!.TOTP).toBeUndefined();
            expect(
                customField(
                    result.credentials[1]!,
                    "KeePass authenticator configuration",
                ),
            ).toMatchObject({ Type: CustomFieldType.MaskedText });
            expect(result.notices).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        code: "TOTP_CONFIGURATION_UNSUPPORTED",
                        count: 1,
                    }),
                ]),
            );
        });

        it("rejects malformed and unrelated XML", async () => {
            await expect(
                parseImportFile(
                    "keepass-xml",
                    textFile("bad.xml", "<KeePassFile>"),
                ),
            ).rejects.toMatchObject({ code: "INVALID_XML" });
            await expect(
                parseImportFile(
                    "keepass-xml",
                    textFile("other.xml", "<database><entry /></database>"),
                ),
            ).rejects.toMatchObject({ code: "KEEPASS_XML_SCHEMA_MISMATCH" });
            await expect(
                parseImportFile(
                    "keepass-xml",
                    textFile(
                        "invalid-v1.xml",
                        "<pwlist><pwentry><title>Incomplete</title></pwentry></pwlist>",
                    ),
                ),
            ).rejects.toMatchObject({ code: "KEEPASS_ENTRY_INVALID" });
        });

        it("preserves empty KeePass groups in folder-only exports", async () => {
            const result = await parseImportFile(
                "keepass-xml",
                textFile(
                    "folders.xml",
                    "<KeePassFile><Root><Group><UUID>root</UUID><Name>Root</Name><Group><UUID>empty</UUID><Name>Empty</Name></Group></Group></Root></KeePassFile>",
                ),
            );

            expect(result.credentials).toEqual([]);
            expect(
                result.directories.map((directory) => directory.Name),
            ).toEqual(["Root", "Root/Empty"]);
            expect(result.notices).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        code: "FOLDER_STRUCTURE_ADJUSTED",
                        count: 1,
                    }),
                ]),
            );
        });
    });

    describe("1Password 1PUX", () => {
        it("reads the official overview and section locations without losing item metadata", async () => {
            const result = await parseImportFile(
                "onepassword-1pux",
                await make1Pux({
                    accounts: [
                        {
                            attrs: { uuid: "account-id", name: "Account" },
                            vaults: [
                                {
                                    attrs: {
                                        uuid: "vault-id",
                                        name: "Personal",
                                    },
                                    items: [
                                        {
                                            uuid: "item-id",
                                            favIndex: 1,
                                            state: "archived",
                                            categoryUuid: "001",
                                            createdAt: 1_700_000_000,
                                            updatedAt: 1_710_000_000,
                                            overview: {
                                                title: "1Password Login",
                                                subtitle: "account subtitle",
                                                url: "https://example.com/login",
                                                urls: [
                                                    {
                                                        label: "Admin",
                                                        url: "https://admin.example.com",
                                                    },
                                                ],
                                                tags: [
                                                    "work,team",
                                                    "important",
                                                ],
                                            },
                                            details: {
                                                notesPlain: "markdown **note**",
                                                loginFields: [
                                                    {
                                                        designation: "username",
                                                        name: "email",
                                                        value: "ada@example.com",
                                                    },
                                                    {
                                                        designation: "password",
                                                        name: "password",
                                                        value: "  exact password  ",
                                                    },
                                                    {
                                                        name: "tenant",
                                                        value: "acme",
                                                    },
                                                ],
                                                sections: [
                                                    {
                                                        title: "Security",
                                                        fields: [
                                                            {
                                                                title: "PIN",
                                                                id: "pin",
                                                                value: {
                                                                    concealed:
                                                                        " 1234 ",
                                                                },
                                                            },
                                                            {
                                                                title: "One-Time Password",
                                                                id: "totp",
                                                                value: {
                                                                    totp: "JBSWY3DPEHPK3PXP",
                                                                },
                                                            },
                                                            {
                                                                title: "Backup authenticator",
                                                                id: "backup-otp",
                                                                type: "One Time Password",
                                                                value: {
                                                                    totp: "KRUGS4ZANFZSAYJA",
                                                                },
                                                            },
                                                            {
                                                                title: "Support portal",
                                                                id: "support-url",
                                                                value: {
                                                                    url: "https://support.example.com",
                                                                },
                                                            },
                                                        ],
                                                    },
                                                ],
                                                passwordHistory: [
                                                    {
                                                        value: " old password ",
                                                        time: 1_690_000_000,
                                                    },
                                                ],
                                            },
                                        },
                                        {
                                            uuid: "deleted",
                                            state: "deleted",
                                            categoryUuid: "001",
                                            overview: { title: "Deleted" },
                                            details: {},
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                }),
            );

            const credential = result.credentials[0]!;
            expect(credential).toMatchObject({
                Name: "1Password Login",
                Username: "ada@example.com",
                Password: "  exact password  ",
                Notes: "markdown **note**",
                URL: "https://example.com/login",
            });
            expect(credential.AdditionalURLs[0]!.URL).toBe(
                "https://admin.example.com",
            );
            expect(credential.AdditionalURLs[1]!.URL).toBe(
                "https://support.example.com",
            );
            expect(
                customField(credential, "1Password URL 2 label")?.Value,
            ).toBe("Admin");
            expect(customField(credential, "Security: PIN")).toMatchObject({
                Value: " 1234 ",
                Type: CustomFieldType.MaskedText,
            });
            expect(customField(credential, "Archived")?.Value).toBe("true");
            expect(customField(credential, "1Password favorite")?.Value).toBe(
                "true",
            );
            expect(customField(credential, "tenant")?.Value).toBe("acme");
            expect(credential.Tags).toBe("work,team,|.|,important");
            expect(
                customField(credential, "Password history 1 date")?.Type,
            ).toBe(CustomFieldType.Text);
            expect(credential.TOTP?.Secret).toBe("JBSWY3DPEHPK3PXP");
            expect(
                customField(credential, "Security: Backup authenticator"),
            ).toMatchObject({
                Value: "KRUGS4ZANFZSAYJA",
                Type: CustomFieldType.MaskedText,
            });
            expect(
                result.notices.some(
                    (notice) => notice.code === "ADDITIONAL_TOTP",
                ),
            ).toBe(false);
            expect(result.skippedItems).toBe(1);
            expect(result.directories[0]!.Name).toBe("Personal");
        });

        it("maps secure notes, identities, and SSH keys to native item types", async () => {
            const items = [
                {
                    uuid: "note",
                    categoryUuid: "003",
                    overview: { title: "Note" },
                    details: {},
                },
                {
                    uuid: "identity",
                    categoryUuid: "004",
                    overview: { title: "Identity" },
                    details: {},
                },
                {
                    uuid: "passport",
                    categoryUuid: "106",
                    overview: { title: "Passport" },
                    details: {
                        sections: [
                            {
                                fields: [
                                    {
                                        title: "Number",
                                        value: { string: "P123456" },
                                    },
                                ],
                            },
                        ],
                    },
                },
                {
                    uuid: "ssh",
                    categoryUuid: "114",
                    overview: { title: "SSH" },
                    details: {
                        sections: [
                            {
                                fields: [
                                    {
                                        title: "Key",
                                        value: {
                                            sshKey: {
                                                privateKey: "PRIVATE",
                                                metadata: {
                                                    publicKey: "PUBLIC",
                                                },
                                            },
                                        },
                                    },
                                ],
                            },
                        ],
                    },
                },
            ];
            const result = await parseImportFile(
                "onepassword-1pux",
                await make1Pux({
                    accounts: [
                        {
                            attrs: { uuid: "account-id", name: "Account" },
                            vaults: [
                                {
                                    attrs: {
                                        uuid: "vault-id",
                                        name: "Vault",
                                    },
                                    items,
                                },
                            ],
                        },
                    ],
                }),
            );
            expect(result.credentials.map((item) => item.Type)).toEqual([
                ItemType.Note,
                ItemType.Identity,
                ItemType.Identity,
                ItemType.SSHKey,
            ]);
            expect(customField(result.credentials[2]!, "Number")).toMatchObject(
                {
                    Value: "P123456",
                    Type: CustomFieldType.MaskedText,
                },
            );
            expect(customField(result.credentials[3]!, "Key")).toMatchObject({
                Type: CustomFieldType.MaskedText,
            });
        });

        it("maps 1Password Password items to the native password field", async () => {
            const result = await parseImportFile(
                "onepassword-1pux",
                await make1Pux({
                    accounts: [
                        {
                            attrs: { uuid: "account-id", name: "Account" },
                            vaults: [
                                {
                                    attrs: {
                                        uuid: "vault-id",
                                        name: "Vault",
                                    },
                                    items: [
                                        {
                                            uuid: "password-item",
                                            categoryUuid: "005",
                                            overview: { title: "Wi-Fi key" },
                                            details: {
                                                password: " exact password ",
                                                loginFields: [
                                                    {
                                                        name: "backup",
                                                        fieldType: "P",
                                                        value: " backup secret ",
                                                    },
                                                ],
                                            },
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                }),
            );

            expect(result.credentials[0]!.Password).toBe(" exact password ");
            expect(customField(result.credentials[0]!, "backup")).toMatchObject(
                {
                    Value: " backup secret ",
                    Type: CustomFieldType.MaskedText,
                },
            );
        });

        it("counts documents as skipped items and rejects invalid archives", async () => {
            const result = await parseImportFile(
                "onepassword-1pux",
                await make1Pux(
                    {
                        accounts: [
                            {
                                attrs: {
                                    uuid: "account-id",
                                    name: "Account",
                                },
                                vaults: [
                                    {
                                        attrs: {
                                            uuid: "vault-id",
                                            name: "Vault",
                                        },
                                        items: [
                                            {
                                                uuid: "document-item",
                                                categoryUuid: "006",
                                                file: {
                                                    attrs: {},
                                                    path: "files/document",
                                                },
                                                overview: { title: "Document" },
                                                details: {
                                                    documentAttributes: {
                                                        fileName: "receipt.txt",
                                                        decryptedSize: 8,
                                                    },
                                                },
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                    true,
                ),
            );
            expect(result.credentials).toHaveLength(0);
            expect(result.skippedItems).toBe(1);
            expect(result.notices).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        code: "ONEPASSWORD_DOCUMENTS_SKIPPED",
                        count: 1,
                    }),
                ]),
            );

            await expect(
                parseImportFile(
                    "onepassword-1pux",
                    textFile("bad.1pux", "not a zip"),
                ),
            ).rejects.toMatchObject({ code: "INVALID_1PUX" });
            await expect(
                parseImportFile(
                    "onepassword-1pux",
                    await make1Pux({ nope: [] }),
                ),
            ).rejects.toMatchObject({ code: "ONEPASSWORD_ACCOUNTS_MISSING" });
            await expect(
                parseImportFile(
                    "onepassword-1pux",
                    await make1Pux({
                        accounts: [
                            {
                                attrs: {
                                    uuid: "account-id",
                                    name: "Account",
                                },
                                vaults: [
                                    {
                                        attrs: {
                                            uuid: "vault-id",
                                            name: "Vault",
                                        },
                                        items: [{}],
                                    },
                                ],
                            },
                        ],
                    }),
                ),
            ).rejects.toMatchObject({ code: "ONEPASSWORD_ITEM_INVALID" });
        });

        it("keeps empty 1Password vaults as folders", async () => {
            const result = await parseImportFile(
                "onepassword-1pux",
                await make1Pux({
                    accounts: [
                        {
                            attrs: { uuid: "account-id", name: "Account" },
                            vaults: [
                                {
                                    attrs: {
                                        uuid: "empty-vault",
                                        name: "Empty vault",
                                    },
                                    items: [],
                                },
                            ],
                        },
                    ],
                }),
            );

            expect(result.credentials).toEqual([]);
            expect(result.directories).toEqual([
                expect.objectContaining({
                    ID: "empty-vault",
                    Name: "Empty vault",
                }),
            ]);
        });
    });

    describe("applying imports", () => {
        it("maps imported directories, creates fresh IDs, and intentionally keeps duplicates", async () => {
            const vault = new Vault();
            vault.Directories = [];
            vault.Credentials = [];
            const importedDirectory = Object.assign(new Directory("Imported"), {
                ID: "source-directory",
            });
            const sourceCredential = baseCredential({
                ID: "foreign-id",
                DirectoryID: "source-directory",
                Name: "Duplicate me",
                Password: " exact ",
            });

            const first = await applyImportToVault(vault, {
                directories: [importedDirectory],
                credentials: [sourceCredential],
            });
            const second = await applyImportToVault(first.vault, {
                directories: [importedDirectory],
                credentials: [sourceCredential],
            });

            expect(first.importedDirectories).toBe(1);
            expect(second.importedDirectories).toBe(1);
            expect(second.vault.Directories).toHaveLength(2);
            expect(second.vault.Directories.map((entry) => entry.Name)).toEqual(
                ["Imported", "Imported (2)"],
            );
            expect(second.vault.Credentials).toHaveLength(2);
            expect(second.vault.Credentials[0]!.ID).not.toBe("foreign-id");
            expect(second.vault.Credentials[1]!.ID).not.toBe(
                second.vault.Credentials[0]!.ID,
            );
            expect(
                second.vault.Credentials.map((entry) => entry.Password),
            ).toEqual([" exact ", " exact "]);
            expect(second.vault.Credentials[0]!.DirectoryID).not.toBe(
                second.vault.Credentials[1]!.DirectoryID,
            );
        });
    });

    it("only exposes safe parser messages to the UI", () => {
        expect(
            getImportErrorMessage(
                new ImportFileError("SAFE", "Choose an unencrypted export."),
            ),
        ).toBe("Choose an unencrypted export.");
        expect(
            getImportErrorMessage(new Error("sensitive parser detail")),
        ).toBe(
            "Could not parse this export file. Check that the selected source and file match.",
        );
    });
});
