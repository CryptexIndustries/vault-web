import type { Page } from "@playwright/test";

import { expect, test } from "../fixtures";

const OLD_PASSWORD = "e2e-vault-password";
const NEW_PASSWORD = "e2e-vault-password-rotated";

async function seedVault(page: Page, extensionId: string): Promise<void> {
    await page.goto(`chrome-extension://${extensionId}/e2e-bootstrap.html`);
    await page.getByRole("button", { name: "Reset and seed vault" }).click();
    await expect(page.getByRole("status")).toContainText("Seeded vault");
}

async function unlock(page: Page, extensionId: string, password: string) {
    await page.goto(`chrome-extension://${extensionId}/popup.html?view=tab`);
    await page
        .getByRole("textbox", { name: "Password", exact: true })
        .fill(password);
    await page.getByRole("button", { name: "Unlock", exact: true }).click();
}

test("rotates the local DEK from Vault Settings and remains usable after relock", async ({
    context,
    extensionId,
}) => {
    const bootstrap = await context.newPage();
    await seedVault(bootstrap, extensionId);

    const vaultPage = await context.newPage();
    await unlock(vaultPage, extensionId, OLD_PASSWORD);
    await expect(
        vaultPage.getByRole("button", { name: "Vault actions" }),
    ).toBeVisible();

    await vaultPage.getByRole("button", { name: "Vault actions" }).click();
    await vaultPage.getByRole("menuitem", { name: /Vault Settings/ }).click();
    const dialog = vaultPage.getByRole("dialog", {
        name: "Encryption & Security",
    });
    await expect(dialog).toBeVisible();

    const protectionRotation = dialog
        .getByLabel("Rotate this device's vault encryption key")
        .first();
    const historyDeletion = dialog
        .getByLabel("Delete older managed backups after replacement")
        .first();
    await expect(protectionRotation).not.toBeChecked();
    await expect(historyDeletion).not.toBeChecked();

    await dialog.getByLabel("Current master password").fill(OLD_PASSWORD);
    await dialog.getByLabel("New password").fill(NEW_PASSWORD);
    await dialog.getByLabel("Confirm password").fill(NEW_PASSWORD);
    await protectionRotation.check();
    await expect(
        dialog.getByText(/generates a new recovery code/).first(),
    ).toBeVisible();

    const kdfRisk = dialog.getByLabel(
        /I understand the risk and want to use these key derivation settings anyway/,
    );
    if (await kdfRisk.isVisible()) await kdfRisk.check();

    await dialog
        .getByRole("button", { name: "Save protection settings" })
        .click();
    await expect(
        vaultPage.getByText(
            "Security settings and vault encryption key updated.",
        ),
    ).toBeVisible();
    await expect(
        dialog.getByText("New recovery code", { exact: true }),
    ).toBeVisible();
    const closeButtons = dialog.getByRole("button", {
        name: "Close",
        exact: true,
    });
    const footerCloseButton = closeButtons.first();
    await expect(footerCloseButton).toBeDisabled();
    await closeButtons.last().click();
    await expect(dialog).toBeVisible();

    await dialog.getByLabel(/I saved the new secrets and understand/).check();
    await footerCloseButton.click();

    await vaultPage.getByRole("button", { name: "Vault actions" }).click();
    await vaultPage.getByRole("menuitem", { name: /Lock vault/ }).click();
    await expect(
        vaultPage.getByRole("button", { name: "Unlock", exact: true }),
    ).toBeVisible();

    await vaultPage
        .getByRole("textbox", { name: "Password", exact: true })
        .fill(OLD_PASSWORD);
    await vaultPage
        .getByRole("button", { name: "Unlock", exact: true })
        .click();
    await expect(vaultPage.getByRole("alert")).toContainText(
        "Decryption failed",
    );

    await vaultPage
        .getByRole("textbox", { name: "Password", exact: true })
        .fill(NEW_PASSWORD);
    await vaultPage
        .getByRole("button", { name: "Unlock", exact: true })
        .click();
    await expect(
        vaultPage.getByRole("button", { name: "Vault actions" }),
    ).toBeVisible();
});

test("enrolls a protection phrase while keeping same-profile unlock password-only", async ({
    context,
    extensionId,
}) => {
    const bootstrap = await context.newPage();
    await seedVault(bootstrap, extensionId);

    const vaultPage = await context.newPage();
    await unlock(vaultPage, extensionId, OLD_PASSWORD);
    await expect(
        vaultPage.getByRole("button", { name: "Vault actions" }),
    ).toBeVisible();

    await vaultPage.getByRole("button", { name: "Vault actions" }).click();
    await vaultPage.getByRole("menuitem", { name: /Vault Settings/ }).click();
    const dialog = vaultPage.getByRole("dialog", {
        name: "Encryption & Security",
    });
    await dialog.getByLabel("Current master password").fill(OLD_PASSWORD);
    await dialog.getByRole("combobox").click();
    await vaultPage
        .getByRole("option", {
            name: "Generated protection phrase (128-bit)",
        })
        .click();
    const kdfRisk = dialog.getByLabel(
        /I understand the risk and want to use these key derivation settings anyway/,
    );
    if (await kdfRisk.isVisible()) await kdfRisk.check();
    await dialog
        .getByRole("button", { name: "Save protection settings" })
        .click();

    await expect(
        vaultPage.getByText("Security settings updated.", { exact: true }),
    ).toBeVisible();
    await expect(
        dialog.getByText("New protection phrase", { exact: true }),
    ).toBeVisible();
    await expect(dialog.locator("code")).not.toBeEmpty();
    await dialog.getByLabel(/I saved the new secrets and understand/).check();
    await dialog
        .getByRole("button", { name: "Close", exact: true })
        .first()
        .click();

    await vaultPage.getByRole("button", { name: "Vault actions" }).click();
    await vaultPage.getByRole("menuitem", { name: /Lock vault/ }).click();
    await unlock(vaultPage, extensionId, OLD_PASSWORD);

    await expect(
        vaultPage.getByRole("button", { name: "Vault actions" }),
    ).toBeVisible();
});
