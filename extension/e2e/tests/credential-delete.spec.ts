import { expect, test } from "../fixtures";

const VAULT_PASSWORD = "e2e-vault-password";

test("confirms credential deletion with the standard warning dialog in popup mode", async ({
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

    const popupPage = await context.newPage();
    await popupPage.setViewportSize({ width: 720, height: 436 });
    await popupPage.goto(`chrome-extension://${extensionId}/popup.html`);
    await popupPage
        .getByRole("textbox", { name: "Password", exact: true })
        .fill(VAULT_PASSWORD);
    await popupPage
        .getByRole("button", { name: "Unlock", exact: true })
        .click();

    await popupPage.getByRole("button", { name: "Vault actions" }).click();
    await expect(
        popupPage.getByRole("menuitem", { name: /Open in browser tab/ }),
    ).toBeVisible();
    await expect(
        popupPage.getByRole("menuitem", { name: /Lock vault/ }),
    ).toBeVisible();
    await popupPage
        .getByRole("menuitem", { name: /Password generator/ })
        .click();

    const generator = popupPage.getByRole("dialog", {
        name: "Password Generator",
    });
    await expect(generator).toBeVisible();
    await generator.getByRole("button", { name: "Advanced Options" }).click();

    const generatorBox = await generator.boundingBox();
    expect(generatorBox).not.toBeNull();
    expect(generatorBox!.y).toBeGreaterThanOrEqual(0);
    expect(generatorBox!.y + generatorBox!.height).toBeLessThanOrEqual(436);
    await expect(generator.locator(".overflow-y-auto")).toHaveCSS(
        "overflow-y",
        "auto",
    );
    await generator.getByRole("button", { name: "Close generator" }).click();

    await popupPage.getByRole("button", { name: "Add credential" }).click();
    await popupPage.locator("#cred-name").fill("Popup delete target");
    await popupPage.locator("#cred-notes").fill("Popup-only searchable marker");
    await popupPage.getByRole("button", { name: "Create Credential" }).click();

    const actions = popupPage.getByRole("button", {
        name: "Actions for Popup delete target",
        exact: true,
    });
    await expect(actions).toBeVisible();

    const search = popupPage.getByRole("combobox", {
        name: "Search credentials",
    });
    await search.fill('note:"searchable marker"');
    await expect(actions).toBeVisible();
    await search.fill("note:missing");
    await expect(actions).toBeHidden();
    await search.fill("");
    await search.press("Escape");

    await actions.click();
    await popupPage.getByRole("menuitem", { name: "Delete" }).click();

    const warning = popupPage.getByRole("dialog", { name: "Warning" });
    await expect(warning).toContainText(
        'You are about to remove the "Popup delete target" credential.',
    );
    await warning.getByRole("button", { name: "Cancel" }).click();
    await expect(actions).toBeVisible();

    await actions.click();
    await popupPage.getByRole("menuitem", { name: "Delete" }).click();
    await warning.getByRole("button", { name: "Remove credential" }).click();

    await expect(actions).toBeHidden();
    await expect(popupPage.getByText("Credential removed.")).toBeVisible();
});
