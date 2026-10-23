import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { BrowserContext, Page } from "@playwright/test";

import { importSSHPrivateKey } from "../../../packages/vault-core/src/vault-utils/ssh-key";
import { expect, test } from "../fixtures";

const VAULT_PASSWORD = "e2e-vault-password";
const FIXTURE_PASSPHRASE = "correct horse";
const DOWNLOAD_PASSPHRASE = "e2e download passphrase";

const fixtureDirectory = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../packages/vault-core/src/tests/fixtures/ssh",
);
const fixture = (name: string) => path.join(fixtureDirectory, name);

async function openUnlockedVault(
    page: Page,
    extensionId: string,
    view: "tab" | "popup" = "tab",
) {
    await page.goto(
        `chrome-extension://${extensionId}/popup.html${view === "tab" ? "?view=tab" : ""}`,
    );
    await page
        .getByRole("textbox", { name: "Password", exact: true })
        .fill(VAULT_PASSWORD);
    await page.getByRole("button", { name: "Unlock", exact: true }).click();
    await expect(
        page.getByRole("button", { name: "Browse directories" }),
    ).toBeVisible();
}

/**
 * Records which of `texts` appear on the page from now on, however briefly,
 * so short busy states can be asserted after the fact.
 */
async function watchForTexts(page: Page, texts: string[]) {
    await page.evaluate((wanted) => {
        const seen = new Set<string>();
        (window as unknown as { __seenTexts: Set<string> }).__seenTexts = seen;
        const check = () => {
            const text = document.body.innerText;
            for (const item of wanted) if (text.includes(item)) seen.add(item);
        };
        new MutationObserver(check).observe(document.body, {
            childList: true,
            subtree: true,
            characterData: true,
        });
    }, texts);
}

const seenTexts = (page: Page) =>
    page.evaluate(() => [
        ...(window as unknown as { __seenTexts: Set<string> }).__seenTexts,
    ]);

async function seedVault(context: BrowserContext, extensionId: string) {
    const bootstrap = await context.newPage();
    await bootstrap.goto(
        `chrome-extension://${extensionId}/e2e-bootstrap.html`,
    );
    await bootstrap
        .getByRole("button", { name: "Reset and seed vault" })
        .click();
    await expect(bootstrap.getByRole("status")).toContainText("Seeded vault");
}

const actionsFor = (page: Page, name: string) =>
    page.getByRole("button", { name: `Actions for ${name}`, exact: true });

/** Picks one file through the SSH key editor's file button. */
async function pickFile(
    page: Page,
    button: "Choose file" | "Add .pub file",
    filePath: string,
) {
    const chooser = page.waitForEvent("filechooser");
    await page
        .getByRole("dialog", { name: "Add SSH key" })
        .getByRole("button", { name: button })
        .click();
    const fileChooser = await chooser;
    expect(fileChooser.isMultiple()).toBe(false);
    await fileChooser.setFiles(filePath);
}

async function openSSHKeyEditor(page: Page) {
    await page.getByRole("button", { name: "Choose item type" }).click();
    await page.getByRole("menuitem", { name: "SSH key" }).click();
    await expect(
        page.getByRole("dialog", { name: "Add SSH key" }),
    ).toBeVisible();
}

test("creates, imports, shows, copies and downloads SSH keys", async ({
    context,
    extensionId,
}) => {
    // Three bcrypt runs (two unlock attempts and the encrypted download).
    test.setTimeout(120_000);

    await seedVault(context, extensionId);

    const page = await context.newPage();
    // Key import and export must run in the SSH key worker.
    const workerUrls: string[] = [];
    page.on("worker", (worker) => workerUrls.push(worker.url()));
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await openUnlockedVault(page, extensionId);
    const encryptedKey = fixture("ed25519-aes256-ctr.key");
    const pickEncryptedKey = async () => {
        await pickFile(page, "Choose file", encryptedKey);
        await pickFile(page, "Add .pub file", `${encryptedKey}.pub`);
    };

    // A login, so the SSH keys filter has something to hide.
    await page.getByRole("button", { name: "Add credential" }).click();
    await page.locator("#cred-name").fill("GitHub login");
    await page.getByRole("button", { name: "Create Credential" }).click();
    await expect(actionsFor(page, "GitHub login")).toBeVisible();

    // Generate: Ed25519 with the comment following the name.
    await openSSHKeyEditor(page);
    const editor = page.getByRole("dialog", { name: "Add SSH key" });
    await expect(
        editor.getByRole("radio", { name: /Generate a new key/ }),
    ).toBeChecked();
    await expect(editor.getByText(/^ssh-ed25519 AAAA\S+$/)).toBeVisible();
    await editor.locator("#cred-name").fill("Work laptop");
    await expect(editor.locator("#ssh-comment")).toHaveValue("Work laptop");
    const generatedPublicKey = editor.getByText(
        /^ssh-ed25519 AAAA\S+ Work laptop$/,
    );
    await expect(generatedPublicKey).toBeVisible();
    const generatedLine = await generatedPublicKey.textContent();

    // Switching modes keeps the generated key.
    await editor.getByRole("radio", { name: /Use an existing key/ }).check();
    await editor.getByRole("radio", { name: /Generate a new key/ }).check();
    await expect(editor.getByText(generatedLine!)).toBeVisible();
    await editor.getByRole("button", { name: "Create SSH key" }).click();
    await expect(actionsFor(page, "Work laptop")).toBeVisible();

    // Import the encrypted fixture together with its .pub file.
    await openSSHKeyEditor(page);
    await editor.getByRole("radio", { name: /Use an existing key/ }).check();
    await editor.locator("#ssh-private-key").fill("not a key");
    await expect(
        editor.getByText("This doesn't look like an SSH private key."),
    ).toBeVisible();
    await editor.locator("#ssh-private-key").fill("");

    await watchForTexts(page, ["Checking key...", "Unlocking..."]);
    await pickEncryptedKey();
    await expect(
        editor.getByText("Public key file: ed25519-aes256-ctr.key.pub"),
    ).toBeVisible();
    const passphrase = editor.locator("#ssh-import-passphrase");
    await expect(passphrase).toBeVisible();
    await passphrase.fill("wrong passphrase");
    await editor.getByRole("button", { name: "Unlock", exact: true }).click();
    await expect(
        editor.getByText("The passphrase is incorrect."),
    ).toBeVisible();
    await passphrase.fill(FIXTURE_PASSPHRASE);
    await editor.getByRole("button", { name: "Unlock", exact: true }).click();
    const fixtureFingerprint =
        "SHA256:FgJyvLLzDuDxEny970gdFu3G8z6d8daahg2A+LVGV68";
    await expect(editor.getByText(fixtureFingerprint)).toBeVisible();
    await expect(editor.locator("#ssh-comment")).toHaveValue(
        "ed25519-enc@fixtures",
    );
    expect(await seenTexts(page)).toEqual(
        expect.arrayContaining(["Checking key...", "Unlocking..."]),
    );
    expect(workerUrls.some((url) => url.includes("ssh-key"))).toBe(true);

    // Picking the same files again keeps the unlocked key as it is.
    await watchForTexts(page, ["Checking key...", "Unlocking..."]);
    await pickEncryptedKey();
    await page.waitForTimeout(700);
    expect(await seenTexts(page)).toEqual([]);
    await expect(editor.getByText(fixtureFingerprint)).toBeVisible();
    await expect(passphrase).toBeHidden();
    await expect(
        editor.getByRole("button", { name: "Create SSH key" }),
    ).toBeEnabled();
    await editor.locator("#cred-name").fill("Imported key");
    await editor.getByRole("button", { name: "Create SSH key" }).click();
    await expect(actionsFor(page, "Imported key")).toBeVisible();

    // The SSH keys filter shows only SSH key items.
    await page.getByRole("button", { name: "Browse directories" }).click();
    await page.getByRole("menuitem", { name: /SSH keys/ }).click();
    await expect(
        page.getByRole("button", { name: "Browse directories" }),
    ).toContainText("SSH keys");
    await expect(actionsFor(page, "GitHub login")).toBeHidden();
    await expect(actionsFor(page, "Work laptop")).toBeVisible();

    // Search matches the fingerprint.
    const search = page.getByRole("combobox", { name: "Search credentials" });
    await search.fill("FgJyvLLzDuDx");
    await expect(actionsFor(page, "Work laptop")).toBeHidden();
    await expect(actionsFor(page, "Imported key")).toBeVisible();
    await search.fill("");
    await search.press("Escape");

    // Detail view.
    await page.getByText("Imported key", { exact: true }).click();
    const detail = page.getByRole("main");
    await expect(detail.getByText("SSH key", { exact: true })).toBeVisible();
    await expect(detail.getByText("Ed25519").first()).toBeVisible();
    await expect(detail.getByText(fixtureFingerprint)).toBeVisible();
    const fixturePublicKey = (
        await fs.readFile(`${encryptedKey}.pub`, "utf8")
    ).trim();
    await expect(detail.getByTitle(fixturePublicKey)).toHaveText(
        fixturePublicKey,
    );

    await detail.getByRole("button", { name: "Copy public key" }).click();
    await expect
        .poll(() => page.evaluate(() => navigator.clipboard.readText()))
        .toBe(fixturePublicKey);

    await detail.getByRole("button", { name: "Show private key" }).click();
    await expect(
        detail.getByLabel("Private key", { exact: true }),
    ).toContainText("-----BEGIN OPENSSH PRIVATE KEY-----");

    const publicDownload = page.waitForEvent("download");
    await detail.getByRole("button", { name: "Save public key" }).click();
    const publicFile = await publicDownload;
    expect(publicFile.suggestedFilename()).toBe("Imported_key.pub");
    expect(await fs.readFile(await publicFile.path(), "utf8")).toBe(
        `${fixturePublicKey}\n`,
    );

    // Save the private key with a passphrase and read it back.
    await detail.getByRole("button", { name: "Save private key" }).click();
    const downloadDialog = page.getByRole("dialog", {
        name: "Save private key",
    });
    await expect(downloadDialog).toContainText("chmod 600 Imported_key");
    await downloadDialog
        .locator("#ssh-download-passphrase")
        .fill(DOWNLOAD_PASSPHRASE);
    await downloadDialog
        .locator("#ssh-download-passphrase-confirm")
        .fill("something else");
    await expect(
        downloadDialog.getByText("The passphrases don't match."),
    ).toBeVisible();
    await expect(
        downloadDialog.getByRole("button", { name: "Save" }),
    ).toBeDisabled();
    await downloadDialog
        .locator("#ssh-download-passphrase-confirm")
        .fill(DOWNLOAD_PASSPHRASE);
    const privateDownload = page.waitForEvent("download");
    await watchForTexts(page, ["Encrypting..."]);
    await downloadDialog.getByRole("button", { name: "Save" }).click();
    const privateFile = await privateDownload;
    expect(await seenTexts(page)).toContain("Encrypting...");
    expect(privateFile.suggestedFilename()).toBe("Imported_key");
    await expect(downloadDialog).toBeHidden();

    const downloaded = await fs.readFile(await privateFile.path(), "utf8");
    const withoutPassphrase = await importSSHPrivateKey(downloaded);
    expect(withoutPassphrase.isErr() && withoutPassphrase.error.code).toBe(
        "passphrase-required",
    );
    const decrypted = await importSSHPrivateKey(downloaded, {
        passphrase: DOWNLOAD_PASSPHRASE,
    });
    expect(decrypted.isOk()).toBe(true);
    expect(
        decrypted.isOk() &&
            `${decrypted.value.PublicKey} ${decrypted.value.Comment}`,
    ).toBe(fixturePublicKey);
});

test("the popup hands SSH key file import over to a full-page tab", async ({
    context,
    extensionId,
}) => {
    test.setTimeout(90_000);
    await seedVault(context, extensionId);

    // Without ?view=tab the page runs as the toolbar popup.
    const popup = await context.newPage();
    await openUnlockedVault(popup, extensionId, "popup");
    await openSSHKeyEditor(popup);
    const popupEditor = popup.getByRole("dialog", { name: "Add SSH key" });
    await popupEditor.locator("#cred-name").fill("Handed over key");
    await popupEditor
        .getByRole("radio", { name: /Use an existing key/ })
        .check();

    // Pasting still works in the popup.
    await popupEditor.locator("#ssh-private-key").fill("not a key");
    await expect(
        popupEditor.getByText("This doesn't look like an SSH private key."),
    ).toBeVisible();
    await popupEditor.locator("#ssh-private-key").fill("");

    // Add .pub file opens a picker too, so it hands over like Choose file.
    let pickerOpened = false;
    popup.on("filechooser", () => {
        pickerOpened = true;
    });
    const tabPromise = context.waitForEvent("page");
    await popupEditor.getByRole("button", { name: "Add .pub file" }).click();
    const tab = await tabPromise;
    expect(pickerOpened).toBe(false);
    await tab.waitForLoadState();
    expect(new URL(tab.url()).search).toBe("?view=tab");

    // The tab reopens the form on "Use an existing key", ready for a file.
    const editor = tab.getByRole("dialog", { name: "Add SSH key" });
    await expect(editor).toBeVisible();
    await expect(
        editor.getByRole("radio", { name: /Use an existing key/ }),
    ).toBeChecked();
    await expect(editor.locator("#cred-name")).toHaveValue("Handed over key");
    const hint = editor.getByTestId("ssh-key-file-hint");
    await expect(hint).toBeVisible();
    await expect(editor.locator("#ssh-private-key")).toHaveValue("");

    await pickFile(tab, "Choose file", fixture("ed25519.key"));
    await expect(hint).toBeHidden();
    await pickFile(tab, "Add .pub file", fixture("ed25519.key.pub"));
    await expect(
        editor.getByText("Public key file: ed25519.key.pub"),
    ).toBeVisible();
    await expect(editor.locator("#ssh-comment")).toHaveValue(
        "ed25519@fixtures",
    );
    await editor.getByRole("button", { name: "Create SSH key" }).click();
    await expect(actionsFor(tab, "Handed over key")).toBeVisible();
});
