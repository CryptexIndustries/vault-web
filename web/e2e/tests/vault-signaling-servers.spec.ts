/**
 * The vault's STUN, TURN and signaling server settings: the list, the form
 * that replaces it, validation, unsaved changes and connection tests against
 * the servers from compose.e2e.yaml.
 */
import { expect, test, type Locator, type Page } from "@playwright/test";

import {
    fillSignalingServer,
    fillTurnServer,
    openServerSettings,
    turnServer,
} from "../linking-servers";
import { createVault } from "../vault-helpers";

const vaultSecret = "e2e-server-settings-password-42!";

test.beforeEach(async ({ page }) => {
    await createVault(page, "Server settings vault", vaultSecret);
});

/** Field errors shown under the form's fields. */
const fieldErrors = (dialog: Locator) =>
    dialog.locator("p.text-xs.text-destructive");

async function addSTUNServer(dialog: Locator, name: string, host: string) {
    await dialog.getByRole("button", { name: "Add STUN server" }).click();
    await dialog.getByLabel("Name *").fill(name);
    await dialog.getByLabel("Host *").fill(host);
    await dialog.getByRole("button", { name: "Save server" }).click();
    await expect(
        dialog.getByRole("button", { name: `Delete ${name}` }),
    ).toBeVisible();
}

async function lockReloadAndUnlock(page: Page) {
    await page.getByRole("button", { name: "Lock Vault", exact: true }).click();
    await page
        .getByRole("dialog", { name: "Warning" })
        .getByRole("button", { name: /Lock Vault \(\d+s\)/u })
        .click();
    await expect(
        page.getByRole("button", { name: "Unlock Vault" }),
    ).toBeVisible();
    await page.reload();
    await page.getByPlaceholder("Enter your secret key").fill(vaultSecret);
    await page.getByRole("button", { name: "Unlock Vault" }).click();
    await expect(page.getByRole("button", { name: "Add New" })).toBeVisible();
}

test("adds, edits and deletes a server, and keeps it through a reload", async ({
    page,
}) => {
    const dialog = await openServerSettings(page);
    await expect(dialog).toContainText(
        "No custom STUN servers. The vault uses Online Services.",
    );

    await dialog.getByRole("button", { name: "Add STUN server" }).click();
    await expect(dialog.getByLabel("Name *")).toBeFocused();
    await expect(dialog.getByLabel("Name *")).toHaveAttribute(
        "placeholder",
        "e.g. Home STUN",
    );
    await dialog.getByLabel("Name *").fill("  Office STUN ");
    await dialog.getByLabel("Host *").fill("stun.example.com:3478");
    await dialog.getByRole("button", { name: "Save server" }).click();
    await expect(page.getByText("STUN server saved.")).toBeVisible();
    const row = dialog.getByRole("button", { name: /^Office STUN/ });
    await expect(row).toContainText("stun.example.com:3478");
    await expect(row).toBeFocused();

    // Saving waits for a change.
    await row.click();
    await expect(dialog.getByLabel("Name *")).toHaveValue("Office STUN");
    const save = dialog.getByRole("button", { name: "Save server" });
    await expect(save).toBeDisabled();
    await dialog.getByLabel("Name *").fill("Lab STUN");
    await expect(save).toBeEnabled();
    await save.click();
    await expect(
        dialog.getByRole("button", { name: /^Lab STUN/ }),
    ).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await lockReloadAndUnlock(page);
    await openServerSettings(page);
    await expect(
        dialog.getByRole("button", { name: /^Lab STUN/ }),
    ).toContainText("stun.example.com:3478");

    await dialog.getByRole("button", { name: "Delete Lab STUN" }).click();
    await expect(dialog).toContainText("Remove Lab STUN from the vault.");
    // No device uses it, so there's nothing to warn about.
    await expect(dialog).not.toContainText("Used by");
    await expect(
        dialog.getByRole("button", { name: "Keep server" }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(
        dialog.getByRole("button", { name: "Delete Lab STUN" }),
    ).toBeFocused();
    await dialog.getByRole("button", { name: "Delete Lab STUN" }).click();
    await dialog.getByRole("button", { name: "Delete server" }).click();
    await expect(page.getByText("STUN server deleted.")).toBeVisible();
    await expect(dialog).toContainText("No custom STUN servers.");
    await expect(
        dialog.getByRole("button", { name: "Add STUN server" }),
    ).toBeFocused();
});

test("shows each field's problem under that field", async ({ page }) => {
    const dialog = await openServerSettings(page);
    await addSTUNServer(dialog, "Office", "stun.example.com");

    await dialog.getByRole("button", { name: "Add STUN server" }).click();
    await dialog.getByRole("button", { name: "Save server" }).click();
    await expect(fieldErrors(dialog)).toHaveText([
        "Enter a name.",
        "Enter a host.",
    ]);
    await expect(dialog.getByLabel("Name *")).toBeFocused();
    await expect(dialog.getByLabel("Name *")).toHaveAttribute(
        "aria-invalid",
        "true",
    );
    await dialog.getByLabel("Name *").fill(" office ");
    await dialog.getByLabel("Host *").fill("turn:stun.example.com");
    await expect(fieldErrors(dialog)).toHaveText([
        "A STUN server named office already exists.",
        "Start with stun: or stuns:, or enter just the host.",
    ]);
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await dialog.getByRole("button", { name: "Discard changes" }).click();

    await dialog.getByRole("tab", { name: "TURN" }).click();
    await dialog.getByRole("button", { name: "Add TURN server" }).click();
    await dialog.getByLabel("Name *").fill("Relay");
    await dialog.getByLabel("Host or TURN URL *").fill("turn.example.com");
    await dialog.getByLabel("Username", { exact: true }).fill("alice");
    await dialog.getByRole("button", { name: "Save server" }).click();
    await expect(fieldErrors(dialog)).toHaveText([
        "Enter the password for this username.",
    ]);
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await dialog.getByRole("button", { name: "Discard changes" }).click();

    await dialog.getByRole("tab", { name: "Signaling" }).click();
    await dialog.getByRole("button", { name: "Add signaling server" }).click();
    await dialog.getByLabel("Host *").fill("https://signal.example.com");
    await dialog.getByLabel("WS port").fill("70000");
    await dialog.getByLabel("WSS port").fill("abc");
    await dialog.getByRole("button", { name: "Save server" }).click();
    await expect(fieldErrors(dialog)).toHaveText([
        "Enter a name.",
        "Enter just the host name, without a scheme, port or path.",
        "Enter the app ID.",
        "Enter the key.",
        "Enter the secret.",
        "Enter a port from 1 to 65535.",
        "Enter a port from 1 to 65535, or 0 to turn WSS off.",
    ]);

    // An empty WSS port is saved as 0, which turns WSS off.
    await fillSignalingServer(dialog, "Home signaling");
    await dialog.getByLabel("Host *").fill("[fd00::1]");
    await dialog.getByLabel("WSS port").fill("");
    await dialog.getByRole("button", { name: "Save server" }).click();
    await dialog.getByRole("button", { name: /^Home signaling/ }).click();
    await expect(dialog.getByLabel("Host *")).toHaveValue("[fd00::1]");
    await expect(dialog.getByLabel("WSS port")).toHaveValue("0");
    await expect(dialog.getByLabel("Secret *")).toHaveAttribute(
        "autocomplete",
        "new-password",
    );

    // Without a WS port, WSS has to be on.
    await dialog.getByLabel("WS port").fill("");
    await dialog.getByRole("button", { name: "Save server" }).click();
    await expect(fieldErrors(dialog)).toHaveText([
        "Enter a WS port, or a WSS port below.",
    ]);
    await dialog.getByLabel("WSS port").fill("443");
    await dialog.getByRole("button", { name: "Save server" }).click();
    await expect(
        dialog.getByRole("button", { name: "Add signaling server" }),
    ).toBeVisible();
});

test("asks before dropping unsaved changes", async ({ page }) => {
    const dialog = await openServerSettings(page);
    await dialog.getByRole("button", { name: "Add STUN server" }).click();
    await dialog.getByLabel("Name *").fill("Half typed");

    const discard = page.getByRole("dialog", { name: "Discard changes?" });
    // Escape, a click outside and the close button all ask first.
    await page.keyboard.press("Escape");
    await expect(discard).toBeVisible();
    await discard.getByRole("button", { name: "Keep editing" }).click();
    await expect(dialog.getByLabel("Name *")).toHaveValue("Half typed");

    await page.mouse.click(5, 5);
    await expect(discard).toBeVisible();
    // Asking again while the question shows goes back to the form.
    await page.keyboard.press("Escape");
    await expect(dialog.getByLabel("Name *")).toHaveValue("Half typed");

    await dialog.getByRole("button", { name: "Close" }).click();
    await discard.getByRole("button", { name: "Discard changes" }).click();
    await expect(dialog).toBeHidden();

    // Without changes, Escape leaves the form and then the dialog.
    await openServerSettings(page);
    await dialog.getByRole("button", { name: "Add STUN server" }).click();
    await page.keyboard.press("Escape");
    await expect(
        page.getByRole("dialog", { name: "Vault signaling" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
});

test("searches the list once it has six servers", async ({ page }) => {
    const dialog = await openServerSettings(page);
    const search = dialog.getByLabel("Search STUN servers");
    for (let index = 1; index <= 5; index++)
        await addSTUNServer(dialog, `STUN ${index}`, `s${index}.example.com`);
    await expect(search).toHaveCount(0);

    await addSTUNServer(dialog, "Backup STUN", "backup.example.com");
    // A list of 5.5 rows, so the new last row is scrolled into view.
    await expect(
        dialog.getByRole("button", { name: /^Backup STUN/ }),
    ).toBeFocused();
    await search.fill("s3.example");
    await expect(dialog.getByRole("button", { name: /^STUN \d/ })).toHaveText([
        "STUN 3s3.example.com",
    ]);
    await search.fill("nothing like it");
    await expect(dialog).toContainText("No servers match.");
});

test("tests connections to the e2e servers", async ({ page }) => {
    const dialog = await openServerSettings(page);
    const testButton = dialog.getByRole("button", { name: "Test connection" });
    const result = dialog.getByRole("status");

    await dialog.getByRole("tab", { name: "TURN" }).click();
    await dialog.getByRole("button", { name: "Add TURN server" }).click();
    await expect(testButton).toBeDisabled();
    await fillTurnServer(dialog, "E2E TURN");
    await testButton.click();
    await expect(result).toHaveText("TURN relay allocation succeeded.");
    // A change clears the result, which belonged to the old values.
    await dialog
        .getByLabel("Password", { exact: true })
        .fill(`${turnServer.password}-wrong`);
    await expect(result).toHaveCount(0);
    await testButton.click();
    await expect(result).toHaveText(
        "No response from this server. Check its address, credentials, and your connection.",
        { timeout: 20_000 },
    );
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await dialog.getByRole("button", { name: "Discard changes" }).click();

    await dialog.getByRole("tab", { name: "Signaling" }).click();
    await dialog.getByRole("button", { name: "Add signaling server" }).click();
    await fillSignalingServer(dialog, "E2E signaling");
    await testButton.click();
    await expect(result).toHaveText(
        "Signaling server reachable and presence auth succeeded.",
    );
    await dialog.getByLabel("Secret *").fill("wrong-secret");
    await testButton.click();
    await expect(result).toHaveText(
        "Could not connect or authorize presence channel. Check host, ports, key, and secret.",
        { timeout: 20_000 },
    );
});
