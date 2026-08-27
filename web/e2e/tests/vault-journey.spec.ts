import { expect, test } from "@playwright/test";

const vaultName = "Playwright Vault";
const vaultSecret = "e2e-correct-horse-battery-staple-42!";
const credentialName = "Example account";
const editedCredentialName = "Example account (edited)";

test("creates a vault and manages a credential through lock and unlock", async ({
    page,
}) => {
    await page.goto("/app");

    await expect(
        page.getByText("Vault Manager", { exact: true }),
    ).toBeVisible();
    await page.getByPlaceholder("Enter your new vault name").fill(vaultName);
    await page
        .getByPlaceholder("Enter a description for your new vault")
        .fill("Created by the web Playwright suite");
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
    await addNewButton.click();

    const createDrawer = page.getByRole("dialog", {
        name: "Add New Credential",
    });
    await createDrawer.getByLabel(/^Name/).fill(credentialName);
    await createDrawer.getByLabel(/^Username \/ Email/).fill("e2e@example.com");
    await createDrawer.getByLabel(/^Password/).fill("credential-secret-42!");
    await createDrawer
        .getByLabel("Primary website")
        .fill("https://example.com/login");
    await createDrawer
        .getByLabel("Notes")
        .fill("Initial Playwright credential");
    await createDrawer.getByRole("switch", { name: "Enable TOTP" }).click();
    await expect(createDrawer.getByLabel("TOTP Label")).toHaveCount(0);
    await expect(
        createDrawer.getByRole("button", { name: "Scan QR code" }),
    ).toBeVisible();
    await createDrawer.getByLabel("TOTP Secret").fill("JBSWY3DPEHPK3PXP");
    await createDrawer
        .getByRole("button", { name: "Create Credential" })
        .click();

    await expect(page.getByText(credentialName, { exact: true })).toBeVisible();

    const search = page.getByRole("combobox", { name: "Search credentials" });
    await search.fill("missing-account");
    await expect(page.getByText("No credentials found")).toBeVisible();
    await search.fill("name:Example");
    await expect(page.getByText(credentialName, { exact: true })).toBeVisible();
    await search.clear();

    await page.getByText(credentialName, { exact: true }).click();
    await expect(
        page.getByText("Two-Factor Code", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Edit", exact: true }).click();

    const editDrawer = page.getByRole("dialog", { name: "Edit Credential" });
    await editDrawer.getByLabel(/^Name/).fill(editedCredentialName);
    await editDrawer
        .getByLabel("Notes")
        .fill("Updated by the complete browser journey");
    await editDrawer.getByRole("button", { name: "Save Changes" }).click();
    const editedCredentialActions = page.getByRole("button", {
        name: `Actions for ${editedCredentialName}`,
        exact: true,
    });
    await expect(editedCredentialActions).toBeVisible();

    await page.getByRole("button", { name: "Lock Vault", exact: true }).click();
    const lockDialog = page.getByRole("dialog", { name: "Warning" });
    await lockDialog
        .getByRole("button", { name: /Lock Vault \(\d+s\)/ })
        .click();

    await expect(
        page.getByRole("button", { name: "Unlock Vault" }),
    ).toBeVisible();
    await page.getByPlaceholder("Enter your secret key").fill(vaultSecret);
    await page.getByRole("button", { name: "Unlock Vault" }).click();
    await expect(editedCredentialActions).toBeVisible();

    await editedCredentialActions.click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    const deleteDialog = page.getByRole("dialog", { name: "Warning" });
    await deleteDialog
        .getByRole("button", { name: "Remove credential" })
        .click();

    await expect(
        page.getByText("There are no credentials in this directory."),
    ).toBeVisible();
});
