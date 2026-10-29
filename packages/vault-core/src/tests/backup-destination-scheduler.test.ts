/**
 * @jest-environment node
 */
import { describe, expect, it } from "@jest/globals";
import { webcrypto } from "crypto";

Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    writable: true,
});

import type { BackupDestination } from "../proto/vault";
import {
    BACKUP_DESTINATION_DEBOUNCE_MS,
    BackupDestinationScheduler,
    type BackupDestinationState,
    type BackupDestinationStatus,
} from "../vault-utils/backup-destination-scheduler";
import {
    createBackupDestinationRecord,
    createBackupDeviceID,
    updateBackupDestinationRecord,
} from "../vault-utils/backup-destinations";
import { fakeBucket } from "./helpers/fake-s3";

const destination = () =>
    createBackupDestinationRecord({
        Name: "Garage",
        Endpoint: "https://s3.example.com",
        Region: "garage",
        Bucket: "vault-backups",
        Prefix: "",
        PathStyle: true,
        AccessKeyID: "GK123",
        SecretAccessKey: "secret",
        KeepAll: true,
    });

function setup(destinations: BackupDestination[]) {
    const bucketOptions: { putStatus?: number; deleteStatus?: number } = {};
    const bucket = fakeBucket(bucketOptions);
    const stored = new Map<string, BackupDestinationState>();
    const statuses = new Map<string, BackupDestinationStatus>();
    const timers: { delayMs: number; run: () => Promise<void> }[] = [];
    const vault = { source: "v1", destinations, created: 0 };
    const deviceID = createBackupDeviceID("web");
    // Set to hold PUT requests until the test releases them.
    const putGate: { wait?: Promise<void> } = {};
    // Destination IDs whose uploads answer 503.
    const failing = new Set<string>();
    const scheduler = new BackupDestinationScheduler({
        getDestinations: () => vault.destinations,
        getDeviceID: async () => deviceID,
        getSourceHash: async () => vault.source,
        createBackup: async () => {
            vault.created += 1;
            return {
                bytes: new TextEncoder().encode(vault.source),
                sourceHash: vault.source,
            };
        },
        loadState: async (id) => stored.get(id) ?? null,
        saveState: async (id, state) => {
            stored.set(id, state);
        },
        onStatus: (id, status) => statuses.set(id, status),
        setTimer: (delayMs, run) => {
            const timer = { delayMs, run };
            timers.push(timer);
            return () => timers.splice(timers.indexOf(timer), 1);
        },
        fetch: async (url, init) => {
            if (init.method === "PUT" && putGate.wait) await putGate.wait;
            if (
                init.method === "PUT" &&
                [...failing].some((id) => url.includes(id))
            ) {
                return new Response("<Error><Code>SlowDown</Code></Error>", {
                    status: 503,
                });
            }
            return bucket.fetchImpl(url, init);
        },
    });
    const fireTimer = async () => {
        const timer = timers.shift();
        if (!timer) throw new Error("no timer");
        await timer.run();
        return timer.delayMs;
    };
    return {
        scheduler,
        bucket,
        bucketOptions,
        stored,
        statuses,
        timers,
        vault,
        deviceID,
        fireTimer,
        putGate,
        failing,
    };
}

describe("backup destination scheduler", () => {
    it("uploads after the debounce and skips an unchanged vault", async () => {
        const record = destination();
        const t = setup([record]);
        t.stored.set(record.ID, {
            sourceHash: "v1",
            lastSuccessAt: 1,
            lastError: null,
            pruneError: null,
        });
        await t.scheduler.start();
        expect(t.timers).toHaveLength(0);
        expect(t.statuses.get(record.ID)?.phase).toBe("idle");

        t.vault.source = "v2";
        t.scheduler.markDirty();
        expect(await t.fireTimer()).toBe(BACKUP_DESTINATION_DEBOUNCE_MS);
        expect(t.bucket.objects.size).toBe(1);
        expect(t.stored.get(record.ID)?.sourceHash).toBe("v2");
        expect(t.statuses.get(record.ID)?.phase).toBe("idle");
    });

    it("builds the backup once for several destinations and skips paused ones", async () => {
        const paused = updateBackupDestinationRecord(destination(), {
            Paused: true,
        });
        const t = setup([destination(), destination(), paused]);
        await t.scheduler.start();
        await t.fireTimer();
        expect(t.vault.created).toBe(1);
        expect(t.bucket.objects.size).toBe(2);
        expect(t.statuses.get(paused.ID)?.phase).toBe("paused");
    });

    it("retries server errors with backoff and recovers", async () => {
        const record = destination();
        const t = setup([record]);
        t.bucketOptions.putStatus = 503;
        await t.scheduler.start();
        await t.fireTimer();
        expect(t.statuses.get(record.ID)).toMatchObject({
            phase: "error",
            sourceHash: null,
        });
        expect(await t.fireTimer()).toBeGreaterThan(0);
        expect(t.timers[0]?.delayMs).toBeGreaterThan(5_000);

        t.bucketOptions.putStatus = undefined;
        await t.fireTimer();
        expect(t.statuses.get(record.ID)).toMatchObject({
            phase: "idle",
            lastError: null,
            sourceHash: "v1",
        });
    });

    it("rejects a manual backup with the failure and doesn't retry refusals", async () => {
        const record = destination();
        const t = setup([record]);
        t.stored.set(record.ID, {
            sourceHash: "v1",
            lastSuccessAt: 1,
            lastError: null,
            pruneError: null,
        });
        t.bucketOptions.putStatus = 403;
        await t.scheduler.start();
        await expect(t.scheduler.backupNow(record.ID)).rejects.toMatchObject({
            code: "ACCESS_DENIED",
        });
        expect(t.timers).toHaveLength(0);
        expect(t.stored.get(record.ID)?.lastError?.message).toMatch(
            /refused the access key/,
        );
    });

    it("uploads again when a save lands during an upload", async () => {
        const record = destination();
        const t = setup([record]);
        await t.scheduler.start();
        let release = () => {};
        t.putGate.wait = new Promise((resolve) => (release = resolve));
        const upload = t.fireTimer();
        await new Promise((resolve) => setTimeout(resolve, 20));
        t.vault.source = "v2";
        t.scheduler.markDirty();
        release();
        await upload;
        expect(t.stored.get(record.ID)?.sourceHash).toBe("v1");
        expect(t.statuses.get(record.ID)?.phase).toBe("scheduled");
        t.putGate.wait = undefined;
        await t.fireTimer();
        expect(t.stored.get(record.ID)?.sourceHash).toBe("v2");
        expect(t.vault.created).toBe(2);
    });

    it("skips a destination paused while an earlier upload ran", async () => {
        const first = destination();
        const second = destination();
        const t = setup([first, second]);
        await t.scheduler.start();
        let release = () => {};
        t.putGate.wait = new Promise((resolve) => (release = resolve));
        const upload = t.fireTimer();
        await new Promise((resolve) => setTimeout(resolve, 20));
        t.vault.destinations = [
            first,
            updateBackupDestinationRecord(second, { Paused: true }),
        ];
        release();
        await upload;
        expect(t.stored.get(first.ID)?.sourceHash).toBe("v1");
        expect(t.stored.get(second.ID)).toBeUndefined();
    });

    it("doesn't wait for a request left over from a stopped session", async () => {
        const record = destination();
        const t = setup([record]);
        await t.scheduler.start();
        t.putGate.wait = new Promise(() => {});
        void t.fireTimer();
        await new Promise((resolve) => setTimeout(resolve, 20));
        t.scheduler.stop();

        t.putGate.wait = undefined;
        await t.scheduler.start();
        await t.fireTimer();
        expect(t.stored.get(record.ID)?.sourceHash).toBe("v1");
    });

    it("doesn't let a request from a stopped session delete newer backups", async () => {
        const record = { ...destination(), KeepAll: false };
        const t = setup([record]);
        await t.scheduler.start();
        let release = () => {};
        t.putGate.wait = new Promise((resolve) => (release = resolve));
        const stale = t.scheduler.replaceAfterSecurityChange(true);
        await new Promise((resolve) => setTimeout(resolve, 20));
        t.scheduler.stop();

        t.putGate.wait = undefined;
        t.vault.source = "v2";
        await t.scheduler.start();
        await t.fireTimer();
        release();
        await stale;
        expect(t.bucket.objects.size).toBe(2);
    });

    it("only retries destinations whose retry is due", async () => {
        const failing = destination();
        const refused = updateBackupDestinationRecord(destination(), {
            Bucket: "missing-bucket",
        });
        const t = setup([failing, refused]);
        t.bucketOptions.putStatus = 503;
        await t.scheduler.start();
        await t.fireTimer();
        const refusedAt = t.stored.get(refused.ID)?.lastError?.at;
        expect(t.statuses.get(refused.ID)?.retryAt).toBeNull();

        await new Promise((resolve) => setTimeout(resolve, 5));
        await t.fireTimer();
        expect(t.stored.get(refused.ID)?.lastError?.at).toBe(refusedAt);
        expect(t.stored.get(failing.ID)?.lastError?.at).toBeGreaterThan(
            refusedAt!,
        );
    });

    it("keeps a pending upload of a newer save when a destination fails", async () => {
        const first = destination();
        const second = destination();
        const t = setup([first, second]);
        await t.scheduler.start();
        await t.fireTimer();

        t.vault.source = "v2";
        t.scheduler.markDirty();
        let release = () => {};
        t.putGate.wait = new Promise((resolve) => (release = resolve));
        const upload = t.fireTimer();
        await new Promise((resolve) => setTimeout(resolve, 20));
        t.vault.source = "v3";
        t.scheduler.markDirty();
        t.failing.add(first.ID);
        release();
        await upload;

        t.putGate.wait = undefined;
        await t.fireTimer();
        expect(t.stored.get(second.ID)?.sourceHash).toBe("v3");
    });

    it("keeps retrying others after a manual backup of a current destination fails", async () => {
        const current = destination();
        const behind = destination();
        const t = setup([current, behind]);
        t.failing.add(behind.ID);
        await t.scheduler.start();
        await t.fireTimer();
        // A second failure puts the next retry 10 s out.
        await t.fireTimer();

        t.failing.add(current.ID);
        await expect(t.scheduler.backupNow(current.ID)).rejects.toThrow();
        await t.fireTimer();
        expect(t.timers).toHaveLength(1);

        t.failing.clear();
        await t.fireTimer();
        expect(t.stored.get(behind.ID)?.sourceHash).toBe("v1");
    });

    it("drops a run that was waiting behind an upload when the vault locks", async () => {
        const record = destination();
        const t = setup([record]);
        await t.scheduler.start();
        let release = () => {};
        t.putGate.wait = new Promise((resolve) => (release = resolve));
        const first = t.fireTimer();
        await new Promise((resolve) => setTimeout(resolve, 20));
        t.vault.source = "v2";
        const waiting = t.scheduler.backupNow(record.ID);
        t.scheduler.stop();
        release();
        await Promise.all([first, waiting]);
        expect(t.vault.created).toBe(1);
    });

    it("stops retrying once a retryable error turns into a refusal", async () => {
        const record = destination();
        const t = setup([record]);
        t.bucketOptions.putStatus = 503;
        await t.scheduler.start();
        await t.fireTimer();
        expect(t.timers).toHaveLength(1);
        t.bucketOptions.putStatus = 403;
        await t.fireTimer();
        expect(t.timers).toHaveLength(0);
        expect(t.statuses.get(record.ID)).toMatchObject({
            phase: "error",
            retryAt: null,
        });
    });

    it("deletes this device's older backups once the replacement uploads", async () => {
        const record = { ...destination(), KeepAll: false };
        const t = setup([record]);
        await t.scheduler.start();
        await t.fireTimer();
        await new Promise((resolve) => setTimeout(resolve, 5));
        t.vault.source = "v2";
        t.scheduler.markDirty();
        await t.fireTimer();
        expect(t.bucket.objects.size).toBe(2);

        await new Promise((resolve) => setTimeout(resolve, 5));
        t.vault.source = "v3";
        t.bucketOptions.putStatus = 503;
        await t.scheduler.replaceAfterSecurityChange(true);
        expect(t.bucket.objects.size).toBe(2);

        t.bucketOptions.putStatus = undefined;
        await t.fireTimer();
        expect([...t.bucket.objects.values()]).toEqual([
            new TextEncoder().encode("v3"),
        ]);
    });

    it("still deletes older backups after the vault locks before the replacement uploads", async () => {
        const record = { ...destination(), KeepAll: false };
        const t = setup([record]);
        await t.scheduler.start();
        await t.fireTimer();
        await new Promise((resolve) => setTimeout(resolve, 5));
        t.vault.source = "v2";
        t.bucketOptions.putStatus = 503;
        await t.scheduler.replaceAfterSecurityChange(true);
        t.scheduler.stop();

        t.bucketOptions.putStatus = undefined;
        await t.scheduler.start();
        await t.fireTimer();
        expect([...t.bucket.objects.values()]).toEqual([
            new TextEncoder().encode("v2"),
        ]);
    });

    it("deletes older backups even when the new vault was already uploaded", async () => {
        const record = { ...destination(), KeepAll: false };
        const t = setup([record]);
        await t.scheduler.start();
        await t.fireTimer();
        await new Promise((resolve) => setTimeout(resolve, 5));
        t.vault.source = "v2";
        t.scheduler.markDirty();
        await t.fireTimer();
        expect(t.bucket.objects.size).toBe(2);

        await new Promise((resolve) => setTimeout(resolve, 5));
        await t.scheduler.replaceAfterSecurityChange(true);
        expect([...t.bucket.objects.values()]).toEqual([
            new TextEncoder().encode("v2"),
        ]);
        expect(t.stored.get(record.ID)?.deleteOlder).toBe(false);
    });

    it("retries a failed deletion of older backups", async () => {
        const record = { ...destination(), KeepAll: false };
        const t = setup([record]);
        await t.scheduler.start();
        await t.fireTimer();
        await new Promise((resolve) => setTimeout(resolve, 5));
        t.vault.source = "v2";
        t.bucketOptions.deleteStatus = 503;
        await t.scheduler.replaceAfterSecurityChange(true);
        expect(t.bucket.objects.size).toBe(2);
        expect(t.stored.get(record.ID)?.deleteOlder).toBe(true);

        t.bucketOptions.deleteStatus = undefined;
        await new Promise((resolve) => setTimeout(resolve, 5));
        await t.fireTimer();
        expect(t.bucket.objects.size).toBe(1);
        expect(t.stored.get(record.ID)?.deleteOlder).toBe(false);
    });

    it("deletes nothing when the destination switches to keeping everything during the upload", async () => {
        const record = updateBackupDestinationRecord(destination(), {
            KeepAll: false,
        });
        const t = setup([record]);
        t.bucket.objects.set(
            `${record.ID}/${t.deviceID}/2020-01-01T00-00-00-000Z.cryx`,
            new Uint8Array([1]),
        );
        await t.scheduler.start();
        let release = () => {};
        t.putGate.wait = new Promise((resolve) => (release = resolve));
        const upload = t.fireTimer();
        await new Promise((resolve) => setTimeout(resolve, 20));
        t.vault.destinations = [
            updateBackupDestinationRecord(record, { KeepAll: true }),
        ];
        release();
        await upload;
        expect(t.bucket.objects.size).toBe(2);
    });
});
