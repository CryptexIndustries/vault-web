import { expect, type Page, test } from "@playwright/test";
import JSZip from "jszip";

const vaultSecret = "import-e2e-correct-horse-battery-staple-42!";

type ImportFixture = {
    source: string;
    itemName: string;
    fileName: string;
    mimeType: string;
    contents: string | Buffer;
    expected: {
        username: string;
        password: string;
        website: string;
        notes?: string;
        folder?: string;
        totp?: boolean;
        customFields?: Array<{ name: string; value: string }>;
    };
};

const cryptexCredential = (name: string) => ({
    ID: "source-id",
    Version: 0,
    Type: 1,
    DirectoryID: "",
    Name: name,
    Username: "ada@example.com",
    Password: " secret ",
    URL: "https://example.com/login",
    URLMatchMode: 0,
    AdditionalURLs: [],
    Notes: "Imported in Playwright",
    CustomFields: [],
    DateCreated: "",
    DateCreatedTimestamp: 1_700_000_000_000,
    DateModifiedTimestamp: 1_700_000_000_000,
    DatePasswordChangedTimestamp: 1_700_000_000_000,
    Deleted: false,
    Hash: "",
});

const make1Pux = async (itemName: string): Promise<Buffer> => {
    const zip = new JSZip();
    zip.file(
        "export.attributes",
        JSON.stringify({
            version: 3,
            description: "1Password Unencrypted Export",
            createdAt: 1_700_000_000,
        }),
    );
    zip.file(
        "export.data",
        JSON.stringify({
            accounts: [
                {
                    attrs: { uuid: "account-id", name: "Account" },
                    vaults: [
                        {
                            attrs: { uuid: "vault-id", name: "Personal" },
                            items: [
                                {
                                    uuid: "item-id",
                                    state: "active",
                                    categoryUuid: "001",
                                    overview: {
                                        title: itemName,
                                        url: "https://1password.example/login",
                                        tags: ["e2e"],
                                    },
                                    details: {
                                        notesPlain: "Imported 1PUX note",
                                        loginFields: [
                                            {
                                                designation: "username",
                                                value: "ada@example.com",
                                            },
                                            {
                                                designation: "password",
                                                value: " secret ",
                                            },
                                        ],
                                        sections: [],
                                    },
                                },
                            ],
                        },
                    ],
                },
            ],
        }),
    );
    return zip.generateAsync({ type: "nodebuffer" });
};

const importFixtures = async (): Promise<ImportFixture[]> => [
    {
        source: "Cryptex Vault JSON",
        itemName: "Cryptex imported account",
        fileName: "cryptex.json",
        mimeType: "application/json",
        contents: JSON.stringify({
            Directories: [],
            Credentials: [cryptexCredential("Cryptex imported account")],
        }),
        expected: {
            username: "ada@example.com",
            password: " secret ",
            website: "https://example.com/login",
            notes: "Imported in Playwright",
        },
    },
    {
        source: "Bitwarden JSON",
        itemName: "Bitwarden imported account",
        fileName: "bitwarden.json",
        mimeType: "application/json",
        contents: JSON.stringify({
            encrypted: false,
            folders: [],
            items: [
                {
                    id: "item-id",
                    type: 1,
                    name: "Bitwarden imported account",
                    notes: "Imported Bitwarden note",
                    archived: true,
                    login: {
                        username: "ada@example.com",
                        password: " secret ",
                        uris: [{ match: 0, uri: "https://bitwarden.example" }],
                        totp: "JBSWY3DPEHPK3PXP",
                    },
                },
            ],
        }),
        expected: {
            username: "ada@example.com",
            password: " secret ",
            website: "https://bitwarden.example",
            notes: "Imported Bitwarden note",
            totp: true,
            customFields: [{ name: "Archived", value: "Yes" }],
        },
    },
    {
        source: "1Password CSV",
        itemName: "1Password CSV imported account",
        fileName: "onepassword.csv",
        mimeType: "text/csv",
        contents:
            "Title,Website,Username,Password,One-time password,Favorite status,Archived status,Tags,Notes\n1Password CSV imported account,https://onepassword.example,ada@example.com, secret ,JBSWY3DPEHPK3PXP,false,true,e2e,Imported 1Password CSV note",
        expected: {
            username: "ada@example.com",
            password: " secret ",
            website: "https://onepassword.example",
            notes: "Imported 1Password CSV note",
            totp: true,
            customFields: [{ name: "Archived", value: "Yes" }],
        },
    },
    {
        source: "1Password 1PUX",
        itemName: "1PUX imported account",
        fileName: "onepassword.1pux",
        mimeType: "application/zip",
        contents: await make1Pux("1PUX imported account"),
        expected: {
            username: "ada@example.com",
            password: " secret ",
            website: "https://1password.example/login",
            notes: "Imported 1PUX note",
            folder: "Personal",
        },
    },
    {
        source: "KeePass XML",
        itemName: "KeePass XML imported account",
        fileName: "keepass.xml",
        mimeType: "application/xml",
        contents: `<?xml version="1.0" encoding="UTF-8"?>
            <pwlist><pwentry><group>General</group>
            <title>KeePass XML imported account</title><username>ada</username>
            <url>https://keepass.example</url><password> secret </password>
            <notes>note</notes><uuid>0123456789abcdef0123456789abcdef</uuid>
            <creationtime>2024-01-01T00:00:00</creationtime>
            <lastmodtime>2024-01-02T00:00:00</lastmodtime>
            </pwentry></pwlist>`,
        expected: {
            username: "ada",
            password: " secret ",
            website: "https://keepass.example",
            notes: "note",
            folder: "General",
        },
    },
    {
        source: "KeePass CSV",
        itemName: "KeePass CSV imported account",
        fileName: "keepass.csv",
        mimeType: "text/csv",
        contents:
            '"Account","Login Name","Password","Web Site","Comments"\n"KeePass CSV imported account","ada"," secret ","https://keepass-csv.example","note"',
        expected: {
            username: "ada",
            password: " secret ",
            website: "https://keepass-csv.example",
            notes: "note",
        },
    },
    {
        source: "LastPass CSV",
        itemName: "LastPass imported account",
        fileName: "lastpass.csv",
        mimeType: "text/csv",
        contents:
            "url,username,password,extra,name,grouping,fav,totp\nhttps://lastpass.example,ada, secret ,Imported LastPass note,LastPass imported account,,0,JBSWY3DPEHPK3PXP",
        expected: {
            username: "ada",
            password: " secret ",
            website: "https://lastpass.example",
            notes: "Imported LastPass note",
            totp: true,
        },
    },
    {
        source: "Chrome CSV",
        itemName: "Chrome imported account",
        fileName: "chrome.csv",
        mimeType: "text/csv",
        contents:
            "name,url,username,password,note\nChrome imported account,https://chrome.example,ada, secret ,note",
        expected: {
            username: "ada",
            password: " secret ",
            website: "https://chrome.example",
            notes: "note",
        },
    },
    {
        source: "Firefox CSV",
        itemName: "firefox.example",
        fileName: "firefox.csv",
        mimeType: "text/csv",
        contents:
            "url,username,password,httpRealm,formActionOrigin,guid,timeCreated,timeLastUsed,timePasswordChanged\nhttps://firefox.example/login,ada, secret ,Members,https://firefox.example/session,{guid},1700000000000,1720000000000,1710000000000",
        expected: {
            username: "ada",
            password: " secret ",
            website: "https://firefox.example/login",
            customFields: [
                { name: "Firefox HTTP realm", value: "Members" },
                { name: "Firefox GUID", value: "{guid}" },
            ],
        },
    },
];

const finishVaultCreation = async (page: Page, name: string) => {
    await page.getByPlaceholder("Enter your new vault name").fill(name);
    await page.getByPlaceholder("Enter your secret key").fill(vaultSecret);
    await page.getByRole("button", { name: "Create Vault" }).click();

    const recoveryDialog = page.getByRole("dialog", {
        name: "Save these secrets now",
    });
    await expect(recoveryDialog).toBeVisible();
    await recoveryDialog
        .getByLabel("I have written down the recovery code")
        .check();
    await recoveryDialog.getByRole("button", { name: "Continue" }).click();

    const migrationDialog = page.getByRole("dialog", {
        name: "Action required",
    });
    const addNewButton = page.getByRole("button", { name: "Add New" });
    await expect(migrationDialog.or(addNewButton)).toBeVisible();
    if (await migrationDialog.isVisible()) {
        await migrationDialog.getByLabel("I understand these steps").check();
        await migrationDialog.getByRole("button", { name: "Continue" }).click();
    }
    await expect(addNewButton).toBeVisible();
};

const selectImportFile = async (page: Page, fixture: ImportFixture) => {
    const dialog = page.getByRole("dialog", { name: "Import Passwords" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("combobox").click();
    await page
        .getByRole("option", { name: fixture.source, exact: true })
        .click();
    await dialog.locator('input[type="file"]').setInputFiles({
        name: fixture.fileName,
        mimeType: fixture.mimeType,
        buffer:
            typeof fixture.contents === "string"
                ? Buffer.from(fixture.contents)
                : fixture.contents,
    });
    const itemsToAdd = dialog.getByText("items will be added", {
        exact: true,
    });
    await expect(itemsToAdd).toBeVisible();
    await expect(
        itemsToAdd.locator("..").getByText("1", { exact: true }),
    ).toBeVisible();
    await expect(
        dialog.getByText(
            "Importing does not check for duplicates. Importing the same file again will add the items again.",
            { exact: false },
        ),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Import", exact: true }).click();
};

const fieldValue = (page: Page, label: string) =>
    page
        .getByText(label, { exact: true })
        .locator("..")
        .locator("..")
        .locator("span.font-mono");

const expectFieldValue = async (page: Page, label: string, value: string) => {
    const locator = fieldValue(page, label);
    await expect(locator).toBeVisible();
    expect(await locator.textContent()).toBe(value);
};

const verifyImportedItem = async (page: Page, fixture: ImportFixture) => {
    if (fixture.expected.folder) {
        const directoryPicker = page.getByRole("button", {
            name: "Browse directories",
        });
        await directoryPicker.click();
        await page
            .getByRole("menuitem", {
                name: new RegExp(`^${fixture.expected.folder}`),
            })
            .click();
        await expect(directoryPicker).toContainText(fixture.expected.folder);
    }
    await page.getByText(fixture.itemName, { exact: true }).first().click();
    await expectFieldValue(page, "Username", fixture.expected.username);
    await page
        .getByRole("button", { name: "Show password", exact: true })
        .click();
    await expectFieldValue(page, "Password", fixture.expected.password);
    await expectFieldValue(page, "Website", fixture.expected.website);
    if (fixture.expected.notes) {
        await expect(
            page.getByText(fixture.expected.notes, { exact: true }),
        ).toBeVisible();
    }
    if (fixture.expected.totp) {
        await expect(
            page.getByText("Two-Factor Code", { exact: true }),
        ).toBeVisible();
    }
    for (const field of fixture.expected.customFields ?? []) {
        await expectFieldValue(page, field.name, field.value);
    }
};

const lockReloadAndUnlock = async (page: Page) => {
    await page.getByRole("button", { name: "Lock Vault", exact: true }).click();
    const lockDialog = page.getByRole("dialog", { name: "Warning" });
    await lockDialog
        .getByRole("button", { name: /Lock Vault \(\d+s\)/u })
        .click();
    await expect(
        page.getByRole("button", { name: "Unlock Vault" }),
    ).toBeVisible();
    await page.reload();
    await page.getByPlaceholder("Enter your secret key").fill(vaultSecret);
    await page.getByRole("button", { name: "Unlock Vault" }).click();
};

test.describe("imports during vault creation", () => {
    let fixtures: ImportFixture[];

    test.beforeAll(async () => {
        fixtures = await importFixtures();
    });

    for (const source of [
        "Cryptex Vault JSON",
        "Bitwarden JSON",
        "1Password CSV",
        "1Password 1PUX",
        "KeePass XML",
        "KeePass CSV",
        "LastPass CSV",
        "Chrome CSV",
        "Firefox CSV",
    ]) {
        test(`imports ${source} before the vault exists`, async ({ page }) => {
            const fixture = fixtures.find((entry) => entry.source === source)!;
            await page.goto("/app");
            await page
                .getByRole("button", { name: "Import", exact: true })
                .click();
            await selectImportFile(page, fixture);
            await expect(
                page.getByText("1 items,", { exact: false }),
            ).toBeVisible();

            await finishVaultCreation(page, `Import ${source}`);
            await expect(
                page.getByText(fixture.itemName, { exact: true }),
            ).toBeVisible();
            await verifyImportedItem(page, fixture);
            await lockReloadAndUnlock(page);
            await expect(
                page.getByText(fixture.itemName, { exact: true }),
            ).toBeVisible();
            await verifyImportedItem(page, fixture);
        });
    }
});

test("imports into an existing vault through the shared wizard", async ({
    page,
}) => {
    const fixture = (await importFixtures()).find(
        (entry) => entry.source === "Chrome CSV",
    )!;
    await page.goto("/app");
    await finishVaultCreation(page, "Existing Vault Import");

    await page.getByRole("button", { name: "Vault Settings" }).click();
    const settings = page.getByRole("dialog", { name: "Vault Settings" });
    await settings.getByRole("button", { name: "Import Passwords" }).click();
    await selectImportFile(page, fixture);
    await settings
        .getByRole("button", { name: "Close", exact: true })
        .first()
        .click();
    await expect(
        page.getByText(fixture.itemName, { exact: true }),
    ).toBeVisible();
    await verifyImportedItem(page, fixture);
});

test("imports a folder-only export before the vault exists", async ({
    page,
}) => {
    await page.goto("/app");
    await page.getByRole("button", { name: "Import", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Import Passwords" });
    await dialog.getByRole("combobox").click();
    await page
        .getByRole("option", { name: "Bitwarden JSON", exact: true })
        .click();
    await dialog.locator('input[type="file"]').setInputFiles({
        name: "folders.json",
        mimeType: "application/json",
        buffer: Buffer.from(
            JSON.stringify({
                encrypted: false,
                folders: [{ id: "empty-folder", name: "Empty folder" }],
                items: [],
            }),
        ),
    });

    const foldersToCreate = dialog.getByText("folders will be created", {
        exact: true,
    });
    await expect(
        foldersToCreate.locator("..").getByText("1", { exact: true }),
    ).toBeVisible();
    await expect(
        dialog.getByRole("button", { name: "Import", exact: true }),
    ).toBeEnabled();
    await dialog.getByRole("button", { name: "Import", exact: true }).click();

    await finishVaultCreation(page, "Folder-only Import");
    const directoryPicker = page.getByRole("button", {
        name: "Browse directories",
    });
    await directoryPicker.click();
    await expect(
        page.getByRole("menuitem", { name: /^Empty folder/u }),
    ).toBeVisible();
    await page.keyboard.press("Escape");

    await lockReloadAndUnlock(page);
    await directoryPicker.click();
    await expect(
        page.getByRole("menuitem", { name: /^Empty folder/u }),
    ).toBeVisible();
});

test("shows actionable errors and requires acknowledgment for unsupported data", async ({
    page,
}) => {
    await page.setViewportSize({ width: 900, height: 500 });
    await page.goto("/app");
    await page.getByRole("button", { name: "Import", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Import Passwords" });
    await dialog.getByRole("combobox").click();
    await page
        .getByRole("option", { name: "Bitwarden JSON", exact: true })
        .click();

    const fileInput = dialog.locator('input[type="file"]');
    await fileInput.setInputFiles({
        name: "encrypted.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify({ encrypted: true })),
    });
    await expect(
        dialog.getByText(
            "Encrypted Bitwarden exports are not supported. Export an unencrypted JSON file from Bitwarden and try again.",
        ),
    ).toBeVisible();

    await fileInput.setInputFiles({
        name: "attachments.json",
        mimeType: "application/json",
        buffer: Buffer.from(
            JSON.stringify({
                encrypted: false,
                items: [
                    {
                        id: "item",
                        type: 1,
                        name: "Item with attachment",
                        attachments: [{}, {}],
                        login: {},
                    },
                    {
                        id: "deleted",
                        type: 1,
                        name: "Deleted item",
                        deletedDate: "2025-01-01T00:00:00Z",
                        login: {},
                    },
                ],
            }),
        ),
    });
    const importButton = dialog.getByRole("button", {
        name: "Import",
        exact: true,
    });
    await expect(importButton).toBeDisabled();
    const itemsFound = dialog.getByText("items found", { exact: true });
    await expect(
        itemsFound.locator("..").getByText("2", { exact: true }),
    ).toBeVisible();
    const itemsNotAdded = dialog.getByText("items will not be added", {
        exact: true,
    });
    await expect(
        itemsNotAdded.locator("..").getByText("1", { exact: true }),
    ).toBeVisible();
    const attachments = dialog.getByText(
        "Attached files can't be carried over",
        {
            exact: true,
        },
    );
    await expect(
        attachments.locator("..").locator("..").getByText("2", {
            exact: true,
        }),
    ).toBeVisible();
    await expect(
        dialog.getByText("Items in the source trash will not be added", {
            exact: true,
        }),
    ).toBeVisible();

    const viewport = page.viewportSize()!;
    const dialogBounds = await dialog.boundingBox();
    const importButtonBounds = await importButton.boundingBox();
    expect(dialogBounds).not.toBeNull();
    expect(importButtonBounds).not.toBeNull();
    expect(dialogBounds!.y).toBeGreaterThanOrEqual(0);
    expect(dialogBounds!.y + dialogBounds!.height).toBeLessThanOrEqual(
        viewport.height,
    );
    expect(
        importButtonBounds!.y + importButtonBounds!.height,
    ).toBeLessThanOrEqual(viewport.height);

    await dialog
        .getByLabel(
            "I understand that the items and information listed above will be skipped or saved differently.",
        )
        .check();
    await expect(importButton).toBeEnabled();
});
