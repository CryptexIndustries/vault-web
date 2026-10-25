import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";

const VAULT_PASSWORD = "e2e-vault-password";

/** Rotates the worker's envelope key and waits for the new active key. */
async function rotateWorkerKey(bootstrap: Page) {
    const status = bootstrap.getByRole("status");
    const previous = await status.textContent();
    await bootstrap.getByRole("button", { name: "Rotate worker key" }).click();
    await expect(status).not.toHaveText(previous ?? "");
    await expect(status).toHaveText(/^Active key [0-9A-HJKMNP-TV-Z]{26}$/);
}

test("popup requests recover after the worker rotates its key", async ({
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

    // The unlock form renders only after the popup has fetched the worker's
    // public key and state, so every rotation below makes that key stale.
    const popupPage = await context.newPage();
    await popupPage.setViewportSize({ width: 720, height: 436 });
    await popupPage.goto(`chrome-extension://${extensionId}/popup.html`);
    const password = popupPage.getByRole("textbox", {
        name: "Password",
        exact: true,
    });
    await expect(password).toBeVisible();

    await rotateWorkerKey(bootstrap);
    await password.fill(VAULT_PASSWORD);
    await popupPage
        .getByRole("button", { name: "Unlock", exact: true })
        .click();
    const vaultActions = popupPage.getByRole("button", {
        name: "Vault actions",
    });
    await expect(vaultActions).toBeVisible();

    await rotateWorkerKey(bootstrap);
    await popupPage.getByRole("button", { name: "Add credential" }).click();
    await popupPage.locator("#cred-name").fill("Created after key rotation");
    await popupPage.getByRole("button", { name: "Create Credential" }).click();
    await expect(
        popupPage.getByRole("button", {
            name: "Actions for Created after key rotation",
            exact: true,
        }),
    ).toBeVisible();

    await rotateWorkerKey(bootstrap);
    await vaultActions.click();
    await popupPage.getByRole("menuitem", { name: /Lock vault/ }).click();
    await expect(password).toBeVisible();
});
