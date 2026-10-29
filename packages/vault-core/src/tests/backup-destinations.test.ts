/**
 * @jest-environment node
 */
import { describe, expect, it } from "@jest/globals";
import { webcrypto } from "crypto";

Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    writable: true,
});

import { KeyEnvelope } from "../proto/vault";
import {
    BACKUP_DESTINATION_TOMBSTONE_VERSION_BUMP,
    applyBackupDestinationChange,
    backupObjectKey,
    backupSourceHash,
    createBackupDestinationRecord,
    createBackupDeviceID,
    mergeReceivedBackupDestinations,
    parseBackupObjectKey,
    tombstoneBackupDestinationRecord,
    updateBackupDestinationRecord,
    validateBackupDestinationInput,
    type BackupDestinationInput,
} from "../vault-utils/backup-destinations";
import { Vault } from "../vault-utils/vault";
import {
    listBackupsInDestination,
    testBackupDestination,
    uploadToBackupDestination,
} from "../vault-utils/backup-destination-transfers";
import {
    parseListObjectsV2,
    s3ObjectUrl,
    S3Error,
    type S3Fetch,
} from "../vault-utils/s3-client";
import { fakeBucket } from "./helpers/fake-s3";

const input = (
    overrides: Partial<BackupDestinationInput> = {},
): BackupDestinationInput => ({
    Name: "Garage",
    Endpoint: "https://s3.example.com",
    Region: "garage",
    Bucket: "vault-backups",
    Prefix: "cryptex/",
    PathStyle: true,
    AccessKeyID: "GK123",
    SecretAccessKey: "secret",
    KeepAll: false,
    ...overrides,
});

const destination = (overrides: Partial<BackupDestinationInput> = {}) => {
    const result = validateBackupDestinationInput(input(overrides));
    if (!result.ok) throw new Error(result.message);
    return createBackupDestinationRecord(result.value, 1_000);
};

describe("backup destination input", () => {
    it("normalizes the endpoint, region and prefix", () => {
        const result = validateBackupDestinationInput(
            input({
                Endpoint: " https://s3.example.com/ ",
                Region: "",
                Prefix: "/backups//vault",
            }),
        );
        expect(result).toMatchObject({
            ok: true,
            value: {
                Endpoint: "https://s3.example.com",
                Region: "us-east-1",
                Prefix: "backups/vault/",
            },
        });
    });

    it.each([
        ["Endpoint", { Endpoint: "http://s3.example.com" }],
        ["Endpoint", { Endpoint: "https://s3.example.com/path" }],
        ["Prefix", { Prefix: "a/../b" }],
    ] satisfies [string, Partial<BackupDestinationInput>][])(
        "rejects a bad %s",
        (field, overrides) => {
            expect(
                validateBackupDestinationInput(input(overrides)),
            ).toMatchObject({
                ok: false,
                field,
            });
        },
    );

    it("allows plain http for local development hosts", () => {
        expect(
            validateBackupDestinationInput(
                input({ Endpoint: "http://localhost:9000" }),
            ).ok,
        ).toBe(true);
    });
});

describe("backup destination records", () => {
    it("bumps the version only when something changed", () => {
        const record = destination();
        expect(updateBackupDestinationRecord(record, { Name: "Garage" })).toBe(
            record,
        );
        const paused = updateBackupDestinationRecord(
            record,
            { Paused: true },
            2_000,
        );
        expect(paused).toMatchObject({
            Paused: true,
            Version: 1,
            DateModifiedTimestamp: 2_000,
        });
        expect(paused.Hash).not.toBe(record.Hash);
    });

    it("drops the keys from a tombstone, and a tombstone wins merges", () => {
        const record = destination();
        const tombstone = tombstoneBackupDestinationRecord(record, 2_000);
        expect(tombstone).toMatchObject({
            Deleted: true,
            AccessKeyID: "",
            SecretAccessKey: "",
            Version: BACKUP_DESTINATION_TOMBSTONE_VERSION_BUMP,
        });

        const edited = updateBackupDestinationRecord(record, { KeepAll: true });
        expect(mergeReceivedBackupDestinations([edited], [tombstone])).toEqual([
            tombstone,
        ]);
        const revived = { ...edited, Version: tombstone.Version + 1 };
        expect(mergeReceivedBackupDestinations([tombstone], [revived])).toEqual(
            [tombstone],
        );
    });

    it("ignores invalid incoming records", () => {
        const bad = { ...destination(), ID: "other", Endpoint: "ftp://x" };
        expect(mergeReceivedBackupDestinations([], [bad])).toEqual([]);
        // The ID becomes a folder name in object URLs.
        const traversal = { ...destination(), ID: "../../other-bucket" };
        expect(mergeReceivedBackupDestinations([], [traversal])).toEqual([]);
    });

    it("applies a change to the records as they are now", () => {
        const opened = destination();
        // Another device paused it and bumped the version meanwhile.
        const synced = updateBackupDestinationRecord(
            updateBackupDestinationRecord(opened, { Paused: true }, 2_000),
            { Name: "NAS" },
            3_000,
        );
        const [edited] = applyBackupDestinationChange(
            [synced],
            {
                type: "edit",
                id: opened.ID,
                input: { ...input(), KeepAll: true },
            },
            4_000,
        );
        expect(edited).toMatchObject({
            Paused: true,
            KeepAll: true,
            Version: synced.Version + 1,
        });
        const tombstone = tombstoneBackupDestinationRecord(opened);
        expect(
            applyBackupDestinationChange([tombstone], {
                type: "edit",
                id: opened.ID,
                input: input(),
            }),
        ).toEqual([tombstone]);
        expect(() =>
            applyBackupDestinationChange([opened], {
                type: "edit",
                id: opened.ID,
                input: { ...input(), Bucket: "" },
            }),
        ).toThrow();
    });
});

describe("backup object keys", () => {
    it("round-trips through the parser", () => {
        const record = destination();
        const deviceID = createBackupDeviceID("android");
        const key = backupObjectKey(record, deviceID, Date.UTC(2026, 9, 26));
        expect(key).toBe(
            `cryptex/${record.ID}/${deviceID}/2026-10-26T00-00-00-000Z.cryx`,
        );
        expect(parseBackupObjectKey("cryptex/", { key, size: 9 })).toEqual({
            key,
            destinationID: record.ID,
            deviceID,
            platform: "android",
            createdAt: Date.UTC(2026, 9, 26),
            size: 9,
        });
    });

    it("ignores files it didn't write", () => {
        const record = destination();
        const deviceID = createBackupDeviceID("web");
        for (const key of [
            `cryptex/${record.ID}/${deviceID}/notes.txt`,
            `cryptex/${record.ID}/connection-test-x`,
            `other/${record.ID}/${deviceID}/2026-10-26T00-00-00-000Z.cryx`,
        ]) {
            expect(parseBackupObjectKey("cryptex/", { key, size: 1 })).toBe(
                null,
            );
        }
    });
});

describe("S3 client", () => {
    it("builds path-style and virtual-hosted URLs", () => {
        expect(
            s3ObjectUrl(
                {
                    Endpoint: "https://s3.example.com",
                    Bucket: "b",
                    PathStyle: true,
                },
                "a b/c(1).cryx",
                { "list-type": "2", prefix: "a b/" },
            ),
        ).toBe(
            "https://s3.example.com/b/a%20b/c%281%29.cryx?list-type=2&prefix=a%20b%2F",
        );
        expect(
            s3ObjectUrl(
                {
                    Endpoint: "https://s3.eu-central-1.amazonaws.com",
                    Bucket: "b",
                    PathStyle: false,
                },
                "k",
            ),
        ).toBe("https://b.s3.eu-central-1.amazonaws.com/k");
        for (const Endpoint of ["http://127.0.0.1:3900", "http://[::1]:3900"]) {
            expect(
                s3ObjectUrl({ Endpoint, Bucket: "b", PathStyle: false }, "k"),
            ).toBe(`${Endpoint}/b/k`);
        }
    });

    it("parses list pages and XML entities", () => {
        expect(
            parseListObjectsV2(
                `<ListBucketResult><Contents><Key>a&amp;b</Key><Size>3</Size><LastModified>2026-10-26T00:00:00.000Z</LastModified></Contents><IsTruncated>true</IsTruncated><NextContinuationToken>t&#x2F;1</NextContinuationToken></ListBucketResult>`,
            ),
        ).toEqual({
            objects: [{ key: "a&b", size: 3 }],
            nextContinuationToken: "t/1",
        });
        expect(() => parseListObjectsV2("<html></html>")).toThrow(S3Error);
    });

    it("maps service errors", async () => {
        const record = destination({ Bucket: "missing" });
        await expect(
            listBackupsInDestination(record, fakeBucket().fetchImpl),
        ).rejects.toMatchObject({ code: "NO_SUCH_BUCKET", status: 404 });

        const network: S3Fetch = async () => {
            throw new TypeError("Failed to fetch");
        };
        await expect(
            listBackupsInDestination(destination(), network),
        ).rejects.toMatchObject({ code: "NETWORK", retryable: true });
    });
});

describe("uploads", () => {
    const now = Date.UTC(2026, 9, 27, 12);
    const bytes = new Uint8Array([1]);

    it("thins this device's backups by age and leaves other devices alone", async () => {
        const bucket = fakeBucket();
        const record = destination();
        const mine = createBackupDeviceID("web");
        const other = createBackupDeviceID("extension");
        const seed = (deviceID: string, at: number) =>
            bucket.objects.set(backupObjectKey(record, deviceID, at), bytes);
        seed(other, Date.UTC(2025, 0, 1));
        for (const at of [
            Date.UTC(2025, 9, 1), // over a year old
            Date.UTC(2026, 7, 3), // older in its month
            Date.UTC(2026, 7, 20),
            Date.UTC(2026, 9, 20, 8), // older on its day
            Date.UTC(2026, 9, 20, 18),
            Date.UTC(2026, 9, 27, 1), // within the last day
            Date.UTC(2026, 9, 27, 2),
        ]) {
            seed(mine, at);
        }

        await uploadToBackupDestination(record, mine, bytes, {
            now,
            fetch: bucket.fetchImpl,
        });
        const backups = await listBackupsInDestination(
            record,
            bucket.fetchImpl,
        );
        expect(
            backups.map((backup) => [backup.deviceID, backup.createdAt]),
        ).toEqual([
            [mine, now],
            [mine, Date.UTC(2026, 9, 27, 2)],
            [mine, Date.UTC(2026, 9, 27, 1)],
            [mine, Date.UTC(2026, 9, 20, 18)],
            [mine, Date.UTC(2026, 7, 20)],
            [other, Date.UTC(2025, 0, 1)],
        ]);
    });

    it("deletes all of this device's other backups when asked", async () => {
        const bucket = fakeBucket();
        const record = destination({ KeepAll: true });
        const mine = createBackupDeviceID("web");
        const other = createBackupDeviceID("android");
        // A later file than the new one: the clock went back.
        bucket.objects.set(backupObjectKey(record, mine, now + 60_000), bytes);
        bucket.objects.set(backupObjectKey(record, other, now - 1), bytes);

        const { key } = await uploadToBackupDestination(record, mine, bytes, {
            now,
            fetch: bucket.fetchImpl,
            deleteOlder: true,
        });
        expect([...bucket.objects.keys()].sort()).toEqual(
            [key, backupObjectKey(record, other, now - 1)].sort(),
        );
    });

    it("never deletes another device's backups, even if the listing returns them", async () => {
        const bucket = fakeBucket();
        const record = destination({ KeepAll: true });
        const mine = createBackupDeviceID("web");
        const other = createBackupDeviceID("android");
        bucket.objects.set(backupObjectKey(record, other, now - 1), bytes);
        // A service that ignores the prefix lists the whole bucket.
        const ignorePrefix: typeof bucket.fetchImpl = (url, init) => {
            const parsed = new URL(url);
            parsed.searchParams.delete("prefix");
            return bucket.fetchImpl(parsed.toString(), init);
        };

        await uploadToBackupDestination(record, mine, bytes, {
            now,
            fetch: ignorePrefix,
            deleteOlder: true,
        });
        expect(
            bucket.objects.has(backupObjectKey(record, other, now - 1)),
        ).toBe(true);
    });

    it("reports a failed prune without failing the upload", async () => {
        const bucket = fakeBucket({ denyDelete: true });
        const record = destination();
        const device = createBackupDeviceID("web");
        bucket.objects.set(
            backupObjectKey(record, device, Date.UTC(2024, 0, 1)),
            bytes,
        );
        const result = await uploadToBackupDestination(record, device, bytes, {
            now,
            fetch: bucket.fetchImpl,
        });
        expect(result.pruneError).toMatchObject({ code: "ACCESS_DENIED" });
        expect(bucket.objects.size).toBe(2);
    });

    it("lets the connection test skip delete rights when nothing is pruned", async () => {
        const bucket = fakeBucket({ denyDelete: true });
        await expect(
            testBackupDestination(
                destination({ KeepAll: true }),
                bucket.fetchImpl,
            ),
        ).resolves.toBeUndefined();
        await expect(
            testBackupDestination(destination(), bucket.fetchImpl),
        ).rejects.toMatchObject({ code: "ACCESS_DENIED" });
    });
});

describe("backup source hash", () => {
    const key = "a".repeat(43);

    it("ignores device-local data and counts content and security changes", async () => {
        const vault = new Vault();
        const envelope = KeyEnvelope.fromPartial({ VaultID: "v", Version: 1 });
        const base = await backupSourceHash(vault, envelope, key);

        vault.LinkedDevices.BackupDeviceID = createBackupDeviceID("web");
        expect(await backupSourceHash(vault, envelope, key)).toBe(base);

        expect(
            await backupSourceHash(
                vault,
                { ...envelope, PrimaryProtectionKind: 1 },
                key,
            ),
        ).not.toBe(base);
        expect(
            await backupSourceHash(vault, envelope, "b".repeat(43)),
        ).not.toBe(base);
        vault.BackupDestinations = [destination()];
        expect(await backupSourceHash(vault, envelope, key)).not.toBe(base);
    });
});
