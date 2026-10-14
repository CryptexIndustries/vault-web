import { expect, test } from "../fixtures";

const VAULT_PASSWORD = "e2e-vault-password";

test("keeps 1000 shared links searchable, filterable and virtualized", async ({
    context,
    extensionId,
}) => {
    const bootstrap = await context.newPage();
    await bootstrap.goto(
        `chrome-extension://${extensionId}/e2e-bootstrap.html?shareLinks=1000`,
    );
    await bootstrap
        .getByRole("button", { name: "Reset and seed vault" })
        .click();
    await expect(bootstrap.getByRole("status")).toContainText("Seeded vault");

    const popup = await context.newPage();
    await popup.setViewportSize({ width: 720, height: 436 });
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup
        .getByRole("textbox", { name: "Password", exact: true })
        .fill(VAULT_PASSWORD);
    await popup.getByRole("button", { name: "Unlock", exact: true }).click();
    await popup.getByRole("button", { name: "Vault actions" }).click();
    await popup.getByRole("menuitem", { name: /Shared links/ }).click();

    const rows = popup.locator('[aria-label^="Shared link "]');
    const search = popup.getByRole("searchbox", {
        name: "Search shared links",
    });
    const filterButton = popup.getByRole("button", {
        name: /^Filter by status/,
    });
    const statusItem = (label: string) =>
        popup.getByRole("menuitemcheckbox", { name: new RegExp(`^${label}`) });
    await expect(rows.first()).toBeVisible();

    // 200 of the 1000 ended 120 days ago and are pruned on load.
    await filterButton.click();
    await expect(statusItem("Active")).toContainText("200");
    await expect(statusItem("Opened")).toContainText("200");
    await expect(statusItem("Expired")).toContainText("200");
    await expect(statusItem("Revoked")).toContainText("200");
    await expect(statusItem("Destroyed")).toContainText("0");
    await popup.keyboard.press("Escape");

    const rendered = await rows.count();
    expect(rendered).toBeGreaterThan(0);
    expect(rendered).toBeLessThan(60);

    // Scrolling the list never moves the controls.
    await popup
        .getByTestId("virtuoso-scroller")
        .evaluate((element) => element.scrollTo({ top: element.scrollHeight }));
    await expect(
        popup.locator('[aria-label="Shared link 998, Expired"]'),
    ).toBeVisible();
    await expect(search).toBeInViewport();
    await expect(filterButton).toBeInViewport();
    expect(await rows.count()).toBeLessThan(60);

    await search.fill("shared link 421");
    await expect(rows).toHaveCount(1);
    await expect(
        popup.locator('[aria-label="Shared link 421, Opened"]'),
    ).toBeVisible();
    await search.fill("");

    // Several statuses at once; the menu stays open while ticking.
    await filterButton.click();
    await statusItem("Expired").click();
    await statusItem("Revoked").click();
    await popup.keyboard.press("Escape");
    await expect(
        popup.getByRole("button", {
            name: "Filter by status, 2 selected",
        }),
    ).toBeVisible();
    await expect(
        popup.locator('[aria-label$=", Active"], [aria-label$=", Opened"]'),
    ).toHaveCount(0);
    await expect(
        popup.locator('[aria-label$=", Expired"]').first(),
    ).toBeVisible();

    await filterButton.click();
    await popup.getByRole("menuitem", { name: "Show all" }).click();
    await filterButton.click();
    await statusItem("Active").click();
    await popup.keyboard.press("Escape");

    await popup.getByRole("button", { name: /^Sort: / }).click();
    await popup
        .getByRole("menuitemradio", { name: "Expiring soonest" })
        .click();
    await expect(rows.first()).toHaveAttribute(
        "aria-label",
        "Shared link 995, Active",
    );
    await popup.getByRole("button", { name: /^Sort: / }).click();
    await popup.getByRole("menuitemradio", { name: "Name A–Z" }).click();
    await expect(rows.first()).toHaveAttribute(
        "aria-label",
        "Shared link 0, Active",
    );

    // Revoking goes through the extension's own warning dialog.
    await popup
        .getByRole("button", { name: "Actions for Shared link 0" })
        .click();
    await popup.getByRole("menuitem", { name: "Revoke link" }).click();
    const warning = popup.getByRole("dialog", { name: "Warning" });
    await expect(warning).toContainText(
        'Revoke the link for "Shared link 0"? It stops working right away.',
    );
    await warning.getByRole("button", { name: "Cancel" }).click();
    await expect(warning).toBeHidden();
    await expect(
        popup.locator('[aria-label="Shared link 0, Active"]'),
    ).toBeVisible();
});
