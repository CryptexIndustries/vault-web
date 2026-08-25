import { createHash } from "node:crypto";
import type { BrowserContext, Request } from "@playwright/test";
import superjson from "superjson";

const OBJECT_STORE_PREFIX = "http://127.0.0.1:4173/e2e-backup-object/";

export type BackupSourceLabel =
    | "Root device"
    | "Linked device"
    | "Removed device";

export type BackupSnapshotRecord = {
    id: string;
    createdAt: Date;
    readyAt: Date | null;
    byteLength: number;
    checksumSha256: string;
    sourceLabel: BackupSourceLabel;
};

type PendingUpload = {
    byteLength: number;
    checksumSha256: string;
};

export type ManagedBackupApiState = {
    enabled: boolean;
    entitled: boolean;
    recoveryConfigured: boolean;
    isRoot: boolean;
    snapshots: BackupSnapshotRecord[];
    objects: Map<string, Uint8Array>;
    pendingUploads: Map<string, PendingUpload>;
    uploadCount: number;
};

type TrpcSuccess = {
    result: {
        data: ReturnType<typeof superjson.serialize>;
    };
};

type TrpcFailure = {
    error: ReturnType<typeof superjson.serialize>;
};

type TrpcItem = TrpcSuccess | TrpcFailure;

function sha256Base64Url(bytes: Uint8Array): string {
    return createHash("sha256")
        .update(bytes)
        .digest("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/g, "");
}

function trpcOk(data: unknown): TrpcSuccess {
    return { result: { data: superjson.serialize(data) } };
}

function trpcErr(message: string, code: string): TrpcFailure {
    return {
        error: superjson.serialize({
            message,
            code,
            data: { code, httpStatus: 400 },
        }),
    };
}

function parseProcedurePaths(urlString: string): string[] {
    const url = new URL(urlString);
    const marker = "/api/trpc/";
    const idx = url.pathname.indexOf(marker);
    if (idx === -1) return [];
    const segment = url.pathname.slice(idx + marker.length);
    if (!segment) return [];
    return decodeURIComponent(segment)
        .split(",")
        .map((path) => path.trim())
        .filter((path) => path.length > 0);
}

function deserializeSuperjsonValue(value: unknown): unknown {
    if (!value || typeof value !== "object" || !("json" in value)) {
        return value;
    }
    return superjson.deserialize(
        value as ReturnType<typeof superjson.serialize>,
    );
}

function parseBatchInputs(raw: string | null): unknown[] {
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
        return parsed.map(deserializeSuperjsonValue);
    }
    if (!parsed || typeof parsed !== "object") return [];
    const record = parsed as Record<string, unknown>;
    return Object.keys(record)
        .sort((left, right) => Number(left) - Number(right))
        .map((key) => deserializeSuperjsonValue(record[key]));
}

function readStringField(value: unknown, key: string): string | undefined {
    if (!value || typeof value !== "object" || !(key in value)) {
        return undefined;
    }
    const field = (value as Record<string, unknown>)[key];
    return typeof field === "string" ? field : undefined;
}

function readNumberField(value: unknown, key: string): number | undefined {
    if (!value || typeof value !== "object" || !(key in value)) {
        return undefined;
    }
    const field = (value as Record<string, unknown>)[key];
    return typeof field === "number" ? field : undefined;
}

function objectStoreUrl(snapshotId: string): string {
    return `${OBJECT_STORE_PREFIX}${encodeURIComponent(snapshotId)}`;
}

function snapshotIdFromObjectUrl(urlString: string): string | null {
    if (!urlString.startsWith(OBJECT_STORE_PREFIX)) return null;
    return decodeURIComponent(urlString.slice(OBJECT_STORE_PREFIX.length));
}

function backupStatus(state: ManagedBackupApiState) {
    const latest = state.snapshots[0] ?? null;
    return {
        enabled: state.enabled,
        entitled: state.entitled,
        graceExpiresAt: null,
        recoveryConfigured: state.recoveryConfigured,
        accountRecoveryProtection: latest ? "protected" : "pending",
        latestReadyAt: latest?.readyAt ?? null,
        versionCount: state.snapshots.length,
        storageBytes: state.snapshots.reduce(
            (sum, snapshot) => sum + snapshot.byteLength,
            0,
        ),
        maxSnapshotBytes: 8 * 1024 * 1024,
        maxAccountBytes: 32 * 1024 * 1024,
        storageConfigured: true,
    };
}

function userConfiguration(state: ManagedBackupApiState) {
    return {
        deviceId: "e2e-device",
        root: state.isRoot,
        canLink: true,
        maxLinks: 5,
        canPromoteDevices: true,
        managedEncryptedBackups: state.entitled,
        passwordSharing: true,
        securityReportBasic: true,
        securityReportAdvanced: true,
        recoveryTokenCreatedAt: new Date("2026-01-01T00:00:00.000Z"),
        recoveryGenerationNeeded: false,
    };
}

function dispatchProcedure(
    state: ManagedBackupApiState,
    path: string,
    input: unknown,
): TrpcItem {
    switch (path) {
        case "v1.backup.status":
            return trpcOk(backupStatus(state));
        case "v1.user.configuration":
            return trpcOk(userConfiguration(state));
        case "v1.backup.list":
            return trpcOk({
                items: [...state.snapshots],
                nextCursor: null,
            });
        case "v1.backup.enable":
            state.enabled = true;
            return trpcOk({ enabled: true as const });
        case "v1.backup.disable":
            state.enabled = false;
            return trpcOk({ enabled: false as const });
        case "v1.backup.createUpload": {
            const byteLength = readNumberField(input, "byteLength");
            const checksumSha256 = readStringField(input, "checksumSha256");
            if (
                byteLength == null ||
                checksumSha256 == null ||
                checksumSha256.length !== 43
            ) {
                return trpcErr("Invalid upload intent", "BAD_REQUEST");
            }
            state.uploadCount += 1;
            const snapshotId = `e2e-snapshot-${state.uploadCount}`;
            state.pendingUploads.set(snapshotId, {
                byteLength,
                checksumSha256,
            });
            return trpcOk({
                snapshotId,
                transfer: {
                    url: objectStoreUrl(snapshotId),
                    expiresAt: new Date(Date.now() + 60_000),
                    headers: { "content-type": "application/octet-stream" },
                },
            });
        }
        case "v1.backup.completeUpload": {
            const snapshotId = readStringField(input, "snapshotId");
            if (!snapshotId) {
                return trpcErr("Missing snapshotId", "BAD_REQUEST");
            }
            const pending = state.pendingUploads.get(snapshotId);
            const bytes = state.objects.get(snapshotId);
            if (!pending || !bytes) {
                return trpcErr("Upload is not ready", "PRECONDITION_FAILED");
            }
            if (
                bytes.byteLength !== pending.byteLength ||
                sha256Base64Url(bytes) !== pending.checksumSha256
            ) {
                return trpcErr("Checksum mismatch", "BAD_REQUEST");
            }
            const createdAt = new Date();
            const snapshot: BackupSnapshotRecord = {
                id: snapshotId,
                createdAt,
                readyAt: createdAt,
                byteLength: bytes.byteLength,
                checksumSha256: pending.checksumSha256,
                sourceLabel: "Root device",
            };
            state.pendingUploads.delete(snapshotId);
            state.snapshots = [snapshot, ...state.snapshots];
            return trpcOk(snapshot);
        }
        case "v1.backup.createDownload": {
            const snapshotId = readStringField(input, "snapshotId");
            const snapshot = state.snapshots.find(
                (item) => item.id === snapshotId,
            );
            if (!snapshotId || !snapshot) {
                return trpcErr("Snapshot not found", "NOT_FOUND");
            }
            return trpcOk({
                snapshot,
                transfer: {
                    url: objectStoreUrl(snapshot.id),
                    expiresAt: new Date(Date.now() + 60_000),
                    headers: {},
                },
            });
        }
        case "v1.backup.delete": {
            const snapshotId = readStringField(input, "snapshotId");
            if (!snapshotId) {
                return trpcErr("Missing snapshotId", "BAD_REQUEST");
            }
            state.snapshots = state.snapshots.filter(
                (item) => item.id !== snapshotId,
            );
            state.objects.delete(snapshotId);
            return trpcOk(true);
        }
        case "v1.backup.deleteAll":
            state.snapshots = [];
            state.objects.clear();
            state.pendingUploads.clear();
            state.enabled = false;
            return trpcOk(true);
        default:
            return trpcErr(`Unhandled procedure ${path}`, "NOT_FOUND");
    }
}

async function handleTrpcRequest(
    state: ManagedBackupApiState,
    request: Request,
): Promise<TrpcItem[]> {
    const paths = parseProcedurePaths(request.url());
    const rawInputs =
        request.method() === "GET"
            ? new URL(request.url()).searchParams.get("input")
            : request.postData();
    const inputs = parseBatchInputs(rawInputs);
    return paths.map((path, index) =>
        dispatchProcedure(state, path, inputs[index]),
    );
}

export function createManagedBackupApiMock(): {
    state: ManagedBackupApiState;
    install: (context: BrowserContext) => Promise<void>;
} {
    const state: ManagedBackupApiState = {
        enabled: true,
        entitled: true,
        recoveryConfigured: true,
        isRoot: true,
        snapshots: [],
        objects: new Map(),
        pendingUploads: new Map(),
        uploadCount: 0,
    };

    return {
        state,
        async install(context: BrowserContext): Promise<void> {
            await context.route("**/api/trpc/**", async (route) => {
                const results = await handleTrpcRequest(state, route.request());
                await route.fulfill({
                    status: 200,
                    contentType: "application/json",
                    body: JSON.stringify(results),
                });
            });

            await context.route("**/e2e-backup-object/**", async (route) => {
                const request = route.request();
                const snapshotId = snapshotIdFromObjectUrl(request.url());
                if (!snapshotId) {
                    await route.fulfill({ status: 404, body: "missing id" });
                    return;
                }

                if (request.method() === "PUT") {
                    const buffer = request.postDataBuffer();
                    if (!buffer) {
                        await route.fulfill({
                            status: 400,
                            body: "empty body",
                        });
                        return;
                    }
                    state.objects.set(snapshotId, new Uint8Array(buffer));
                    await route.fulfill({ status: 200, body: "" });
                    return;
                }

                if (request.method() === "GET") {
                    const bytes = state.objects.get(snapshotId);
                    if (!bytes) {
                        await route.fulfill({ status: 404, body: "missing" });
                        return;
                    }
                    await route.fulfill({
                        status: 200,
                        contentType: "application/octet-stream",
                        body: Buffer.from(bytes),
                    });
                    return;
                }

                await route.fulfill({
                    status: 405,
                    body: "method not allowed",
                });
            });
        },
    };
}
