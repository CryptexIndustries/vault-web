/**
 * Links a second browser that has no vault yet through the "Use invitation"
 * tab, over the self-hosted signaling and TURN servers from compose.e2e.yaml,
 * so neither browser needs an Online Services account.
 */
import { expect, test } from "@playwright/test";

import {
    addLinkingServers,
    createInvitation,
    openServerSettings,
} from "../linking-servers";
import { createVault, finishVaultSetup } from "../vault-helpers";

const credentialName = "Linked example login";

test("a browser with no vault receives one through Use invitation", async ({
    page,
    browser,
}, testInfo) => {
    await createVault(page, "Sender vault", "e2e-sender-vault-password-42!");
    await page.getByRole("button", { name: "Add New" }).click();
    const drawer = page.getByRole("dialog", { name: "Add New Credential" });
    await drawer.getByLabel(/^Name/).fill(credentialName);
    await drawer.getByLabel(/^Username \/ Email/).fill("linked@example.com");
    await drawer.getByLabel(/^Password/).fill("linked-secret-42!");
    await drawer.getByRole("button", { name: "Create Credential" }).click();
    await expect(page.getByText(credentialName, { exact: true })).toBeVisible();

    await addLinkingServers(page);
    const words = await createInvitation(
        page,
        testInfo.outputPath("invite.cryxlink"),
    );

    const receiverContext = await browser.newContext();
    const receiver = await receiverContext.newPage();
    await receiver.goto("/app");
    await expect(
        receiver.getByText("Already use Cryptex Vault on another device?"),
    ).toBeVisible();
    await receiver.getByRole("tab", { name: "Use invitation" }).click();
    await receiver
        .getByRole("tabpanel", { name: "Use invitation" })
        .getByRole("button", { name: "Use invitation" })
        .click();

    const receive = receiver.getByRole("dialog", {
        name: "Receive vault data",
    });
    await receive.getByRole("button", { name: /Import file/ }).click();
    await receive
        .locator("input[type=file]")
        .setInputFiles(testInfo.outputPath("invite.cryxlink"));
    await receive.getByRole("button", { name: "Next" }).click();
    await receive.getByPlaceholder("Words shown on sending device").fill(words);
    await receive.getByRole("button", { name: "Receive vault data" }).click();

    await expect(receiver.getByText("Vault received")).toBeVisible({
        timeout: 60_000,
    });
    await expect(
        page.getByRole("dialog", { name: "Device linked" }),
    ).toBeVisible();

    // The received vault exists only in this tab until it's saved.
    await receiver.getByRole("tab", { name: "Create" }).click();
    const leave = receiver.getByRole("alertdialog", {
        name: "Leave without saving this vault?",
    });
    await leave.getByRole("button", { name: "Stay" }).click();
    await expect(receiver.getByText("Vault received")).toBeVisible();

    await expect(
        receiver.getByPlaceholder("Enter your new vault name"),
    ).toHaveValue("Linked vault");
    await receiver
        .getByPlaceholder("Enter your secret key")
        .fill("e2e-receiver-vault-password-42!");
    await receiver.getByRole("button", { name: "Save vault" }).click();
    const recovery = receiver.getByRole("dialog", {
        name: "Save these secrets now",
    });
    await recovery.getByLabel("I have written down the recovery code").check();
    await recovery.getByRole("button", { name: "Continue" }).click();
    await finishVaultSetup(receiver);

    await expect(
        receiver.getByText(credentialName, { exact: true }),
    ).toBeVisible();
    await receiverContext.close();

    // The sender's new device uses the signaling server, so deleting it warns.
    const linked = page.getByRole("dialog", { name: "Device linked" });
    await page.keyboard.press("Escape");
    await expect(linked).toBeHidden();
    const settings = await openServerSettings(page);
    await settings.getByRole("tab", { name: "Signaling" }).click();
    await settings
        .getByRole("button", { name: "Delete E2E signaling" })
        .click();
    await expect(settings).toContainText(
        "Used by Second browser. It may stop syncing until you choose another server for it.",
    );
    await settings.getByRole("button", { name: "Keep server" }).click();
    await expect(
        settings.getByRole("button", { name: "Delete E2E signaling" }),
    ).toBeVisible();
});
