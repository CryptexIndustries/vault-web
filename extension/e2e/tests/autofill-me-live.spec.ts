import { expect, test } from "../fixtures";

const VAULT_PASSWORD = "e2e-vault-password";

test("registers a passkey on Autofill.me", async ({ context, extensionId }) => {
    test.skip(
        process.env.CRYPTEX_LIVE_E2E !== "1",
        "Set CRYPTEX_LIVE_E2E=1 to run the external Autofill.me smoke test",
    );

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

    const relyingParty = await context.newPage();
    await relyingParty.goto("https://autofill.me/form/passkeys-register.html");
    await relyingParty
        .getByRole("textbox", { name: "Email" })
        .fill(`cryptex-${Date.now()}@example.com`);
    await relyingParty.getByRole("button", { name: "Register" }).click();

    const saveFrame = relyingParty.frameLocator(
        'iframe[data-cryptex-autofill="save"]',
    );
    await expect(
        saveFrame.getByRole("heading", { name: "Save this passkey?" }),
    ).toBeVisible();
    await saveFrame.getByRole("button", { name: "Save passkey" }).click();

    await expect(relyingParty.locator("#outcome-container")).toHaveText(
        "Registration success",
    );
});
