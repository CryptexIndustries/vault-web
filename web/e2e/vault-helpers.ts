import { expect, type Locator, type Page } from "@playwright/test";
import { spawnSync } from "node:child_process";

export const hasTool = (tool: string) =>
    spawnSync("sh", ["-c", `command -v ${tool}`]).status === 0;

export async function finishVaultSetup(page: Page) {
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
}

export async function createVault(page: Page, name: string, secret: string) {
    await page.goto("/app");
    await page.getByPlaceholder("Enter your new vault name").fill(name);
    await page.getByPlaceholder("Enter your secret key").fill(secret);
    await page.getByRole("button", { name: "Create Vault" }).click();
    const recoveryDialog = page.getByRole("dialog", {
        name: "Save these secrets now",
    });
    await recoveryDialog
        .getByLabel("I have written down the recovery code")
        .check();
    await recoveryDialog.getByRole("button", { name: "Continue" }).click();
    await finishVaultSetup(page);
}

export async function openSSHKeyEditor(page: Page) {
    await page.getByRole("button", { name: "Choose item type" }).click();
    await page.getByRole("menuitem", { name: "SSH key" }).click();
    const drawer = page.getByRole("dialog", { name: "Add SSH key" });
    await expect(drawer).toBeVisible();
    return drawer;
}

/** Picks one file through the editor's file button. */
export async function pickFile(
    page: Page,
    drawer: Locator,
    button: "Choose file" | "Add .pub file",
    filePath: string,
) {
    const chooser = page.waitForEvent("filechooser");
    await drawer.getByRole("button", { name: button }).click();
    const fileChooser = await chooser;
    expect(fileChooser.isMultiple()).toBe(false);
    await fileChooser.setFiles(filePath);
}
