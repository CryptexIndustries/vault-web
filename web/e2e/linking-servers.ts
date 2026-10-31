/**
 * The signaling and TURN servers from compose.e2e.yaml: Compose service names
 * in the Compose run, loopback on the host (see global-setup.ts).
 */
import { expect, type Locator, type Page } from "@playwright/test";

const env = process.env;

export const signalingServer = {
    host: env.E2E_SIGNALING_HOST ?? "signaling",
    port: env.E2E_SIGNALING_PORT ?? "6001",
    appID: "e2e-app",
    key: "e2e-key",
    secret: "e2e-secret",
};

export const turnServer = {
    host: `${env.E2E_TURN_HOST ?? "turn"}:${env.E2E_TURN_PORT ?? "3478"}`,
    username: "e2e",
    password: "e2e-turn-password",
};

/** Opens the vault's server settings and returns the dialog. */
export async function openServerSettings(page: Page) {
    await page
        .getByRole("button", { name: "Configure vault signaling" })
        .click();
    // Its name follows the view, so the test ID finds it.
    return page.getByTestId("vault-servers-dialog");
}

/** Fills the TURN server form with the e2e server. */
export async function fillTurnServer(form: Locator, name: string) {
    await form.getByLabel("Name *", { exact: true }).fill(name);
    await form.getByLabel("Host or TURN URL *").fill(turnServer.host);
    await form
        .getByLabel("Username", { exact: true })
        .fill(turnServer.username);
    await form
        .getByLabel("Password", { exact: true })
        .fill(turnServer.password);
}

/** Fills the signaling server form with the e2e server. */
export async function fillSignalingServer(form: Locator, name: string) {
    await form.getByLabel("Name *", { exact: true }).fill(name);
    await form.getByLabel("Host *", { exact: true }).fill(signalingServer.host);
    await form
        .getByLabel("App ID *", { exact: true })
        .fill(signalingServer.appID);
    await form.getByLabel("Key *", { exact: true }).fill(signalingServer.key);
    await form
        .getByLabel("Secret *", { exact: true })
        .fill(signalingServer.secret);
    await form
        .getByLabel("WS port", { exact: true })
        .fill(signalingServer.port);
}

/** Adds the e2e TURN and signaling servers to the vault. */
export async function addLinkingServers(page: Page) {
    await openServerSettings(page);
    const config = page.getByRole("dialog", { name: "Vault signaling" });

    await config.getByRole("tab", { name: "TURN" }).click();
    await config.getByRole("button", { name: "Add TURN server" }).click();
    const turn = page.getByRole("dialog", { name: "Add TURN server" });
    await fillTurnServer(turn, "E2E TURN");
    await turn.getByRole("button", { name: "Save server" }).click();
    await expect(turn).toBeHidden();

    await config.getByRole("tab", { name: "Signaling" }).click();
    await config.getByRole("button", { name: "Add signaling server" }).click();
    const signaling = page.getByRole("dialog", {
        name: "Add signaling server",
    });
    await fillSignalingServer(signaling, "E2E signaling");
    await signaling.getByRole("button", { name: "Save server" }).click();
    await expect(signaling).toBeHidden();

    await page.keyboard.press("Escape");
    await expect(config).toBeHidden();
}

/** Starts a file invitation, saves it to invitationPath and returns the verification words. */
export async function createInvitation(page: Page, invitationPath: string) {
    await page.getByRole("button", { name: "Link new device" }).click();
    await page.getByRole("menuitem", { name: /Create invitation/ }).click();
    const send = page.getByRole("dialog", { name: "Link new device" });
    await send.getByLabel("Device name").fill("Second browser");
    await send.getByRole("button", { name: /^File/ }).click();

    await send.getByRole("button", { name: "Advanced connection" }).click();
    await send.getByRole("combobox").click();
    await page.getByRole("option", { name: "E2E signaling" }).click();
    // STUN comes first, then TURN.
    await send.getByRole("button", { name: "Select servers" }).last().click();
    await page.getByRole("menuitemcheckbox", { name: "E2E TURN" }).click();
    await page.keyboard.press("Escape");

    const download = page.waitForEvent("download");
    await send.getByRole("button", { name: "Start linking" }).click();
    await (await download).saveAs(invitationPath);

    await send.getByRole("button", { name: "Verification words" }).click();
    const words = send.locator(".select-all");
    await expect(words).toHaveText(/\w+( \w+)+/);
    return (await words.innerText()).trim();
}
