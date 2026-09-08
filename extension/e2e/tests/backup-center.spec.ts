import fs from "node:fs/promises";
import type { Page } from "@playwright/test";

import { createManagedBackupApiMock } from "../backup-api-mock";
import { expect, test } from "../fixtures";

const VAULT_PASSWORD = "e2e-vault-password";
const POPUP_WIDTH = 720;
const POPUP_HEIGHT = 436;

type FakeOnlineServicesSession = {
    sessionToken: string;
    sessionExpiresAt: number;
    refreshToken: null;
    refreshExpiresAt: null;
    deviceId: string;
    privateKeyJWK: null;
};

async function seedVault(page: Page, extensionId: string): Promise<void> {
    await page.goto(`chrome-extension://${extensionId}/e2e-bootstrap.html`);
    await page.getByRole("button", { name: "Reset and seed vault" }).click();
    await expect(page.getByRole("status")).toContainText("Seeded vault");
}

async function unlockVault(page: Page, extensionId: string): Promise<void> {
    await page.goto(`chrome-extension://${extensionId}/popup.html?view=tab`);
    await page
        .getByRole("textbox", { name: "Password", exact: true })
        .fill(VAULT_PASSWORD);
    await page.getByRole("button", { name: "Unlock", exact: true }).click();
    await expect(
        page.getByRole("button", { name: "Vault actions" }),
    ).toBeVisible();
}

async function openBackupCenter(page: Page): Promise<void> {
    await page.getByRole("button", { name: "Vault actions" }).click();
    await page.getByRole("menuitem", { name: /Backup Center/ }).click();
    await expect(
        page.getByRole("dialog", { name: "Backup Center" }),
    ).toBeVisible();
}

async function attachFakeOnlineServicesSession(page: Page): Promise<void> {
    const record: FakeOnlineServicesSession = {
        sessionToken: "e2e-session-token",
        sessionExpiresAt: Date.now() + 60 * 60 * 1000,
        refreshToken: null,
        refreshExpiresAt: null,
        deviceId: "e2e-device",
        privateKeyJWK: null,
    };
    await page.evaluate(async (session) => {
        const chromeApi = (
            globalThis as typeof globalThis & {
                chrome: {
                    storage: {
                        session: {
                            set: (
                                items: Record<string, unknown>,
                            ) => Promise<void>;
                        };
                    };
                };
            }
        ).chrome;
        await chromeApi.storage.session.set({ OS_SESSION: session });
    }, record);
}

test("downloads a local encrypted backup and records coverage", async ({
    context,
    extensionId,
}) => {
    const bootstrap = await context.newPage();
    await seedVault(bootstrap, extensionId);

    const vaultPage = await context.newPage();
    await unlockVault(vaultPage, extensionId);
    await openBackupCenter(vaultPage);

    const backupDialog = vaultPage.getByRole("dialog", {
        name: "Backup Center",
    });
    await expect(backupDialog.getByText("Never on this browser")).toBeVisible();
    await expect(
        backupDialog.getByText(
            "Sign in to Online Services by linking this vault, then reopen Backup Center to manage cloud restore points.",
        ),
    ).toBeVisible();

    const downloadPromise = vaultPage.waitForEvent("download");
    await backupDialog
        .getByRole("button", { name: "Download backup", exact: true })
        .click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^cryptexvault-bk-\d+\.cryx$/);

    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();
    const bytes = await fs.readFile(downloadPath!);
    expect(bytes.byteLength).toBeGreaterThan(64);

    await expect(
        vaultPage.getByText("Encrypted backup downloaded."),
    ).toBeVisible();
    await expect(backupDialog.getByText(/Last: just now/)).toBeVisible();
    await expect(
        backupDialog.getByText("Your backup coverage is current"),
    ).toBeVisible();
});

test("keeps Backup Center inside the popup viewport", async ({
    context,
    extensionId,
}) => {
    const bootstrap = await context.newPage();
    await seedVault(bootstrap, extensionId);

    const popupPage = await context.newPage();
    await popupPage.setViewportSize({
        width: POPUP_WIDTH,
        height: POPUP_HEIGHT,
    });
    await popupPage.goto(`chrome-extension://${extensionId}/popup.html`);
    await popupPage
        .getByRole("textbox", { name: "Password", exact: true })
        .fill(VAULT_PASSWORD);
    await popupPage
        .getByRole("button", { name: "Unlock", exact: true })
        .click();
    await expect(
        popupPage.getByRole("button", { name: "Vault actions" }),
    ).toBeVisible();

    await openBackupCenter(popupPage);
    const backupDialog = popupPage.getByRole("dialog", {
        name: "Backup Center",
    });
    const box = await backupDialog.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(POPUP_HEIGHT);
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(POPUP_WIDTH);
});

test("uploads, lists, downloads, and deletes managed restore points", async ({
    context,
    extensionId,
}) => {
    const backupApi = createManagedBackupApiMock();
    await backupApi.install(context);

    const bootstrap = await context.newPage();
    await seedVault(bootstrap, extensionId);

    const vaultPage = await context.newPage();
    await unlockVault(vaultPage, extensionId);
    await attachFakeOnlineServicesSession(vaultPage);
    await openBackupCenter(vaultPage);

    const backupDialog = vaultPage.getByRole("dialog", {
        name: "Backup Center",
    });
    await expect(
        backupDialog.getByText("Active", { exact: true }),
    ).toBeVisible();
    await expect(
        backupDialog.getByText("No restore points yet."),
    ).toBeVisible();

    await expect(
        backupDialog.getByText("No completed backup yet", { exact: true }),
    ).toBeVisible();
    await expect(
        backupDialog.getByText("Your backup coverage is current"),
    ).toHaveCount(0);

    await backupDialog.getByRole("button", { name: "Backup Now" }).click();
    await expect(
        vaultPage.getByText("Encrypted restore point uploaded."),
    ).toBeVisible();
    await expect(backupDialog.getByText("Root device")).toBeVisible();
    expect(backupApi.state.snapshots).toHaveLength(1);
    await expect(
        backupDialog.getByText("Your backup coverage is current"),
    ).toBeVisible();

    const cloudDownload = vaultPage.waitForEvent("download");
    await backupDialog
        .getByRole("button", { name: /Download restore point from/ })
        .click();
    const downloaded = await cloudDownload;
    expect(downloaded.suggestedFilename()).toMatch(
        /^cryptexvault-cloud-\d+\.cryx$/,
    );
    const downloadedPath = await downloaded.path();
    expect(downloadedPath).toBeTruthy();
    const downloadedBytes = await fs.readFile(downloadedPath!);
    expect(downloadedBytes.byteLength).toBe(
        backupApi.state.snapshots[0]?.byteLength,
    );

    await backupDialog
        .getByRole("button", { name: /Delete restore point from/ })
        .click();
    const deleteOne = vaultPage.getByRole("alertdialog", {
        name: "Delete restore point?",
    });
    await expect(deleteOne).toBeVisible();
    await deleteOne
        .getByRole("button", { name: "Delete", exact: true })
        .click();
    await expect(vaultPage.getByText("Restore point deleted.")).toBeVisible();
    await expect(
        backupDialog.getByText("No restore points yet."),
    ).toBeVisible();

    await backupDialog.getByRole("button", { name: "Backup Now" }).click();
    await expect(backupDialog.getByText("Root device")).toBeVisible();

    await backupDialog.getByRole("button", { name: "Delete All" }).click();
    const deleteAll = vaultPage.getByRole("alertdialog", {
        name: "Delete all restore points?",
    });
    await expect(deleteAll).toBeVisible();
    await deleteAll.getByRole("button", { name: "Delete all" }).click();
    await expect(
        vaultPage.getByText("All managed restore points deleted."),
    ).toBeVisible();
    await expect(
        backupDialog.getByText("Paused", { exact: true }),
    ).toBeVisible();
    expect(backupApi.state.snapshots).toHaveLength(0);
    expect(backupApi.state.enabled).toBe(false);
});
