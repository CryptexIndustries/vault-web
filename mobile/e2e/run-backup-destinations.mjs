// Backup destinations against a throwaway Garage. The flows drive the app;
// between them this script checks what actually landed in the bucket.
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import {
    createGarageBucket,
    garageTlsUrl,
    startGarage,
} from "../../e2e/garage/garage.ts";
import { maestroProfileArgs } from "./profile.mjs";

const serial = process.env.MAESTRO_DEVICE || process.env.ANDROID_SERIAL;
if (
    !serial ||
    serial.trim() !== serial ||
    serial === process.env.CRYPTEX_E2E_PROTECTED_DEVICE
) {
    throw new Error(
        "Select a dedicated, unprotected device with MAESTRO_DEVICE or ANDROID_SERIAL.",
    );
}

// No dictionary words: the keyboard turns some into emoji.
const PREFIX = "e2e/x1/";
const DEBOUNCE_WAIT_MS = 45_000;
const flowsDirectory = fileURLToPath(new URL("./flows/", import.meta.url));
const resultsDirectory = fileURLToPath(new URL("./results/", import.meta.url));
const fixturesDirectory = fileURLToPath(
    new URL("../../e2e/fixtures/backups/", import.meta.url),
);
// The https proxy, whose certificate the E2E build trusts.
const port = new URL(garageTlsUrl).port;

async function command(program, args) {
    const child = spawn(program, args, { stdio: "inherit" });
    const stop = () => child.kill("SIGTERM");
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    try {
        await new Promise((resolve, reject) => {
            child.on("error", reject);
            child.on("exit", (code, signal) =>
                code === 0
                    ? resolve()
                    : reject(
                          new Error(`${program} failed (${signal ?? code}).`),
                      ),
            );
        });
    } finally {
        process.off("SIGINT", stop);
        process.off("SIGTERM", stop);
    }
}

let bucket;
let planted;
const flow = (name) =>
    command("maestro", [
        "--device",
        serial,
        "test",
        ...maestroProfileArgs(),
        ...Object.entries({
            S3_ENDPOINT: `https://127.0.0.1:${port}`,
            S3_BUCKET: bucket.name,
            S3_PREFIX: PREFIX,
            S3_KEY_ID: bucket.key.accessKeyId,
            S3_SECRET: bucket.key.secretAccessKey,
            S3_RO_KEY_ID: bucket.readOnlyKey.accessKeyId,
            S3_RO_SECRET: bucket.readOnlyKey.secretAccessKey,
        }).flatMap(([key, value]) => ["-e", `${key}=${value}`]),
        "--format",
        "junit",
        "--output",
        `${resultsDirectory}backup-destinations-${name}.xml`,
        `${flowsDirectory}backup-destinations-${name}.yaml`,
    ]);

const ANDROID_BACKUP =
    /^e2e\/x1\/[0-9A-HJKMNP-TV-Z]{26}\/android-[0-9A-HJKMNP-TV-Z]{26}\/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.cryx$/;

/** This device's backups; fails on anything else the app left behind. */
async function phoneBackups() {
    const objects = (await bucket.list(PREFIX)).filter(
        (name) => name !== planted,
    );
    const stray = objects.filter((name) => !ANDROID_BACKUP.test(name));
    if (stray.length)
        throw new Error(`Unexpected objects in the bucket: ${stray}`);
    if (new Set(objects.map((name) => name.split("/")[3])).size > 1)
        throw new Error(`Backups from more than one device: ${objects}`);
    return objects;
}

async function expectBackups(count, label, timeoutMs = 90_000) {
    const deadline = Date.now() + timeoutMs;
    let objects = await phoneBackups();
    while (objects.length < count && Date.now() < deadline) {
        await delay(2_000);
        objects = await phoneBackups();
    }
    if (objects.length !== count) {
        throw new Error(
            `${label}: expected ${count} backups, found ${objects.length}: ${objects}`,
        );
    }
    console.log(`${label}: ${count} backup(s) in the bucket.`);
    return objects;
}

/** Waits out the upload debounce and checks that nothing new arrived. */
async function expectNoUpload(count, label) {
    await delay(DEBOUNCE_WAIT_MS);
    await expectBackups(count, label);
}

const stopGarage = startGarage("cryptex-vault-e2e-android");
const started = Date.now();
try {
    mkdirSync(resultsDirectory, { recursive: true });
    bucket = await createGarageBucket();
    await command("adb", [
        "-s",
        serial,
        "reverse",
        `tcp:${port}`,
        `tcp:${port}`,
    ]);

    await flow("01-add");
    const [first] = await expectBackups(1, "Added destination");
    const destinationFolder = first.split("/").slice(0, 3).join("/");

    await flow("02-change");
    await expectBackups(2, "Vault change");

    await flow("03-stop");
    await expectBackups(2, "Stopped before the upload");
    await flow("04-relaunch");
    await expectBackups(3, "Relaunched");

    // Well inside the 30-second wait: leaving the app and locking upload at once.
    await flow("05-background");
    await expectBackups(4, "In the background", 15_000);
    await flow("06-lock");
    await expectBackups(5, "Locked", 10_000);

    await flow("07-pause");
    // One from "Back up now"; none for the login added while paused.
    await expectNoUpload(6, "Paused");

    await flow("08-resume");
    const beforePasswordChange = await expectBackups(7, "Resumed");

    // Another device's backup in the same destination must survive.
    planted = `${destinationFolder}/web-01JAAAAAAAAAAAAAAAAAAAAAAA/2026-01-01T00-00-00-000Z.cryx`;
    await bucket.put(planted, "another device's backup");
    await flow("09-password");
    const deadline = Date.now() + 90_000;
    let after = await phoneBackups();
    while (
        (after.length !== 1 || beforePasswordChange.includes(after[0])) &&
        Date.now() < deadline
    ) {
        await delay(2_000);
        after = await phoneBackups();
    }
    if (after.length !== 1 || beforePasswordChange.includes(after[0]))
        throw new Error(`Older backups were not replaced: ${after}`);
    if (!(await bucket.list(PREFIX)).includes(planted))
        throw new Error("Another device's backup was deleted.");
    console.log(
        "Password change: one new backup left, the other device's kept.",
    );

    await flow("10-remove");
    await expectNoUpload(1, "Removed");

    await flow("11-restore");

    // Backups the other apps made, in other devices' folders.
    for (const [name, device] of [
        ["web", "web-01JBBBBBBBBBBBBBBBBBBBBBBB"],
        ["extension", "extension-01JCCCCCCCCCCCCCCCCCCCCCCC"],
    ]) {
        await bucket.put(
            `${destinationFolder}/${device}/2026-10-29T12-00-00-000Z.cryx`,
            readFileSync(`${fixturesDirectory}${name}.cryx`),
        );
    }
    await flow("12-other-apps");
    console.log(
        `Backup destinations passed in ${Math.round((Date.now() - started) / 1000)} s.`,
    );
} finally {
    await command("adb", [
        "-s",
        serial,
        "reverse",
        "--remove",
        `tcp:${port}`,
    ]).catch(() => undefined);
    stopGarage();
}
