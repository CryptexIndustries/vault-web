import { expect, type Page, type Route, test } from "@playwright/test";

// Sealed once with vault-core's sealSharePayload. The spec answers the share
// API itself, so it needs no share server and can hold a reveal open.
const shareId = "leaveGuardE2eShare";
const shareLink = `/s/${shareId}#Mnuduikhzi0ZL5FB4M4AmSQZo6MuG234bWjKfqLiYMk`;
const ciphertext =
    "AQDjwrfzRz4MyZzpJcNXm-BPwcs6LqwcDXT_re2WePPTmufCUEbBXEsiuRsIXrMUO9GUwgyeuYnGo4XMoL8vUMbGwN5Q4R1PK3Pl3p8Ka8QXxHlBDfjtANpxA_DhAyzMwmCMeOf-6hfFAQmHwRwx8myTgDu3uBDlg_PwAOtlM_MXDQ_QKwvh6Frh_c4TlPRWXi4ODRI9kg";

/** Opens the link, starts a reveal and returns a function that answers it. */
async function openAndReveal(
    page: Page,
    open: () => Promise<unknown> = () => page.goto(shareLink),
) {
    const held: Route[] = [];
    // The page decides whether to edit history in the same task that reads the
    // reveal body, so a timeout set after that read runs after the decision.
    await page.addInitScript(() => {
        const fetch = window.fetch;
        window.fetch = async (...args) => {
            const response = await fetch(...args);
            if (!response.url.endsWith("/reveal")) return response;
            const json = response.json.bind(response);
            response.json = async () => {
                const body: unknown = await json();
                setTimeout(() => {
                    document.documentElement.dataset.revealHandled = "";
                });
                return body;
            };
            return response;
        };
    });
    await page.route(`**/share-api/v1/shares/${shareId}/peek`, (route) =>
        route.fulfill({
            json: { passphrase: false, expiresAt: Date.now() + 86_400_000 },
        }),
    );
    await page.route(`**/share-api/v1/shares/${shareId}/reveal`, (route) => {
        held.push(route);
    });
    await open();
    await page.getByRole("button", { name: "Reveal secret" }).click();
    await expect.poll(() => held.length).toBe(1);
    return async () => {
        await held[0]!.fulfill({ json: { ciphertext } });
        await page.waitForFunction(
            () => "revealHandled" in document.documentElement.dataset,
        );
    };
}

// A late reply must not clear Next.js's history state on the page the
// recipient moved to.
const historyEntry = (page: Page) =>
    page.evaluate(() => ({
        url: location.pathname + location.hash,
        next: (history.state as { __N?: boolean } | null)?.__N === true,
    }));

// Next.js writes the history entry again when it finishes a route change,
// which would hide a reply that arrived earlier.
async function expectHome(page: Page) {
    await expect(page).toHaveURL(/\/$/);
    // By text, because the open or closing dialog hides the page from the
    // accessibility tree.
    await expect(
        page.getByText("Someone shared a secret with you"),
    ).toHaveCount(0);
}

test("asks before leaving an opening secret, and Stay keeps it", async ({
    page,
}) => {
    const reply = await openAndReveal(page);

    await page.getByRole("link", { name: "Cryptex Vault home" }).click();
    await expect(page.getByRole("alertdialog")).toContainText(
        "Leave and lose this secret?",
    );
    await page.getByRole("button", { name: "Stay" }).click();
    await expect(page.getByRole("alertdialog")).toBeHidden();
    await expect(page.getByRole("button", { name: /Opening/ })).toBeVisible();
    expect(
        await page.evaluate(() => {
            const event = new Event("beforeunload", { cancelable: true });
            window.dispatchEvent(event);
            return event.defaultPrevented;
        }),
    ).toBe(true);

    await reply();
    await expect(
        page.getByRole("heading", { name: "Staging database" }),
    ).toBeVisible();
    expect(new URL(page.url()).hash).toBe("");
});

test("a reply after Leave doesn't touch the next page", async ({ page }) => {
    const reply = await openAndReveal(page);

    await page
        .getByRole("link", { name: "Cryptex Vault", exact: true })
        .click();
    await page.getByRole("button", { name: "Leave", exact: true }).click();
    await expectHome(page);
    await reply();

    expect(await historyEntry(page)).toEqual({ url: "/", next: true });
});

test("Back asks first and keeps the link's key", async ({ page }) => {
    // Back only stays in the app after a client-side visit to the link.
    const reply = await openAndReveal(page, async () => {
        await page.goto("/");
        type NextWindow = {
            next?: { router?: { push: (url: string) => unknown } };
        };
        await page.waitForFunction(
            () => (window as NextWindow).next?.router !== undefined,
        );
        await page.evaluate(
            (link) => (window as NextWindow).next!.router!.push(link),
            shareLink,
        );
    });

    await page.goBack();
    await expect(page.getByRole("alertdialog")).toBeVisible();
    expect(await historyEntry(page)).toEqual({ url: shareLink, next: true });

    await page.getByRole("button", { name: "Leave", exact: true }).click();
    await expectHome(page);
    await reply();

    expect(await historyEntry(page)).toEqual({ url: "/", next: true });
});

test("a reply after Leave doesn't touch a new visit to the same link", async ({
    page,
}) => {
    const reply = await openAndReveal(page);

    await page.getByRole("link", { name: "Cryptex Vault home" }).click();
    await page.getByRole("button", { name: "Leave", exact: true }).click();
    await expectHome(page);
    await page.goBack();
    await expect(
        page.getByRole("button", { name: "Reveal secret" }),
    ).toBeVisible();
    await reply();

    expect(await historyEntry(page)).toEqual({ url: shareLink, next: true });
});
