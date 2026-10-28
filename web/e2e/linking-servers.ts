/**
 * The signaling and TURN servers from compose.e2e.yaml: Compose service names
 * in the Compose run, loopback on the host (see global-setup.ts).
 */
import type { Locator, Page } from "@playwright/test";

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
