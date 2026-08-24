import { expect, test } from "../fixtures";

const VAULT_PASSWORD = "e2e-vault-password";

test("creates, saves, and reopens a passkey from the relying-party page", async ({
    context,
    extensionId,
    baseURL,
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
        vaultPage.getByRole("button", { name: "Lock vault" }),
    ).toBeVisible();

    const relyingParty = await context.newPage();
    await relyingParty.goto(baseURL!);
    await relyingParty
        .getByRole("button", { name: "Create a passkey" })
        .click();

    const saveFrame = relyingParty.frameLocator(
        'iframe[data-cryptex-autofill="save"]',
    );
    await expect(
        saveFrame.getByRole("heading", { name: "Save this passkey?" }),
    ).toBeVisible();
    await expect(saveFrame.getByLabel("Name")).toHaveValue("Example E2E");
    await expect(saveFrame.getByLabel("Account")).toHaveValue(
        "person@example.test",
    );
    await expect(saveFrame.getByText("No password is saved")).toBeVisible();
    await saveFrame.getByRole("button", { name: "Save passkey" }).click();
    await expect(
        relyingParty.locator('iframe[data-cryptex-autofill="save"]'),
    ).toHaveCount(0);
    await expect(relyingParty.getByRole("status")).toContainText("Registered");

    await vaultPage.reload();
    const savedPasskey = vaultPage.getByRole("button", {
        name: "Open Example E2E",
    });
    await expect(savedPasskey).toBeVisible();
    await savedPasskey.click();
    await expect(
        vaultPage.getByText("Passkey", { exact: true }).first(),
    ).toBeVisible();
    await expect(
        vaultPage
            .getByRole("main")
            .getByText("Example Person", { exact: true }),
    ).toBeVisible();

    await vaultPage.getByRole("button", { name: "Lock vault" }).click();
    await vaultPage
        .getByRole("textbox", { name: "Password", exact: true })
        .fill(VAULT_PASSWORD);
    await vaultPage
        .getByRole("button", { name: "Unlock", exact: true })
        .click();
    await expect(
        vaultPage.getByRole("button", { name: "Open Example E2E" }),
    ).toBeVisible();
});
