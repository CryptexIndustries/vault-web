import { expect, test } from "@playwright/test";

const vaultName = "Playwright Vault";
const vaultSecret = "e2e-correct-horse-battery-staple-42!";
const credentialName = "Example account";
const editedCredentialName = "Example account (edited)";

test("loads validated runtime configuration under the document CSP", async ({
    page,
    request,
}) => {
    const configResponse = await request.get("/runtime-config.js");
    expect(configResponse.status()).toBe(200);
    expect(configResponse.headers()["cache-control"]).toBe(
        "no-store, max-age=0",
    );
    expect(configResponse.headers()["content-type"]).toBe(
        "application/javascript; charset=utf-8",
    );
    expect(configResponse.headers()["cross-origin-resource-policy"]).toBe(
        "same-origin",
    );

    const rejectedMutation = await request.post("/runtime-config.js");
    expect(rejectedMutation.status()).toBe(405);
    expect(rejectedMutation.headers().allow).toBe("GET, HEAD");

    const pageResponse = await page.goto("/app");
    expect(pageResponse?.headers()["content-security-policy"]).toContain(
        "default-src 'self'",
    );
    await expect(page.locator('script[src="/runtime-config.js"]')).toHaveCount(
        1,
    );

    const runtimeConfig = await page.evaluate(
        () =>
            (
                globalThis as typeof globalThis & {
                    __CRYPTEX_RUNTIME_CONFIG__?: {
                        NEXT_PUBLIC_APP_URL?: string;
                        NEXT_PUBLIC_CLOUD_ENABLED?: boolean;
                    };
                }
            ).__CRYPTEX_RUNTIME_CONFIG__,
    );
    expect(runtimeConfig).toMatchObject({
        NEXT_PUBLIC_CLOUD_ENABLED: false,
    });
    expect(runtimeConfig?.NEXT_PUBLIC_APP_URL).toMatch(/^https?:\/\//);
});

test("creates a vault and manages a credential through lock and unlock", async ({
    page,
}) => {
    await page.goto("/app");

    await expect(
        page.getByPlaceholder("Enter your new vault name"),
    ).toBeVisible();
    await page.getByPlaceholder("Enter your new vault name").fill(vaultName);
    await page
        .getByPlaceholder("Enter a description for your new vault")
        .fill("Created by the web Playwright suite");
    await page.getByPlaceholder("Enter your secret key").fill(vaultSecret);
    await page.getByRole("button", { name: "Create Vault" }).click();

    const recoveryDialog = page.getByRole("dialog", {
        name: "Save these secrets now",
    });
    await expect(recoveryDialog).toBeVisible();
    await recoveryDialog
        .getByLabel("I have written down the recovery code")
        .check();
    await recoveryDialog.getByRole("button", { name: "Continue" }).click();

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
    await addNewButton.click();

    const createDrawer = page.getByRole("dialog", {
        name: "Add New Credential",
    });
    await createDrawer.getByLabel(/^Name/).fill(credentialName);
    await createDrawer.getByLabel(/^Username \/ Email/).fill("e2e@example.com");
    await createDrawer.getByLabel(/^Password/).fill("credential-secret-42!");
    await createDrawer
        .getByLabel("Primary website")
        .fill("https://example.com/login");
    await createDrawer
        .getByLabel("Notes")
        .fill("Initial Playwright credential");
    await createDrawer.getByRole("switch", { name: "Enable TOTP" }).click();
    await expect(createDrawer.getByLabel("TOTP Label")).toHaveCount(0);
    await expect(
        createDrawer.getByRole("button", { name: "Scan QR code" }),
    ).toBeVisible();
    await createDrawer.getByLabel("TOTP Secret").fill("JBSWY3DPEHPK3PXP");
    await createDrawer
        .getByRole("button", { name: "Create Credential" })
        .click();

    await expect(page.getByText(credentialName, { exact: true })).toBeVisible();

    const search = page.getByRole("combobox", { name: "Search credentials" });
    await search.fill("missing-account");
    await expect(page.getByText("No credentials found")).toBeVisible();
    await search.fill("name:Example");
    await expect(page.getByText(credentialName, { exact: true })).toBeVisible();
    await search.clear();

    await page.getByText(credentialName, { exact: true }).click();
    await expect(
        page.getByText("Two-Factor Code", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Edit", exact: true }).click();

    const editDrawer = page.getByRole("dialog", { name: "Edit Credential" });
    await editDrawer.getByLabel(/^Name/).fill(editedCredentialName);
    await editDrawer
        .getByLabel("Notes")
        .fill("Updated by the complete browser journey");
    await editDrawer.getByRole("button", { name: "Save Changes" }).click();
    const editedCredentialActions = page.getByRole("button", {
        name: `Actions for ${editedCredentialName}`,
        exact: true,
    });
    await expect(editedCredentialActions).toBeVisible();

    await page.getByRole("button", { name: "Lock Vault", exact: true }).click();
    const lockDialog = page.getByRole("dialog", { name: "Warning" });
    await lockDialog
        .getByRole("button", { name: /Lock Vault \(\d+s\)/ })
        .click();

    await expect(
        page.getByRole("button", { name: "Unlock Vault" }),
    ).toBeVisible();
    await page.getByPlaceholder("Enter your secret key").fill(vaultSecret);
    await page.getByRole("button", { name: "Unlock Vault" }).click();
    await expect(editedCredentialActions).toBeVisible();

    await editedCredentialActions.click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    const deleteDialog = page.getByRole("dialog", { name: "Warning" });
    await deleteDialog
        .getByRole("button", { name: "Remove credential" })
        .click();

    await expect(
        page.getByText("There are no credentials in this directory."),
    ).toBeVisible();

    // Local device management stays available without an Online Services account.
    await page.getByRole("button", { name: "Manage", exact: true }).click();
    const account = page.getByRole("dialog", { name: "Account", exact: true });
    await expect(
        account.getByRole("tab", { name: "Devices", exact: true }),
    ).toHaveAttribute("data-state", "active");
    await expect(
        account.getByText("You can still manage this vault's sync links.", {
            exact: false,
        }),
    ).toBeVisible();
    await expect(
        account.getByRole("button", { name: "Allow root access", exact: true }),
    ).toHaveCount(0);
    await expect(
        account.getByRole("button", { name: "View device list" }),
    ).toBeVisible();
    await expect(account.locator("svg.device-network")).toBeVisible();
    const mapBounds = await account.locator("svg.device-network").boundingBox();
    expect(mapBounds!.height).toBeGreaterThan(100);
    const nestedScroll = await account
        .locator("svg.device-network")
        .evaluate((svg) => {
            let parent = svg.parentElement;
            while (parent && parent.getAttribute("role") !== "dialog") {
                if (
                    ["auto", "scroll"].includes(
                        getComputedStyle(parent).overflowY,
                    ) &&
                    parent.scrollHeight > parent.clientHeight + 1
                )
                    return true;
                parent = parent.parentElement;
            }
            return false;
        });
    expect(nestedScroll).toBe(false);

    await account.getByRole("button", { name: "View device list" }).click();
    await expect(
        account.getByRole("button", { name: "Next devices" }),
    ).toBeVisible();
    await account.getByRole("button", { name: "View connection map" }).click();
    await expect(account.locator("svg.device-network")).toBeVisible();
    await account.getByRole("button", { name: "Expand map" }).click();
    await expect(
        account.getByRole("button", { name: "Collapse", exact: true }),
    ).toBeVisible();
    await account
        .getByRole("button", { name: "Collapse", exact: true })
        .click();
    await account
        .getByRole("button", { name: "Link device", exact: true })
        .click();
    const choice = page.getByRole("dialog", {
        name: "Link a device",
        exact: true,
    });
    await expect(
        choice.getByText(
            "Name the device, choose a transfer method, then start linking.",
        ),
    ).toBeVisible();
    await choice.getByRole("button", { name: /^Create invitation/ }).click();
    await expect(
        page.getByRole("dialog", { name: "Link new device", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await account
        .getByRole("button", { name: "Link device", exact: true })
        .click();
    await choice.getByRole("button", { name: /^Receive invitation/ }).click();
    await expect(
        page.getByRole("dialog", { name: "Receive vault data", exact: true }),
    ).toBeVisible();
});

test("rotates the web vault DEK only when explicitly selected", async ({
    page,
}) => {
    const originalPassword = "e2e-original-vault-password-42!";
    const rotatedPassword = "e2e-rotated-vault-password-84!";
    await page.goto("/app");

    await page
        .getByPlaceholder("Enter your new vault name")
        .fill("Rotation test vault");
    await page.getByPlaceholder("Enter your secret key").fill(originalPassword);
    await page.getByRole("button", { name: "Create Vault" }).click();

    const initialReveal = page.getByRole("dialog", {
        name: "Save these secrets now",
    });
    await initialReveal
        .getByLabel("I have written down the recovery code")
        .check();
    await initialReveal.getByRole("button", { name: "Continue" }).click();

    const migrationDialog = page.getByRole("dialog", {
        name: "Action required",
    });
    const settingsButton = page.getByRole("button", {
        name: "Vault Settings",
        exact: true,
    });
    await expect(migrationDialog.or(settingsButton)).toBeVisible();
    if (await migrationDialog.isVisible()) {
        await migrationDialog.getByLabel("I understand these steps").check();
        await migrationDialog.getByRole("button", { name: "Continue" }).click();
    }

    await settingsButton.click();
    const settings = page.getByRole("dialog", {
        name: "Vault Settings",
        exact: true,
    });
    await settings
        .getByRole("button", { name: "Manage Encryption & Security" })
        .click();

    const security = page.getByRole("dialog", {
        name: "Encryption & Security",
    });
    const rotateDataKey = security
        .getByLabel("Rotate this device's vault encryption key")
        .first();
    const deleteHistory = security
        .getByLabel("Delete older managed backups after replacement")
        .first();
    await expect(rotateDataKey).not.toBeChecked();
    await expect(deleteHistory).not.toBeChecked();

    await security.getByLabel("Current master password").fill(originalPassword);
    await security.getByLabel("New master password").fill(rotatedPassword);
    await security.getByLabel("Confirm new password").fill(rotatedPassword);
    await rotateDataKey.check();
    await security
        .getByRole("button", { name: "Save protection settings" })
        .click();

    await expect(
        page.getByText("Security settings and vault encryption key updated."),
    ).toBeVisible();
    await expect(
        security.getByText("New recovery code", { exact: true }),
    ).toBeVisible();
    const securityCloseButtons = security.getByRole("button", {
        name: "Close",
        exact: true,
    });
    const securityFooterClose = securityCloseButtons.first();
    await expect(securityFooterClose).toBeDisabled();
    await securityCloseButtons.last().click();
    await expect(security).toBeVisible();
    await security.getByLabel(/I saved the newly generated secrets/).check();
    await securityFooterClose.click();
    await settings
        .getByRole("button", { name: "Close", exact: true })
        .first()
        .click();

    await page.getByRole("button", { name: "Lock Vault", exact: true }).click();
    const lockDialog = page.getByRole("dialog", { name: "Warning" });
    await lockDialog
        .getByRole("button", { name: /Lock Vault \(\d+s\)/ })
        .click();

    await page.getByPlaceholder("Enter your secret key").fill(originalPassword);
    await page.getByRole("button", { name: "Unlock Vault" }).click();
    await expect(page.getByText("Failed to decrypt vault")).toBeVisible();

    await page.getByPlaceholder("Enter your secret key").fill(rotatedPassword);
    await page.getByRole("button", { name: "Unlock Vault" }).click();
    await expect(settingsButton).toBeVisible();
});
