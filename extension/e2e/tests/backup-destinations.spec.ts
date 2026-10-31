import type { Locator, Page } from "@playwright/test";

import { Vault } from "../../../packages/vault-core/src/proto/vault";
import {
    configureVaultCoreRuntime,
    createWebCryptoEnvelopeCrypto,
    type VaultCoreRuntime,
} from "../../../packages/vault-core/src/runtime";
import { EncryptedBlob } from "../../../packages/vault-core/src/vault-utils/encryption";
import { openEnvelopeBlob } from "../../../packages/vault-core/src/vault-utils/vault-envelope-ops";
import {
    createGarageBucket,
    garageS3Url,
    garageTlsUrl,
    type GarageBucket,
    type GarageKey,
    virtualHostedUrl,
} from "../../../e2e/garage/garage";
import { expect, test } from "../fixtures";

const VAULT_PASSWORD = "e2e-vault-password";
const NEW_PASSWORD = "e2e-vault-password-rotated";
const PREFIX = "cryptex/";
const BACKUP_KEY =
    /^cryptex\/[0-9A-Z]{26}\/extension-[0-9A-Z]{26}\/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.cryx$/;

// Opening a backup needs only the envelope crypto.
configureVaultCoreRuntime({
    envelopeCrypto: createWebCryptoEnvelopeCrypto(),
} as VaultCoreRuntime);

async function openBackup(bytes: Uint8Array, masterPassword: string) {
    const opened = await openEnvelopeBlob(
        EncryptedBlob.fromBinary(bytes),
        undefined,
        { masterPassword },
    );
    return opened.isOk() ? Vault.decode(opened.value.plaintext) : null;
}

const opensWith = async (bytes: Uint8Array, masterPassword: string) =>
    (await openBackup(bytes, masterPassword)) !== null;

/** Credential names in the bucket's newest backup. */
async function newestCredentials(bucket: GarageBucket) {
    const newest = (await backups(bucket)).at(-1)!;
    const vault = await openBackup(await bucket.get(newest), VAULT_PASSWORD);
    return vault!.Credentials.map((credential) => credential.Name);
}

const backups = async (bucket: GarageBucket) =>
    (await bucket.list(PREFIX)).filter((name) => name.endsWith(".cryx"));

/** The folder this browser uploads to, from its first backup. */
async function deviceFolder(bucket: GarageBucket) {
    await expect.poll(() => backups(bucket)).toHaveLength(1);
    const [first] = await backups(bucket);
    expect(first).toMatch(BACKUP_KEY);
    return first!.slice(0, first!.lastIndexOf("/") + 1);
}

async function unlockWithBackupCenter(page: Page, extensionId: string) {
    await page.goto(`chrome-extension://${extensionId}/e2e-bootstrap.html`);
    await page.getByRole("button", { name: "Reset and seed vault" }).click();
    await expect(page.getByRole("status")).toContainText("Seeded vault");
    await page.goto(`chrome-extension://${extensionId}/popup.html?view=tab`);
    await page
        .getByRole("textbox", { name: "Password", exact: true })
        .fill(VAULT_PASSWORD);
    await page.getByRole("button", { name: "Unlock", exact: true }).click();
    return openBackupCenter(page);
}

async function openBackupCenter(page: Page) {
    await page.getByRole("button", { name: "Vault actions" }).click();
    await page.getByRole("menuitem", { name: /Backup Center/ }).click();
    return page.getByRole("dialog", { name: "Backup Center" });
}

async function closeBackupCenter(center: Locator) {
    await center
        .getByRole("button", { name: "Close", exact: true })
        .last()
        .click();
    await expect(center).toBeHidden();
}

function destinationForm(page: Page) {
    const form = page.getByTestId("backup-destination-dialog");
    return {
        form,
        field: (label: string) => form.getByLabel(label, { exact: true }),
        keepAll: form.getByRole("switch", { name: /Keep every backup/ }),
        save: form.getByTestId("backup-destination-save"),
    };
}

async function fillKey(
    { field }: ReturnType<typeof destinationForm>,
    key: GarageKey,
) {
    await field("Access key ID").fill(key.accessKeyId);
    await field("Secret access key").fill(key.secretAccessKey);
}

async function addDestination(
    center: Locator,
    page: Page,
    bucket: GarageBucket,
    {
        key = bucket.key,
        name = "Home NAS",
        virtualHosted = false,
    }: { key?: GarageKey; name?: string; virtualHosted?: boolean } = {},
) {
    await center.getByRole("button", { name: "Add destination" }).click();
    const destination = destinationForm(page);
    await destination.field("Name").fill(name);
    await destination
        .field("Endpoint")
        .fill(virtualHosted ? virtualHostedUrl(garageTlsUrl) : garageS3Url);
    await destination.field("Bucket").fill(bucket.name);
    await destination.field("Region").fill("garage");
    await destination.field("Folder (optional)").fill(PREFIX);
    if (!virtualHosted) {
        await destination.form
            .getByRole("switch", { name: /Path-style/ })
            .click();
    }
    await fillKey(destination, key);
    await destination.save.click();
    return destination;
}

/**
 * Stops the extension's service worker, as Chrome does when it's idle.
 * restartedAt resolves to the time it next runs.
 */
async function stopServiceWorker(page: Page) {
    const cdp = await page.context().newCDPSession(page);
    const status = (runningStatus: string) =>
        new Promise<string>((resolve) =>
            cdp.on("ServiceWorker.workerVersionUpdated", ({ versions }) => {
                const version = versions.find(
                    (candidate) => candidate.runningStatus === runningStatus,
                );
                if (version) resolve(version.versionId);
            }),
        );
    const running = status("running");
    await cdp.send("ServiceWorker.enable");
    const stopped = status("stopped");
    await cdp.send("ServiceWorker.stopWorker", { versionId: await running });
    await stopped;
    return { restartedAt: status("running").then(() => Date.now()) };
}

async function addCredential(page: Page, name: string) {
    await page.getByRole("button", { name: "Add credential" }).click();
    await page.locator("#cred-name").fill(name);
    await page.getByRole("button", { name: "Create Credential" }).click();
    await expect(
        page.getByRole("button", { name: `Actions for ${name}`, exact: true }),
    ).toBeVisible();
}

test("tests the key before saving and shows upload errors on the destination", async ({
    context,
    extensionId,
}) => {
    const bucket = await createGarageBucket();
    const page = await context.newPage();
    const center = await unlockWithBackupCenter(page, extensionId);

    const destination = await addDestination(center, page, bucket, {
        key: bucket.readOnlyKey,
    });
    await expect(destination.form.getByRole("alert")).toContainText(
        "The bucket refused the access key",
    );
    await destination.form.getByRole("button", { name: "Save anyway" }).click();
    await expect(destination.form).toBeHidden();

    const row = center.getByTestId("backup-destination-row");
    await expect(row.getByRole("alert")).toContainText(
        "The bucket refused the access key",
    );
    expect(await backups(bucket)).toEqual([]);

    await row.getByRole("button", { name: "Edit Home NAS" }).click();
    await fillKey(destination, bucket.key);
    await destination.save.click();
    await expect(destination.form).toBeHidden();
    await expect(row).toContainText(/Last backup just now/);

    await deviceFolder(bucket);
    const [backup] = await backups(bucket);
    // The connection test cleans up after itself.
    expect(await bucket.list(PREFIX)).toEqual([backup]);
    expect(await opensWith(await bucket.get(backup!), VAULT_PASSWORD)).toBe(
        true,
    );
});

test("uploads vault changes, holds them while paused and stops after removal", async ({
    context,
    extensionId,
}) => {
    // Automatic uploads wait 30 seconds after the last change.
    test.setTimeout(240_000);
    const bucket = await createGarageBucket();
    const page = await context.newPage();
    let center = await unlockWithBackupCenter(page, extensionId);
    await addDestination(center, page, bucket);
    await deviceFolder(bucket);
    await closeBackupCenter(center);

    await addCredential(page, "Uploaded automatically");
    await expect
        .poll(() => backups(bucket), { timeout: 60_000 })
        .toHaveLength(2);

    center = await openBackupCenter(page);
    const row = center.getByTestId("backup-destination-row");
    await row
        .getByRole("switch", { name: "Automatic backups to Home NAS" })
        .click();
    await expect(row).toContainText("Paused");
    await expect(
        row.getByRole("button", { name: "Back up now" }),
    ).toBeDisabled();
    await closeBackupCenter(center);

    await addCredential(page, "Changed while paused");
    await page.waitForTimeout(40_000);
    expect(await backups(bucket)).toHaveLength(2);

    center = await openBackupCenter(page);
    await row
        .getByRole("switch", { name: "Automatic backups to Home NAS" })
        .click();
    await expect
        .poll(() => backups(bucket), { timeout: 60_000 })
        .toHaveLength(3);

    await row.getByRole("button", { name: "Edit Home NAS" }).click();
    const destination = destinationForm(page);
    await destination.form.getByRole("button", { name: "Remove" }).click();
    await expect(destination.form).toBeHidden();
    await expect(row).toHaveCount(0);
    expect(await backups(bucket)).toHaveLength(3);
});

test("deletes the default retention's old backups but keeps them all when asked", async ({
    context,
    extensionId,
}) => {
    const bucket = await createGarageBucket();
    const page = await context.newPage();
    const center = await unlockWithBackupCenter(page, extensionId);
    await addDestination(center, page, bucket);
    const folder = await deviceFolder(bucket);
    const [first] = await backups(bucket);
    const yearsOld = `${folder}2020-01-01T00-00-00-000Z.cryx`;
    const row = center.getByTestId("backup-destination-row");

    await bucket.put(yearsOld, await bucket.get(first!));
    await row.getByRole("button", { name: "Back up now" }).click();
    await expect.poll(() => backups(bucket)).not.toContain(yearsOld);
    expect(await backups(bucket)).toHaveLength(2);

    await row.getByRole("button", { name: "Edit Home NAS" }).click();
    const destination = destinationForm(page);
    await destination.keepAll.click();
    await destination.save.click();
    await expect(destination.form).toBeHidden();
    await expect.poll(() => backups(bucket)).toHaveLength(3);

    await bucket.put(yearsOld, await bucket.get(first!));
    await row.getByRole("button", { name: "Back up now" }).click();
    await expect.poll(() => backups(bucket)).toHaveLength(5);
    expect(await backups(bucket)).toContain(yearsOld);
});

for (const rotate of [false, true]) {
    test(`deletes only this browser's older backups after a password change${rotate ? " with a new encryption key" : ""}`, async ({
        context,
        extensionId,
    }) => {
        const bucket = await createGarageBucket();
        const page = await context.newPage();
        const center = await unlockWithBackupCenter(page, extensionId);
        await addDestination(center, page, bucket);
        const folder = await deviceFolder(bucket);
        const row = center.getByTestId("backup-destination-row");
        await row.getByRole("button", { name: "Back up now" }).click();
        await expect.poll(() => backups(bucket)).toHaveLength(2);
        const older = await backups(bucket);

        const destinationFolder = folder.slice(
            0,
            folder.lastIndexOf("/", folder.length - 2) + 1,
        );
        const otherDevice = `${destinationFolder}web-01JAAAAAAAAAAAAAAAAAAAAAAA/2026-01-01T00-00-00-000Z.cryx`;
        await bucket.put(otherDevice, await bucket.get(older[0]!));
        await closeBackupCenter(center);

        await page.getByRole("button", { name: "Vault actions" }).click();
        await page.getByRole("menuitem", { name: /Vault Settings/ }).click();
        const dialog = page.getByRole("dialog", {
            name: "Encryption & Security",
        });
        await dialog.getByLabel("Current master password").fill(VAULT_PASSWORD);
        await dialog.getByLabel("New password").fill(NEW_PASSWORD);
        await dialog.getByLabel("Confirm password").fill(NEW_PASSWORD);
        if (rotate) {
            await dialog
                .getByLabel("Rotate this device's vault encryption key")
                .first()
                .check();
        }
        await dialog
            .getByLabel("Delete older destination backups after replacement")
            .first()
            .check();
        const kdfRisk = dialog.getByLabel(
            /I understand the risk and want to use these key derivation settings anyway/,
        );
        if (await kdfRisk.isVisible()) await kdfRisk.check();
        await dialog
            .getByRole("button", { name: "Save protection settings" })
            .click();
        await expect(
            page.getByText(
                rotate
                    ? "Security settings and vault encryption key updated."
                    : "Security settings updated.",
                { exact: true },
            ),
        ).toBeVisible();

        await expect
            .poll(async () =>
                (await backups(bucket)).filter(
                    (name) => name.startsWith(folder) && !older.includes(name),
                ),
            )
            .toHaveLength(1);
        await expect
            .poll(async () =>
                (await backups(bucket)).filter((name) =>
                    name.startsWith(folder),
                ),
            )
            .toHaveLength(1);
        expect(await backups(bucket)).toContain(otherDevice);

        const [replacement] = (await backups(bucket)).filter((name) =>
            name.startsWith(folder),
        );
        const bytes = await bucket.get(replacement!);
        expect(await opensWith(bytes, NEW_PASSWORD)).toBe(true);
        expect(await opensWith(bytes, VAULT_PASSWORD)).toBe(false);
    });
}

test("uploads to a virtual-hosted bucket address", async ({
    context,
    extensionId,
}) => {
    const bucket = await createGarageBucket();
    const endpoint = new URL(virtualHostedUrl(garageTlsUrl));
    const bucketOrigin = `${endpoint.protocol}//${bucket.name}.${endpoint.host}`;
    const garageRequests: string[] = [];
    context.on("request", (request) => {
        if (new URL(request.url()).port === endpoint.port)
            garageRequests.push(`${request.method()} ${request.url()}`);
    });
    const page = await context.newPage();
    const center = await unlockWithBackupCenter(page, extensionId);
    await addDestination(center, page, bucket, { virtualHosted: true });

    await deviceFolder(bucket);
    const [backup] = await backups(bucket);
    expect(garageRequests).toContain(`PUT ${bucketOrigin}/${backup}`);
    // None fell back to a path-style address.
    expect(
        garageRequests.filter(
            (request) => !request.includes(` ${bucketOrigin}/`),
        ),
    ).toEqual([]);
    expect(await opensWith(await bucket.get(backup!), VAULT_PASSWORD)).toBe(
        true,
    );
});

test("keeps uploading to other destinations while one refuses the key, and catches up after the key is restored", async ({
    context,
    extensionId,
}) => {
    test.setTimeout(180_000);
    const home = await createGarageBucket();
    const office = await createGarageBucket();
    const page = await context.newPage();
    let center = await unlockWithBackupCenter(page, extensionId);
    await addDestination(center, page, home);
    await expect(destinationForm(page).form).toBeHidden();
    await addDestination(center, page, office, { name: "Office NAS" });
    await deviceFolder(home);
    await deviceFolder(office);
    await office.revokeKey();
    await closeBackupCenter(center);

    await addCredential(page, "While the key was revoked");
    center = await openBackupCenter(page);
    const officeRow = center
        .getByTestId("backup-destination-row")
        .filter({ hasText: "Office NAS" });
    await expect(officeRow.getByRole("alert")).toContainText(
        "The bucket refused the access key",
        { timeout: 60_000 },
    );
    await expect.poll(() => backups(home)).toHaveLength(2);
    expect(await newestCredentials(home)).toEqual([
        "While the key was revoked",
    ]);
    expect(await backups(office)).toHaveLength(1);

    // A refusal isn't retried on a timer: the next change tries again.
    await office.restoreKey();
    await closeBackupCenter(center);
    await addCredential(page, "After the key was restored");
    await expect
        .poll(() => backups(office), { timeout: 60_000 })
        .toHaveLength(2);
    expect(await newestCredentials(office)).toEqual([
        "While the key was revoked",
        "After the key was restored",
    ]);
    center = await openBackupCenter(page);
    await expect(officeRow).toContainText(/Last backup just now/);
});

test("retries after a network outage and catches up", async ({
    context,
    extensionId,
}) => {
    test.setTimeout(120_000);
    const bucket = await createGarageBucket();
    const page = await context.newPage();
    let center = await unlockWithBackupCenter(page, extensionId);
    await addDestination(center, page, bucket);
    await deviceFolder(bucket);
    await closeBackupCenter(center);

    const garage = `${garageS3Url}/**`;
    await context.route(garage, (route) => route.abort("internetdisconnected"));
    await addCredential(page, "Changed while offline");
    center = await openBackupCenter(page);
    const alert = center
        .getByTestId("backup-destination-row")
        .getByRole("alert");
    await expect(alert).toContainText("Couldn't reach the bucket", {
        timeout: 60_000,
    });
    await expect(alert).toContainText("Retrying in 1 min.");
    expect(await backups(bucket)).toHaveLength(1);

    await context.unroute(garage);
    await expect
        .poll(() => backups(bucket), { timeout: 30_000 })
        .toHaveLength(2);
    expect(await newestCredentials(bucket)).toEqual(["Changed while offline"]);
    await expect(center.getByTestId("backup-destination-row")).toContainText(
        /Last backup just now/,
    );
});

test("uploads a change when the alarm wakes the stopped service worker", async ({
    context,
    extensionId,
}) => {
    test.setTimeout(120_000);
    const bucket = await createGarageBucket();
    const page = await context.newPage();
    const center = await unlockWithBackupCenter(page, extensionId);
    await addDestination(center, page, bucket);
    await deviceFolder(bucket);
    await closeBackupCenter(center);
    await addCredential(page, "Changed before the worker stopped");
    const changedAt = Date.now();

    // This page doesn't message the worker, so only the alarm can wake it.
    await page.goto(`chrome-extension://${extensionId}/e2e-bootstrap.html`);
    const { restartedAt } = await stopServiceWorker(page);

    await expect
        .poll(() => backups(bucket), { timeout: 60_000 })
        .toHaveLength(2);
    expect((await restartedAt) - changedAt).toBeGreaterThan(25_000);
    expect(await newestCredentials(bucket)).toEqual([
        "Changed before the worker stopped",
    ]);
});

test("uploads a change before locking", async ({ context, extensionId }) => {
    const bucket = await createGarageBucket();
    const page = await context.newPage();
    const center = await unlockWithBackupCenter(page, extensionId);
    await addDestination(center, page, bucket);
    await deviceFolder(bucket);
    await closeBackupCenter(center);

    await addCredential(page, "Changed just before locking");
    await page.getByRole("button", { name: "Vault actions" }).click();
    await page.getByRole("menuitem", { name: /Lock vault/ }).click();
    await expect(
        page.getByRole("button", { name: "Unlock", exact: true }),
    ).toBeVisible();
    expect(await backups(bucket)).toHaveLength(2);
    expect(await newestCredentials(bucket)).toEqual([
        "Changed just before locking",
    ]);
});
