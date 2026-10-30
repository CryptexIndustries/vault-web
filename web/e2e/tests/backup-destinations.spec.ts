/**
 * Backup destinations against the Garage from compose.e2e.yaml. Every test
 * gets its own bucket. The web app only connects to https:, so the browser
 * goes through Garage's TLS proxy and ignores its certificate, while the
 * checks read the bucket directly.
 */
import {
    expect,
    test,
    type Browser,
    type BrowserContext,
    type Locator,
    type Page,
} from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
    createGarageBucket,
    garageHostResolverRules,
    garageTlsUrl,
    GARAGE_DOMAIN,
    GARAGE_REGION,
    virtualHostedUrl,
    type GarageBucket,
    type GarageKey,
} from "../../../e2e/garage/garage";
import { addLinkingServers, createInvitation } from "../linking-servers";
import { createVault, finishVaultSetup } from "../vault-helpers";

const PASSWORD = "e2e-destination-vault-password-42!";
const WRONG_PASSWORD = "e2e-wrong-vault-password-42!";
const DESTINATION = "E2E Garage";
const PREFIX = "vaults/";
const DAY = 24 * 60 * 60 * 1000;
// Uploads wait 30 seconds after the last change. Tests that wait for that
// install page.clock and jump it forward once the change is saved.
const AFTER_DEBOUNCE = 35_000;
// How long to wait after a jump for an upload that shouldn't happen.
const SETTLE = 5_000;
const UPLOAD = { timeout: 60_000 };

test.use({
    ignoreHTTPSErrors: true,
    // Sends garage.e2e and its bucket subdomains to the TLS proxy.
    launchOptions: {
        args: [
            `--host-resolver-rules=${garageHostResolverRules(garageTlsUrl)}`,
        ],
    },
});

async function addCredential(page: Page, name: string) {
    await page.getByRole("button", { name: "Add New" }).click();
    const drawer = page.getByRole("dialog", { name: "Add New Credential" });
    await drawer.getByLabel(/^Name/).fill(name);
    await drawer.getByLabel(/^Username \/ Email/).fill("bucket@example.com");
    await drawer.getByLabel(/^Password/).fill("bucket-secret-42!");
    await drawer.getByRole("button", { name: "Create Credential" }).click();
    await expect(page.getByText(name, { exact: true })).toBeVisible();
}

async function openBackupCenter(page: Page) {
    await page
        .getByRole("button", { name: /^Backups/ })
        .first()
        .click();
    const center = page.getByRole("dialog", { name: "Backup Center" });
    await expect(center).toBeVisible();
    return center;
}

async function closeBackupCenter(page: Page) {
    const center = page.getByRole("dialog", { name: "Backup Center" });
    // A closing nested dialog still hides the center from the role query.
    await expect(center).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(center).toBeHidden();
}

/** Fills the bucket fields shared by the destination and restore forms. */
async function fillBucket(
    form: Locator,
    bucket: GarageBucket,
    key: GarageKey,
    prefix: string,
    virtualHosted = false,
) {
    await form
        .getByLabel("Endpoint", { exact: true })
        .fill(virtualHosted ? virtualHostedUrl(garageTlsUrl) : garageTlsUrl);
    await form.getByLabel("Bucket", { exact: true }).fill(bucket.name);
    await form.getByLabel("Region", { exact: true }).fill(GARAGE_REGION);
    await form.getByLabel("Folder (optional)").fill(prefix);
    if (!virtualHosted) {
        await form
            .getByRole("switch", { name: /^Path-style addresses/ })
            .click();
    }
    await fillKey(form, key);
}

async function fillKey(form: Locator, key: GarageKey) {
    await form.getByLabel("Access key ID").fill(key.accessKeyId);
    await form
        .getByLabel("Secret access key", { exact: true })
        .fill(key.secretAccessKey);
}

/** Adds the destination and waits for the upload that follows. */
async function addDestination(
    page: Page,
    bucket: GarageBucket,
    { prefix = PREFIX, name = DESTINATION, virtualHosted = false } = {},
) {
    const center = await openBackupCenter(page);
    await center.getByRole("button", { name: "Add destination" }).click();
    const dialog = page.getByRole("dialog", {
        name: "Add backup destination",
    });
    await dialog.getByLabel("Name", { exact: true }).fill(name);
    await fillBucket(dialog, bucket, bucket.key, prefix, virtualHosted);
    await dialog.getByRole("button", { name: "Test and save" }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });
    await expect(
        destinationRow(center).filter({ hasText: name }),
    ).toContainText("Last backup", UPLOAD);
    return center;
}

const destinationRow = (center: Locator) =>
    center.getByTestId("backup-destination-row");

/** The .cryx files under prefix. */
async function backups(bucket: GarageBucket, prefix = PREFIX) {
    return (await bucket.list(prefix)).filter((name) => name.endsWith(".cryx"));
}

/** Where this device's backups go: "<prefix><destination>/<device>/". */
async function deviceFolder(bucket: GarageBucket, prefix = PREFIX) {
    const [first] = await backups(bucket, prefix);
    expect(first).toMatch(
        /^.*[0-9A-HJKMNP-TV-Z]{26}\/web-[0-9A-HJKMNP-TV-Z]{26}\/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.cryx$/,
    );
    return first!.slice(0, first!.lastIndexOf("/") + 1);
}

const backupName = (folder: string, time: number) =>
    `${folder}${new Date(time).toISOString().replace(/[:.]/g, "-")}.cryx`;

/** Another device's folder in the same destination. */
const otherDeviceFolder = (folder: string) =>
    folder.replace(
        /web-[0-9A-HJKMNP-TV-Z]{26}\/$/,
        "android-01JZZZZZZZZZZZZZZZZZZZZZZZ/",
    );

const FIXTURES = path.resolve(process.cwd(), "e2e/fixtures/backups");
const FIXTURE_PASSWORD = "CrossPlatformFixture42";

/** A device folder in the app's format, for backups planted by the tests. */
const plantedFolder = (platform: "web" | "android" | "extension") =>
    `${PREFIX}01K8C0FFEE0000000000000000/${platform}-01K8C0FFEE0000000000000001/`;

/** Puts e2e/fixtures/backups/<platform>.cryx where that app would upload it. */
async function plantFixture(
    bucket: GarageBucket,
    platform: "web" | "android" | "extension",
    time = Date.now(),
) {
    const bytes = readFileSync(path.join(FIXTURES, `${platform}.cryx`));
    await bucket.put(
        backupName(plantedFolder(platform), time),
        new Uint8Array(bytes),
    );
}

/** The Garage hosts a browser context sends requests to. */
function garageHosts(context: BrowserContext) {
    const tlsHost = new URL(garageTlsUrl).hostname;
    const hosts = new Set<string>();
    context.on("request", (request) => {
        const { hostname } = new URL(request.url());
        if (hostname === tlsHost || hostname.endsWith(GARAGE_DOMAIN))
            hosts.add(hostname);
    });
    return hosts;
}

/** Opens a fresh browser on the restore screen and lists the bucket. */
async function findBucketBackups(
    browser: Browser,
    bucket: GarageBucket,
    virtualHosted = false,
) {
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const hosts = garageHosts(context);
    const page = await context.newPage();
    await page.goto("/app");
    await page.getByRole("tab", { name: /Restore/ }).click();
    await page
        .getByRole("button", { name: "Restore from your own S3 storage" })
        .click();
    // Restoring needs only a read-only key.
    await fillBucket(
        page.locator("body"),
        bucket,
        bucket.readOnlyKey,
        PREFIX,
        virtualHosted,
    );
    await page.getByRole("button", { name: "Find backups" }).click();
    return {
        context,
        page,
        hosts,
        list: page.getByRole("button", { name: /^Backup from / }),
    };
}

/** Restores the chosen backup; only the right password unlocks it. */
async function restoreBackup(
    page: Page,
    backup: Locator,
    wrongPassword: string,
    password: string,
) {
    await backup.click();
    await expect(page.getByText("Backup downloaded")).toBeVisible();
    await page
        .getByPlaceholder("Enter a name for the restored vault")
        .fill("Restored from bucket");
    await page.getByRole("button", { name: /Restore Vault/ }).click();
    const unlock = page.getByRole("button", { name: "Unlock Vault" });
    await expect(unlock).toBeVisible({ timeout: 30_000 });
    await page.getByPlaceholder("Enter your secret key").fill(wrongPassword);
    await unlock.click();
    await expect(page.getByText("Failed to decrypt vault")).toBeVisible();
    await page.getByPlaceholder("Enter your secret key").fill(password);
    await unlock.click();
    await finishVaultSetup(page);
}

test("adds a destination, uploads after changes and restores from the bucket", async ({
    page,
    browser,
}) => {
    test.setTimeout(240_000);
    await page.clock.install();
    const bucket = await createGarageBucket();
    await createVault(page, "Destination vault", PASSWORD);
    await addCredential(page, "First bucket login");

    // A key that can't write fails the connection test and saves nothing.
    const center = await openBackupCenter(page);
    await center.getByRole("button", { name: "Add destination" }).click();
    const dialog = page.getByRole("dialog", {
        name: "Add backup destination",
    });
    await dialog.getByLabel("Name", { exact: true }).fill(DESTINATION);
    await fillBucket(dialog, bucket, bucket.readOnlyKey, PREFIX);
    await dialog.getByRole("button", { name: "Test and save" }).click();
    await expect(dialog.getByRole("alert")).toContainText(
        "The bucket refused the access key.",
    );
    await expect(destinationRow(center)).toHaveCount(0);

    await fillKey(dialog, bucket.key);
    await dialog.getByRole("button", { name: "Test and save" }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });
    await expect(page.getByText("Destination added")).toBeVisible();
    await expect(destinationRow(center)).toContainText("Last backup", UPLOAD);
    const folder = await deviceFolder(bucket);
    // The connection test cleans up after itself.
    expect(await bucket.list()).toHaveLength(1);

    // A change uploads by itself once the debounce is over.
    await closeBackupCenter(page);
    await addCredential(page, "Second bucket login");
    await openBackupCenter(page);
    await expect(destinationRow(center)).toContainText(
        "Changes waiting to upload.",
    );
    await page.clock.fastForward(AFTER_DEBOUNCE);
    await expect.poll(() => backups(bucket), UPLOAD).toHaveLength(2);
    await expect(destinationRow(center)).not.toContainText("waiting");
    expect(
        (await backups(bucket)).every((name) => name.startsWith(folder)),
    ).toBe(true);

    const restore = await findBucketBackups(browser, bucket);
    try {
        await expect(restore.list).toHaveCount(2);
        await restoreBackup(
            restore.page,
            restore.list.first(),
            WRONG_PASSWORD,
            PASSWORD,
        );
        for (const name of ["First bucket login", "Second bucket login"]) {
            await expect(
                restore.page.getByText(name, { exact: true }),
            ).toBeVisible();
        }
    } finally {
        await restore.context.close();
    }
});

test("pausing stops uploads, resuming catches up and removing leaves the bucket alone", async ({
    page,
}) => {
    test.setTimeout(300_000);
    await page.clock.install();
    const bucket = await createGarageBucket();
    await createVault(page, "Paused destination vault", PASSWORD);
    const center = await addDestination(page, bucket);
    const row = destinationRow(center);
    const automatic = row.getByRole("switch", {
        name: `Automatic backups to ${DESTINATION}`,
    });

    await automatic.click();
    await expect(row).toContainText("Paused");
    await expect(
        row.getByRole("button", { name: "Back up now" }),
    ).toBeDisabled();
    await closeBackupCenter(page);
    await addCredential(page, "Made while paused");
    await page.clock.fastForward(AFTER_DEBOUNCE);
    await page.waitForTimeout(SETTLE);
    expect(await backups(bucket)).toHaveLength(1);

    await openBackupCenter(page);
    await automatic.click();
    await expect(row).toContainText("Changes waiting to upload.");
    await page.clock.fastForward(AFTER_DEBOUNCE);
    await expect.poll(() => backups(bucket), UPLOAD).toHaveLength(2);
    await expect(row).toContainText("Last backup");

    await row.getByRole("button", { name: `Edit ${DESTINATION}` }).click();
    const dialog = page.getByRole("dialog", {
        name: "Edit backup destination",
    });
    await dialog.getByRole("button", { name: "Remove" }).click();
    await expect(
        page.getByText("Destination removed. Its backups stay in the bucket."),
    ).toBeVisible();
    await expect(row).toHaveCount(0);
    const kept = await backups(bucket);

    await closeBackupCenter(page);
    await addCredential(page, "Made after removing");
    await page.clock.fastForward(AFTER_DEBOUNCE);
    await page.waitForTimeout(SETTLE);
    expect(await backups(bucket)).toEqual(kept);
});

test("thins this device's old backups, and keeps them all with Keep every backup", async ({
    page,
}) => {
    test.setTimeout(240_000);
    const bucket = await createGarageBucket();
    await createVault(page, "Retention vault", PASSWORD);
    const center = await addDestination(page, bucket, { prefix: "" });
    const folder = await deviceFolder(bucket, "");
    const [firstUpload] = await backups(bucket, "");

    // Kept: anything from the last day, the newest of each day for a month
    // and the newest of each month for a year.
    const now = Date.now();
    const tenDaysAgo = new Date(now - 10 * DAY);
    const sameDay = (hour: number) =>
        Date.UTC(
            tenDaysAgo.getUTCFullYear(),
            tenDaysAgo.getUTCMonth(),
            tenDaysAgo.getUTCDate(),
            hour,
        );
    const threeMonthsAgo = new Date(now - 90 * DAY);
    const sameMonth = (day: number) =>
        Date.UTC(
            threeMonthsAgo.getUTCFullYear(),
            threeMonthsAgo.getUTCMonth(),
            day,
            12,
        );
    const keep = [now - 2 * 60 * 60 * 1000, sameDay(2), sameMonth(2)].map(
        (time) => backupName(folder, time),
    );
    const prune = [now - 400 * DAY, sameDay(1), sameMonth(1)].map((time) =>
        backupName(folder, time),
    );
    const otherDevice = backupName(otherDeviceFolder(folder), now - 400 * DAY);
    for (const name of [...keep, ...prune, otherDevice]) {
        await bucket.put(name, "planted");
    }

    const row = destinationRow(center);
    await row.getByRole("button", { name: "Back up now" }).click();
    await expect(page.getByText(`Backed up to ${DESTINATION}`)).toBeVisible(
        UPLOAD,
    );
    const thinned = await bucket.list(folder);
    expect(thinned).toHaveLength(5);
    expect(thinned).toEqual(expect.arrayContaining([firstUpload, ...keep]));
    expect(await bucket.list(otherDeviceFolder(folder))).toEqual([otherDevice]);

    await row.getByRole("button", { name: `Edit ${DESTINATION}` }).click();
    const dialog = page.getByRole("dialog", {
        name: "Edit backup destination",
    });
    await dialog.getByRole("switch", { name: /^Keep every backup/ }).click();
    const yearOld = backupName(folder, now - 400 * DAY);
    await bucket.put(yearOld, "planted");
    // Saving tests the connection and uploads again.
    await dialog.getByRole("button", { name: "Test and save" }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });
    await expect.poll(() => bucket.list(folder), UPLOAD).toHaveLength(7);
    expect(await bucket.list(folder)).toEqual(
        expect.arrayContaining([...thinned, yearOld]),
    );
});

for (const rotateKey of [false, true]) {
    test(`a password change${rotateKey ? " with a new encryption key" : ""} deletes only this device's older backups`, async ({
        page,
        browser,
    }) => {
        test.setTimeout(240_000);
        const newPassword = "e2e-changed-vault-password-84!";
        const bucket = await createGarageBucket();
        await createVault(page, "Password change vault", PASSWORD);
        await addCredential(page, "Survives the password change");
        const center = await addDestination(page, bucket);
        await destinationRow(center)
            .getByRole("button", { name: "Back up now" })
            .click();
        await expect.poll(() => backups(bucket), UPLOAD).toHaveLength(2);
        const folder = await deviceFolder(bucket);
        const oldBackups = await backups(bucket);
        const otherDevice = backupName(otherDeviceFolder(folder), Date.now());
        await bucket.put(otherDevice, "another device's backup");
        await closeBackupCenter(page);

        await page
            .getByRole("button", { name: "Vault Settings", exact: true })
            .click();
        await page
            .getByRole("dialog", { name: "Vault Settings", exact: true })
            .getByRole("button", { name: "Manage Encryption & Security" })
            .click();
        const security = page.getByRole("dialog", {
            name: "Encryption & Security",
        });
        await security.getByLabel("Current master password").fill(PASSWORD);
        await security
            .getByLabel("New master password", { exact: true })
            .fill(newPassword);
        await security.getByLabel("Confirm new password").fill(newPassword);
        await security
            .getByLabel("Delete older destination backups after replacement")
            .first()
            .check();
        if (rotateKey) {
            await security
                .getByLabel("Rotate this device's vault encryption key")
                .first()
                .check();
        }
        await security
            .getByRole("button", { name: "Save protection settings" })
            .click();
        await expect(
            page.getByText(
                rotateKey
                    ? "Security settings and vault encryption key updated."
                    : "Security settings updated.",
            ),
        ).toBeVisible();

        await expect
            .poll(async () => {
                const current = await bucket.list(folder);
                return (
                    current.length === 1 && !oldBackups.includes(current[0]!)
                );
            }, UPLOAD)
            .toBe(true);
        expect(await bucket.list(otherDeviceFolder(folder))).toEqual([
            otherDevice,
        ]);

        const restore = await findBucketBackups(browser, bucket);
        try {
            const ownBackup = restore.list.filter({
                hasText: `Web app ${folder.slice(-7, -1)}`,
            });
            await expect(ownBackup).toHaveCount(1);
            await restoreBackup(restore.page, ownBackup, PASSWORD, newPassword);
            await expect(
                restore.page.getByText("Survives the password change", {
                    exact: true,
                }),
            ).toBeVisible();
        } finally {
            await restore.context.close();
        }
    });
}

test("a linked browser gets the destination and backs up to its own folder", async ({
    page,
    browser,
}, testInfo) => {
    test.setTimeout(240_000);
    const bucket = await createGarageBucket();
    await createVault(page, "Shared destination vault", PASSWORD);
    await addCredential(page, "Linked bucket login");
    await addDestination(page, bucket);
    const senderFolder = await deviceFolder(bucket);
    await closeBackupCenter(page);

    await addLinkingServers(page);
    const invitation = testInfo.outputPath("invite.cryxlink");
    const words = await createInvitation(page, invitation);

    const receiverContext = await browser.newContext({
        ignoreHTTPSErrors: true,
    });
    await receiverContext.clock.install();
    try {
        const receiver = await receiverContext.newPage();
        await receiver.goto("/app");
        await receiver.getByRole("tab", { name: "Use invitation" }).click();
        await receiver
            .getByRole("tabpanel", { name: "Use invitation" })
            .getByRole("button", { name: "Use invitation" })
            .click();
        const receive = receiver.getByRole("dialog", {
            name: "Receive vault data",
        });
        await receive.getByRole("button", { name: /Import file/ }).click();
        await receive.locator("input[type=file]").setInputFiles(invitation);
        await receive.getByRole("button", { name: "Next" }).click();
        await receive
            .getByPlaceholder("Words shown on sending device")
            .fill(words);
        await receive
            .getByRole("button", { name: "Receive vault data" })
            .click();
        await expect(receiver.getByText("Vault received")).toBeVisible({
            timeout: 60_000,
        });
        await receiver
            .getByPlaceholder("Enter your secret key")
            .fill("e2e-receiver-vault-password-42!");
        await receiver.getByRole("button", { name: "Save vault" }).click();
        const recovery = receiver.getByRole("dialog", {
            name: "Save these secrets now",
        });
        await recovery
            .getByLabel("I have written down the recovery code")
            .check();
        await recovery.getByRole("button", { name: "Continue" }).click();
        await finishVaultSetup(receiver);

        // The new device starts with the destination and its own folder.
        await expect
            .poll(
                async () =>
                    (await backups(bucket)).filter(
                        (name) => !name.startsWith(senderFolder),
                    ).length,
                UPLOAD,
            )
            .toBe(1);
        const receiverCenter = await openBackupCenter(receiver);
        await expect(destinationRow(receiverCenter)).toContainText(DESTINATION);
        await expect(destinationRow(receiverCenter)).toContainText(
            "Last backup",
        );
        const [receiverBackup] = (await backups(bucket)).filter(
            (name) => !name.startsWith(senderFolder),
        );
        const receiverFolder = receiverBackup!.slice(
            0,
            receiverBackup!.lastIndexOf("/") + 1,
        );
        // Same destination, different device.
        expect(receiverFolder.split("/")[1]).toBe(senderFolder.split("/")[1]);
        expect(receiverFolder).not.toBe(senderFolder);
        await closeBackupCenter(receiver);

        // A destination added later reaches the other browser through sync.
        const linked = page.getByRole("dialog", { name: "Device linked" });
        await expect(linked).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(linked).toBeHidden();
        const later = await createGarageBucket();
        await addDestination(page, later, { name: "Later Garage" });
        await closeBackupCenter(page);
        await page
            .getByRole("button", { name: "Actions for Second browser" })
            .click();
        await page.getByRole("menuitem", { name: "Sync now" }).click();
        const laterRow = destinationRow(
            await openBackupCenter(receiver),
        ).filter({ hasText: "Later Garage" });
        await expect(laterRow).toContainText("Changes waiting to upload.", {
            timeout: 60_000,
        });
        await receiverContext.clock.fastForward(AFTER_DEBOUNCE);
        await expect(laterRow).toContainText("Last backup", {
            timeout: 90_000,
        });
        const laterDevices = new Set(
            (await backups(later)).map((name) => name.split("/")[2]),
        );
        expect(laterDevices.size).toBe(2);
    } finally {
        await receiverContext.close();
    }

    const restore = await findBucketBackups(browser, bucket);
    try {
        // Both devices' backups are listed, whichever uploaded last.
        const devices = new Set(
            (await backups(bucket)).map((name) => name.split("/")[2]!),
        );
        expect(devices.size).toBe(2);
        for (const device of devices) {
            await expect(
                restore.list
                    .filter({ hasText: `Web app ${device.slice(-6)}` })
                    .first(),
            ).toBeVisible();
        }
    } finally {
        await restore.context.close();
    }
});

test("uploads to and restores from the bucket's own host name", async ({
    page,
    browser,
}) => {
    test.setTimeout(240_000);
    const bucket = await createGarageBucket();
    const bucketHost = `${bucket.name}.${GARAGE_DOMAIN}`;
    const uploadHosts = garageHosts(page.context());
    await createVault(page, "Virtual-hosted vault", PASSWORD);
    await addCredential(page, "Virtual-hosted login");
    await addDestination(page, bucket, { virtualHosted: true });
    expect(await backups(bucket)).toHaveLength(1);
    expect([...uploadHosts]).toEqual([bucketHost]);

    const restore = await findBucketBackups(browser, bucket, true);
    try {
        await expect(restore.list).toHaveCount(1);
        await restoreBackup(
            restore.page,
            restore.list.first(),
            WRONG_PASSWORD,
            PASSWORD,
        );
        await expect(
            restore.page.getByText("Virtual-hosted login", {
                exact: true,
            }),
        ).toBeVisible();
        expect([...restore.hosts]).toEqual([bucketHost]);
    } finally {
        await restore.context.close();
    }
});

test("a refused key fails only its own destination, and the next change catches up", async ({
    page,
}) => {
    test.setTimeout(300_000);
    await page.clock.install();
    const broken = await createGarageBucket();
    const working = await createGarageBucket();
    await createVault(page, "Refused key vault", PASSWORD);
    await addDestination(page, broken, { name: "Broken Garage" });
    await closeBackupCenter(page);
    const center = await addDestination(page, working);
    const brokenRow = destinationRow(center).filter({
        hasText: "Broken Garage",
    });
    await broken.revokeKey();

    await closeBackupCenter(page);
    await addCredential(page, "Made while refused");
    await page.clock.fastForward(AFTER_DEBOUNCE);
    await openBackupCenter(page);
    await expect(brokenRow).toContainText(
        "The bucket refused the access key.",
        UPLOAD,
    );
    // A refusal waits for the next change instead of a retry timer.
    await expect(brokenRow).not.toContainText("Retrying");
    await expect.poll(() => backups(working), UPLOAD).toHaveLength(2);
    expect(await backups(broken)).toHaveLength(1);

    await broken.restoreKey();
    await closeBackupCenter(page);
    await addCredential(page, "Made after the key works again");
    await page.clock.fastForward(AFTER_DEBOUNCE);
    await openBackupCenter(page);
    await expect.poll(() => backups(broken), UPLOAD).toHaveLength(2);
    await expect(brokenRow).toContainText("Last backup");
    await expect.poll(() => backups(working), UPLOAD).toHaveLength(3);
});

test("an outage shows on the row and the backup catches up once the bucket is back", async ({
    page,
}) => {
    test.setTimeout(240_000);
    await page.clock.install();
    const bucket = await createGarageBucket();
    await createVault(page, "Outage vault", PASSWORD);
    const center = await addDestination(page, bucket);
    const row = destinationRow(center);
    const garage = new URL(garageTlsUrl).origin;
    const toGarage = (url: URL) => url.origin === garage;
    await page.route(toGarage, (route) => route.abort("internetdisconnected"));

    await closeBackupCenter(page);
    await addCredential(page, "Made during the outage");
    await page.clock.fastForward(AFTER_DEBOUNCE);
    await openBackupCenter(page);
    await expect(row).toContainText("Couldn't reach the bucket", UPLOAD);
    await expect(row).toContainText("Retrying in 1 min.");
    expect(await backups(bucket)).toHaveLength(1);

    await page.unroute(toGarage);
    await expect.poll(() => backups(bucket), UPLOAD).toHaveLength(2);
    await expect(row).toContainText("Last backup");
});

test("restores backups made by the Android app and the extension", async ({
    browser,
}) => {
    test.setTimeout(240_000);
    const bucket = await createGarageBucket();
    const fixtures = [
        {
            platform: "android",
            device: "Android",
            login: "Android Fixture Login",
        },
        {
            platform: "extension",
            device: "Browser extension",
            login: "Extension Fixture Login",
        },
    ] as const;
    for (const { platform } of fixtures) await plantFixture(bucket, platform);

    for (const { device, login } of fixtures) {
        const restore = await findBucketBackups(browser, bucket);
        try {
            await expect(restore.list).toHaveCount(2);
            await restoreBackup(
                restore.page,
                restore.list.filter({ hasText: device }),
                WRONG_PASSWORD,
                FIXTURE_PASSWORD,
            );
            await expect(
                restore.page.getByText(login, { exact: true }),
            ).toBeVisible();
        } finally {
            await restore.context.close();
        }
    }
});

test("lists more than 1,000 backups and restores the newest", async ({
    browser,
}) => {
    test.setTimeout(240_000);
    const bucket = await createGarageBucket();
    const now = Date.now();
    // Listing pages hold 1,000 keys, and the newest name sorts last.
    const older = Array.from({ length: 1_100 }, (_, index) =>
        backupName(plantedFolder("web"), now - (index + 1) * 60_000),
    );
    for (let start = 0; start < older.length; start += 100) {
        await Promise.all(
            older
                .slice(start, start + 100)
                .map((name) => bucket.put(name, "planted")),
        );
    }
    await plantFixture(bucket, "web", now);

    const restore = await findBucketBackups(browser, bucket);
    try {
        await expect(restore.list).toHaveCount(1_101);
        await restoreBackup(
            restore.page,
            restore.list.first(),
            WRONG_PASSWORD,
            FIXTURE_PASSWORD,
        );
        await expect(
            restore.page.getByText("Web Fixture Login", { exact: true }),
        ).toBeVisible();
    } finally {
        await restore.context.close();
    }
});
