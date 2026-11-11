/**
 * Links the phone with the web app in both directions, then syncs an edit each
 * way. Maestro drives the phone, with the native Files test on iOS; the web
 * side reuses the web suite's helpers.
 */
import { copyFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

import {
    addLinkingServers,
    createInvitation,
    signalingServer,
    turnServer,
} from "../../web/e2e/linking-servers";
import { createVault, finishVaultSetup } from "../../web/e2e/vault-helpers";
import {
    EXPORT_PREFIX,
    filesDirectory,
    flow,
    flowLog,
    run,
    savedFile,
    test as nativeTest,
} from "./ios-simulator.mjs";
import { isIosSimulator } from "./profile.mjs";

const serial = process.env.MAESTRO_DEVICE;
const downloads = "/sdcard/Download";
const adb = (...args: string[]) => run("adb", ["-s", serial, ...args]);
// Moves invitation files between the phone and this machine.
const phone = isIosSimulator(serial)
    ? {
          async pick(file: string) {
              copyFileSync(
                  file,
                  path.join(
                      filesDirectory(),
                      `${EXPORT_PREFIX}-invitation.cryxlink`,
                  ),
              );
              await nativeTest("testPickInvitation");
          },
          async share(file: string) {
              await nativeTest("testShareInvitation");
              copyFileSync(
                  savedFile(`${EXPORT_PREFIX}-shared-invitation`),
                  file,
              );
          },
      }
    : {
          // The capture app saves shares as e2e-invitation, so this name differs.
          async pick(file: string) {
              const name = "e2e-web-invitation.cryxlink";
              await adb("push", file, `${downloads}/${name}`);
              await adb(
                  "shell",
                  `am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file://${downloads}/${name}`,
              );
              await flow("sync-link-pick.yaml", {
                  env: { EXPORTED_FILE: name },
              });
          },
          async share(file: string) {
              await flow("sync-link-share.yaml");
              await adb("pull", `${downloads}/e2e-invitation.cryxlink`, file);
          },
      };

const webSecret = "e2e-web-vault-password-42!";
const login = "E2E Transfer Login";
const updatedLogin = "E2E Updated After Link";

async function addLogin(page: Page) {
    await page.getByRole("button", { name: "Add New" }).click();
    const drawer = page.getByRole("dialog", { name: "Add New Credential" });
    await drawer.getByLabel(/^Name/).fill(login);
    await drawer.getByLabel(/^Username \/ Email/).fill("transfer@example.test");
    await drawer.getByLabel(/^Password/).fill("transfer-password-42");
    await drawer.getByRole("button", { name: "Create Credential" }).click();
    await expect(page.getByText(login, { exact: true })).toBeVisible();
}

async function editLogin(page: Page, name: string) {
    // The open item's details repeat its name below the list.
    await page.getByText(name, { exact: true }).first().click();
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    return page.getByRole("dialog", { name: "Edit Credential" });
}

async function syncNow(page: Page, device: string) {
    await page.getByRole("button", { name: `Actions for ${device}` }).click();
    await page.getByRole("menuitem", { name: "Sync now" }).click();
}

async function expectReturnedEdit(page: Page) {
    const edit = await editLogin(page, updatedLogin);
    await expect(edit.getByLabel(/^Username \/ Email/)).toHaveValue(
        "returned@example.test",
        { timeout: 120_000 },
    );
    await expect(edit.getByPlaceholder("Enter password")).toHaveValue(
        "receiver-updated-password-43",
    );
    await page.keyboard.press("Escape");
}

test("the web app invites and the phone joins", async ({ page }, testInfo) => {
    await createVault(page, "Web Vault", webSecret);
    await addLogin(page);
    await addLinkingServers(page);
    const invitation = testInfo.outputPath("invite.cryxlink");
    const words = await createInvitation(page, invitation);

    await flow("sync-link-receiver-open.yaml");
    await phone.pick(invitation);
    await flow("sync-link-receiver-connect.yaml", {
        env: { TRANSFER_PHRASE: words },
    });
    const linked = page.getByRole("dialog", { name: "Device linked" });
    await expect(linked).toBeVisible();
    await page.keyboard.press("Escape");

    const edit = await editLogin(page, login);
    await edit.getByLabel(/^Name/).fill(updatedLogin);
    await edit.getByRole("button", { name: "Save Changes" }).click();
    await syncNow(page, "Second browser");
    await flow("sync-linked-verify.yaml");
    await flow("sync-linked-return-edit.yaml");
    await expectReturnedEdit(page);
});

test("the phone invites and the web app joins", async ({ page }, testInfo) => {
    await flow("sync-link-invitation.yaml", {
        env: {
            SIGNALING_HOST: signalingServer.host,
            SIGNALING_PORT: signalingServer.port,
            SIGNALING_APP_ID: signalingServer.appID,
            SIGNALING_KEY: signalingServer.key,
            SIGNALING_SECRET: signalingServer.secret,
            TURN_HOST: turnServer.host,
            TURN_USERNAME: turnServer.username,
            TURN_PASSWORD: turnServer.password,
        },
    });
    // The live transfer is already waiting; sharing must not stop it.
    const invitation = testInfo.outputPath("invite.cryxlink");
    await phone.share(invitation);
    const words = (await flowLog("sync-link-phrase.yaml")).match(
        /E2E_TRANSFER_PHRASE:([a-z]+(?: [a-z]+){11})\b/,
    )?.[1];
    expect(words, "the transfer phrase").toBeTruthy();
    await flow("sync-link-sender-start.yaml");

    await page.goto("/app");
    await page.getByRole("tab", { name: "Use invitation" }).click();
    await page
        .getByRole("tabpanel", { name: "Use invitation" })
        .getByRole("button", { name: "Use invitation" })
        .click();
    const receive = page.getByRole("dialog", { name: "Receive vault data" });
    await receive.getByRole("button", { name: /Import file/ }).click();
    await receive.locator("input[type=file]").setInputFiles(invitation);
    await receive.getByRole("button", { name: "Next" }).click();
    await receive
        .getByPlaceholder("Words shown on sending device")
        .fill(words!);
    await receive.getByRole("button", { name: "Receive vault data" }).click();
    await expect(page.getByText("Vault received")).toBeVisible({
        timeout: 60_000,
    });
    await page.getByPlaceholder("Enter your secret key").fill(webSecret);
    await page.getByRole("button", { name: "Save vault" }).click();
    const recovery = page.getByRole("dialog", {
        name: "Save these secrets now",
    });
    await recovery.getByLabel("I have written down the recovery code").check();
    await recovery.getByRole("button", { name: "Continue" }).click();
    await finishVaultSetup(page);
    await expect(page.getByText(login, { exact: true })).toBeVisible();

    await flow("sync-link-sender-complete.yaml");
    await flow("sync-linked-edit.yaml");
    await expect(page.getByText(updatedLogin, { exact: true })).toBeVisible({
        timeout: 120_000,
    });
    const edit = await editLogin(page, updatedLogin);
    await edit.getByLabel(/^Username \/ Email/).fill("returned@example.test");
    await edit
        .getByPlaceholder("Enter password")
        .fill("receiver-updated-password-43");
    await edit.getByRole("button", { name: "Save Changes" }).click();
    await syncNow(page, "Root Device");
    await flow("sync-linked-return-verify.yaml");
});
