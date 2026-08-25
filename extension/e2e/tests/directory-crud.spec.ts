import { expect, test } from "../fixtures";

const VAULT_PASSWORD = "e2e-vault-password";

test("creates, renames, and deletes a directory", async ({
    context,
    extensionId,
}) => {
    const bootstrap = await context.newPage();
    await bootstrap.goto(
        `chrome-extension://${extensionId}/e2e-bootstrap.html`,
    );
    await bootstrap
        .getByRole("button", { name: "Reset and seed vault" })
        .click();
    await expect(bootstrap.getByRole("status")).toContainText("Seeded vault");

    const vaultPage = await context.newPage();
    await vaultPage.goto(
        `chrome-extension://${extensionId}/popup.html?view=tab`,
    );
    await vaultPage
        .getByRole("textbox", { name: "Password", exact: true })
        .fill(VAULT_PASSWORD);
    await vaultPage
        .getByRole("button", { name: "Unlock", exact: true })
        .click();
    await expect(
        vaultPage.getByRole("button", { name: "Browse directories" }),
    ).toBeVisible();

    await vaultPage.getByRole("button", { name: "Browse directories" }).click();
    await vaultPage.getByRole("menuitem", { name: "New directory" }).click();
    await expect(
        vaultPage.getByRole("heading", { name: "Create directory" }),
    ).toBeVisible();
    await vaultPage.getByLabel("Name", { exact: true }).fill("Work");
    await vaultPage.getByRole("button", { name: "Save", exact: true }).click();
    await expect(vaultPage.getByText("Directory created.")).toBeVisible();

    await vaultPage.getByRole("button", { name: "Browse directories" }).click();
    await expect(
        vaultPage.getByRole("menuitem", { name: /Work/ }),
    ).toBeVisible();
    await vaultPage
        .getByRole("menuitem", { name: "Manage directories" })
        .click();
    await vaultPage.getByRole("button", { name: "Rename Work" }).click();
    await expect(
        vaultPage.getByRole("heading", { name: "Rename directory" }),
    ).toBeVisible();
    await vaultPage.getByLabel("Name", { exact: true }).fill("Personal");
    await vaultPage.getByRole("button", { name: "Save", exact: true }).click();
    await expect(vaultPage.getByText("Directory renamed.")).toBeVisible();

    await vaultPage.getByRole("button", { name: "Delete Personal" }).click();
    await expect(
        vaultPage.getByText(
            "Delete “Personal” and 0 credentials? This permanently deletes every credential in the directory.",
        ),
    ).toBeVisible();
    await vaultPage.getByRole("button", { name: "Delete directory" }).click();
    await expect(
        vaultPage.getByText("Directory and credentials deleted."),
    ).toBeVisible();
    await expect(vaultPage.getByText("No directories yet.")).toBeVisible();
});

test("creates and selects a directory from the credential form", async ({
    context,
    extensionId,
}) => {
    const bootstrap = await context.newPage();
    await bootstrap.goto(
        `chrome-extension://${extensionId}/e2e-bootstrap.html`,
    );
    await bootstrap
        .getByRole("button", { name: "Reset and seed vault" })
        .click();
    await expect(bootstrap.getByRole("status")).toContainText("Seeded vault");

    const vaultPage = await context.newPage();
    await vaultPage.goto(
        `chrome-extension://${extensionId}/popup.html?view=tab`,
    );
    await vaultPage
        .getByRole("textbox", { name: "Password", exact: true })
        .fill(VAULT_PASSWORD);
    await vaultPage
        .getByRole("button", { name: "Unlock", exact: true })
        .click();

    await vaultPage.getByRole("button", { name: "Add credential" }).click();
    const credentialDialog = vaultPage.getByRole("dialog", {
        name: "Add New Credential",
    });
    await credentialDialog
        .getByRole("button", { name: "New directory" })
        .click();

    const directoryDialog = vaultPage.getByRole("dialog", {
        name: "Create directory",
    });
    await directoryDialog.getByLabel("Name", { exact: true }).fill("Clients");
    await directoryDialog
        .getByRole("button", { name: "Save", exact: true })
        .click();

    await expect(vaultPage.getByText("Directory created.")).toBeVisible();
    await expect(
        credentialDialog.getByRole("button", {
            name: "Directory",
            exact: true,
        }),
    ).toHaveAttribute("title", "Clients");
});
