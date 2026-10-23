import { expect, type Page, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, readFileSync } from "node:fs";
import path from "node:path";

import {
    createVault,
    hasTool,
    openSSHKeyEditor,
    pickFile,
} from "../vault-helpers";

// Throwaway keys copied from packages/vault-core/src/tests/fixtures/ssh, so
// the Compose runner (which only mounts web/e2e) can read them.
const fixtures = path.resolve(process.cwd(), "web/e2e/fixtures/ssh");
const encryptedKeyPath = path.join(fixtures, "ed25519-aes256-ctr.key");
const encryptedPubPath = path.join(fixtures, "ed25519-aes256-ctr.key.pub");
const fixturePassphrase = "correct horse";
const downloadPassphrase = "e2e download passphrase";
const vaultSecret = "ssh-e2e-correct-horse-battery-staple-42!";

const publicKeyLine = readFileSync(encryptedPubPath, "utf8").trim();
const [, publicKeyBase64] = publicKeyLine.split(/\s+/);
const expectedFingerprint = `SHA256:${createHash("sha256")
    .update(Buffer.from(publicKeyBase64!, "base64"))
    .digest("base64")
    .replace(/=+$/, "")}`;

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

const actionsFor = (page: Page, name: string) =>
    page.getByRole("button", { name: `Actions for ${name}`, exact: true });

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

test("creates, imports, shows, copies, downloads and filters SSH keys", async ({
    page,
}, testInfo) => {
    // Key import and export must run in the SSH key worker.
    const workerUrls: string[] = [];
    page.on("worker", (worker) => workerUrls.push(worker.url()));

    await createVault(page, "SSH key vault", vaultSecret);

    // A login, so the SSH keys filter has something to hide.
    await page.getByRole("button", { name: "Add New" }).click();
    const loginDrawer = page.getByRole("dialog", {
        name: "Add New Credential",
    });
    await loginDrawer.getByLabel(/^Name/).fill("Example login");
    await loginDrawer.getByLabel(/^Username \/ Email/).fill("e2e@example.com");
    await loginDrawer.getByLabel(/^Password/).fill("credential-secret-42!");
    await loginDrawer
        .getByRole("button", { name: "Create Credential" })
        .click();
    await expect(actionsFor(page, "Example login")).toBeVisible();

    // Generate a new key.
    let drawer = await openSSHKeyEditor(page);
    await expect(
        drawer.getByRole("radio", { name: /Generate a new key/ }),
    ).toBeChecked();
    await expect(drawer.getByTestId("ssh-key-fingerprint")).toHaveText(
        /^SHA256:/,
    );
    await drawer.getByLabel(/^Name/).fill("Generated key");
    await expect(drawer.getByLabel("Comment")).toHaveValue("Generated key");
    await drawer.getByRole("button", { name: "Create SSH key" }).click();
    await expect(actionsFor(page, "Generated key")).toBeVisible();

    // Import the encrypted fixture, then add its .pub file.
    drawer = await openSSHKeyEditor(page);
    await drawer.getByRole("radio", { name: /Use an existing key/ }).check();
    await watchForTexts(page, ["Checking key...", "Unlocking..."]);
    await pickFile(page, drawer, "Choose file", encryptedKeyPath);
    await pickFile(page, drawer, "Add .pub file", encryptedPubPath);
    await expect(
        drawer.getByText("Public key file: ed25519-aes256-ctr.key.pub"),
    ).toBeVisible();
    const passphrase = drawer.getByLabel("Passphrase", { exact: true });
    await expect(passphrase).toBeVisible();
    await passphrase.fill("wrong horse");
    await drawer.getByRole("button", { name: "Unlock" }).click();
    await expect(drawer.getByRole("alert")).toContainText(/passphrase/i);
    await passphrase.fill(fixturePassphrase);
    await drawer.getByRole("button", { name: "Unlock" }).click();
    await expect(drawer.getByTestId("ssh-key-fingerprint")).toHaveText(
        expectedFingerprint,
    );
    await expect(passphrase).toHaveCount(0);
    expect(await seenTexts(page)).toEqual(
        expect.arrayContaining(["Checking key...", "Unlocking..."]),
    );
    // The web app starts no other workers. Turbopack names the production
    // worker file after its loader, so the URL can't be checked.
    expect(workerUrls.length).toBeGreaterThan(0);

    // Picking the same files again keeps the unlocked key as it is.
    await watchForTexts(page, ["Checking key...", "Unlocking..."]);
    await pickFile(page, drawer, "Choose file", encryptedKeyPath);
    await pickFile(page, drawer, "Add .pub file", encryptedPubPath);
    await page.waitForTimeout(700);
    expect(await seenTexts(page)).toEqual([]);
    await expect(drawer.getByTestId("ssh-key-fingerprint")).toHaveText(
        expectedFingerprint,
    );
    await expect(passphrase).toHaveCount(0);
    await expect(
        drawer.getByRole("button", { name: "Create SSH key" }),
    ).toBeEnabled();

    // Removing the .pub file re-checks the key with the passphrase that
    // worked, so it stays unlocked.
    await drawer
        .getByRole("button", { name: "Remove public key file" })
        .click();
    await expect(drawer.getByTestId("ssh-key-fingerprint")).toHaveText(
        expectedFingerprint,
    );
    await expect(passphrase).toHaveCount(0);
    await pickFile(page, drawer, "Add .pub file", encryptedPubPath);
    await expect(
        drawer.getByText("Public key file: ed25519-aes256-ctr.key.pub"),
    ).toBeVisible();
    await expect(drawer.getByTestId("ssh-key-fingerprint")).toHaveText(
        expectedFingerprint,
    );
    await expect(drawer.getByLabel("Comment")).toHaveValue(
        "ed25519-enc@fixtures",
    );
    await drawer.getByLabel(/^Name/).fill("Imported key");
    await drawer.getByRole("button", { name: "Create SSH key" }).click();
    await expect(actionsFor(page, "Imported key")).toBeVisible();

    // Detail view.
    await page.getByText("Imported key", { exact: true }).first().click();
    const detail = page.getByRole("heading", { name: "Imported key" });
    await expect(detail).toBeVisible();
    await expect(page.getByText(expectedFingerprint).first()).toBeVisible();
    await expect(page.getByText("Ed25519").first()).toBeVisible();
    await expect(page.getByText("BEGIN OPENSSH PRIVATE KEY")).toHaveCount(0);

    await page.getByRole("button", { name: "Copy public key" }).click();
    await expect
        .poll(() => page.evaluate(() => navigator.clipboard.readText()))
        .toBe(publicKeyLine);
    // A public key isn't secret, so no reminder to clear the clipboard.
    await expect(page.getByText("Copied", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Show private key" }).click();
    await expect(page.getByLabel("Private key", { exact: true })).toContainText(
        "-----BEGIN OPENSSH PRIVATE KEY-----",
    );
    await page.getByRole("button", { name: "Hide private key" }).click();

    const publicDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "Save public key" }).click();
    const publicFile = await publicDownload;
    expect(publicFile.suggestedFilename()).toBe("Imported_key.pub");
    const publicPath = testInfo.outputPath("Imported_key.pub");
    await publicFile.saveAs(publicPath);
    expect(readFileSync(publicPath, "utf8")).toBe(`${publicKeyLine}\n`);

    // Save the private key with a passphrase.
    await page.getByRole("button", { name: "Save private key" }).click();
    const downloadDialog = page.getByRole("dialog", {
        name: "Save private key",
    });
    await downloadDialog
        .getByLabel("Passphrase", { exact: true })
        .fill(downloadPassphrase);
    await downloadDialog
        .getByLabel("Confirm passphrase")
        .fill(downloadPassphrase);
    const privateDownload = page.waitForEvent("download");
    await watchForTexts(page, ["Encrypting..."]);
    await downloadDialog.getByRole("button", { name: "Save" }).click();
    const privateFile = await privateDownload;
    expect(await seenTexts(page)).toContain("Encrypting...");
    expect(privateFile.suggestedFilename()).toBe("Imported_key");
    await expect(downloadDialog).toHaveCount(0);
    const privatePath = testInfo.outputPath("Imported_key");
    await privateFile.saveAs(privatePath);
    const privateKey = readFileSync(privatePath, "utf8");
    expect(privateKey).toContain("-----BEGIN OPENSSH PRIVATE KEY-----");
    const keyBody = Buffer.from(
        privateKey.replace(/-----[^-]+-----|\s/g, ""),
        "base64",
    ).toString("latin1");
    expect(keyBody).toContain("aes256-ctr");
    expect(keyBody).toContain("bcrypt");

    // An independent check when OpenSSH is installed.
    if (hasTool("ssh-keygen")) {
        chmodSync(privatePath, 0o600);
        const derived = execFileSync(
            "ssh-keygen",
            ["-y", "-P", downloadPassphrase, "-f", privatePath],
            { encoding: "utf8" },
        );
        expect(derived.trim().split(/\s+/).slice(0, 2)).toEqual(
            publicKeyLine.split(/\s+/).slice(0, 2),
        );
    } else {
        testInfo.annotations.push({
            type: "skip-check",
            description: "ssh-keygen is not installed",
        });
    }

    // The downloaded file decrypts back to the same key in the app too.
    drawer = await openSSHKeyEditor(page);
    await drawer.getByRole("radio", { name: /Use an existing key/ }).check();
    await pickFile(page, drawer, "Choose file", privatePath);
    await drawer
        .getByLabel("Passphrase", { exact: true })
        .fill(downloadPassphrase);
    await drawer.getByRole("button", { name: "Unlock" }).click();
    await expect(drawer.getByTestId("ssh-key-fingerprint")).toHaveText(
        expectedFingerprint,
    );
    await drawer.getByRole("button", { name: "Cancel" }).click();
    await page
        .getByRole("dialog", { name: "Warning" })
        .getByRole("button", { name: "Discard changes" })
        .click();
    await expect(drawer).toHaveCount(0);

    // The SSH keys filter shows only SSH key items.
    await page.getByRole("button", { name: "Browse directories" }).click();
    await page.getByRole("menuitem", { name: /SSH keys/ }).click();
    await expect(actionsFor(page, "Generated key")).toBeVisible();
    await expect(actionsFor(page, "Imported key")).toBeVisible();
    await expect(actionsFor(page, "Example login")).toHaveCount(0);

    // Search matches the comment.
    const search = page.getByRole("combobox", { name: "Search credentials" });
    await search.fill("ed25519-enc@fixtures");
    await expect(actionsFor(page, "Imported key")).toBeVisible();
    await expect(actionsFor(page, "Generated key")).toHaveCount(0);
    await search.clear();

    await page.getByRole("button", { name: "Browse directories" }).click();
    await page.getByRole("menuitem", { name: /All credentials/ }).click();
    await expect(actionsFor(page, "Example login")).toBeVisible();
});
