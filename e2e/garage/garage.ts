/**
 * The throwaway Garage behind the backup destination e2e tests. Host runs
 * start it with startGarage(); the web Compose run starts it itself.
 * Each test makes its own bucket and keys, so tests never see each other's
 * backups.
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { AwsClient } from "aws4fetch";

const ADMIN_TOKEN = "cryptex-e2e-garage-admin";
export const GARAGE_REGION = "garage";

const port = (name: string, fallback: number) =>
    Number(process.env[name] ?? fallback);

/** Plain http, for node and for apps that may use http on loopback. */
export const garageS3Url =
    process.env.E2E_GARAGE_S3_URL ??
    `http://127.0.0.1:${port("E2E_GARAGE_PORT", 3910)}`;
/** https through Caddy, for the web app. Its certificate isn't trusted. */
export const garageTlsUrl =
    process.env.E2E_GARAGE_TLS_URL ??
    `https://127.0.0.1:${port("E2E_GARAGE_TLS_PORT", 3943)}`;
const garageAdminUrl =
    process.env.E2E_GARAGE_ADMIN_URL ??
    `http://127.0.0.1:${port("E2E_GARAGE_ADMIN_PORT", 3913)}`;

/** Garage's root_domain: virtual-hosted requests go to <bucket>.garage.e2e. */
export const GARAGE_DOMAIN = "garage.e2e";

/** The same Garage endpoint addressed by GARAGE_DOMAIN. */
export function virtualHostedUrl(endpoint: string): string {
    const url = new URL(endpoint);
    url.hostname = GARAGE_DOMAIN;
    return url.origin;
}

/**
 * Chromium's --host-resolver-rules value that sends GARAGE_DOMAIN and its
 * bucket subdomains to the host the endpoint uses.
 */
export function garageHostResolverRules(endpoint: string): string {
    const host = new URL(endpoint).hostname;
    return `MAP ${GARAGE_DOMAIN} ${host}, MAP *.${GARAGE_DOMAIN} ${host}`;
}

// Found from the working directory: Playwright loads this file as CommonJS,
// where import.meta isn't available.
function repositoryRoot(): string {
    for (let directory = process.cwd(); ;) {
        if (existsSync(path.join(directory, "compose.e2e.yaml")))
            return directory;
        const parent = path.dirname(directory);
        if (parent === directory)
            throw new Error(
                "compose.e2e.yaml not found above the working directory",
            );
        directory = parent;
    }
}

/**
 * Starts Garage and its TLS proxy on loopback and returns a function that
 * stops them. Does nothing when the Compose run already provides Garage.
 */
export function startGarage(projectName: string): () => void {
    if (process.env.E2E_GARAGE_S3_URL) return () => {};
    const root = repositoryRoot();
    const compose = [
        "compose",
        "--project-name",
        projectName,
        "--file",
        path.join(root, "compose.e2e.yaml"),
        "--file",
        path.join(root, "e2e/garage/compose.host.yaml"),
    ];
    const docker = (...args: string[]) => {
        const run = spawnSync("docker", [...compose, ...args], {
            stdio: "inherit",
        });
        if (run.status !== 0)
            throw new Error(`docker compose ${args.join(" ")} failed`);
    };
    docker("up", "--detach", "--wait", "garage", "garage-tls");
    return () => docker("down", "--remove-orphans");
}

async function admin<T>(operation: string, body: unknown): Promise<T> {
    // Garage can report healthy a moment before its layout is ready.
    for (let attempt = 0; ; attempt += 1) {
        const response = await fetch(`${garageAdminUrl}/v2/${operation}`, {
            method: "POST",
            headers: {
                authorization: `Bearer ${ADMIN_TOKEN}`,
                "content-type": "application/json",
            },
            body: JSON.stringify(body),
        });
        const text = await response.text();
        if (response.ok) return (text ? JSON.parse(text) : null) as T;
        if (response.status < 500 || attempt === 20) {
            throw new Error(
                `Garage ${operation} failed: ${response.status} ${text}`,
            );
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
    }
}

export type GarageKey = { accessKeyId: string; secretAccessKey: string };

export type GarageBucket = {
    name: string;
    /** Can read, write and delete. */
    key: GarageKey;
    /** Can only read and list. */
    readOnlyKey: GarageKey;
    /** Every object name in the bucket under prefix, sorted. */
    list(prefix?: string): Promise<string[]>;
    put(name: string, body: Uint8Array<ArrayBuffer> | string): Promise<void>;
    get(name: string): Promise<Uint8Array<ArrayBuffer>>;
    /** Takes every permission away from the read-write key. */
    revokeKey(): Promise<void>;
    /** Gives the read-write key its permissions back. */
    restoreKey(): Promise<void>;
};

async function createKey(
    bucketId: string,
    name: string,
    write: boolean,
): Promise<GarageKey> {
    const key = await admin<GarageKey>("CreateKey", { name });
    await setKeyAccess("AllowBucketKey", bucketId, key.accessKeyId, write);
    return {
        accessKeyId: key.accessKeyId,
        secretAccessKey: key.secretAccessKey,
    };
}

async function setKeyAccess(
    operation: "AllowBucketKey" | "DenyBucketKey",
    bucketId: string,
    accessKeyId: string,
    write: boolean,
): Promise<void> {
    await admin(operation, {
        bucketId,
        accessKeyId,
        permissions: { read: true, write, owner: write },
    });
}

/** A new empty bucket with its own keys and a CORS rule for browsers. */
export async function createGarageBucket(): Promise<GarageBucket> {
    const name = `e2e-${randomBytes(6).toString("hex")}`;
    const { id } = await admin<{ id: string }>("CreateBucket", {
        globalAlias: name,
    });
    const key = await createKey(id, `${name}-rw`, true);
    const readOnlyKey = await createKey(id, `${name}-ro`, false);
    // Its own key, so checks still work while revokeKey() is in effect.
    const helperKey = await createKey(id, `${name}-helper`, true);

    const s3 = new AwsClient({
        ...helperKey,
        region: GARAGE_REGION,
        service: "s3",
    });
    const request = async (pathAndQuery: string, init?: RequestInit) => {
        const response = await s3.fetch(
            `${garageS3Url}/${name}${pathAndQuery}`,
            init,
        );
        if (!response.ok) {
            throw new Error(
                `Garage ${init?.method ?? "GET"} ${pathAndQuery} failed: ${response.status} ${await response.text()}`,
            );
        }
        return response;
    };
    const objectPath = (object: string) =>
        `/${object.split("/").map(encodeURIComponent).join("/")}`;

    await request("?cors", {
        method: "PUT",
        headers: { "content-type": "application/xml" },
        body: `<CORSConfiguration><CORSRule><AllowedOrigin>*</AllowedOrigin><AllowedMethod>GET</AllowedMethod><AllowedMethod>HEAD</AllowedMethod><AllowedMethod>PUT</AllowedMethod><AllowedMethod>DELETE</AllowedMethod><AllowedHeader>*</AllowedHeader><ExposeHeader>ETag</ExposeHeader></CORSRule></CORSConfiguration>`,
    });

    return {
        name,
        key,
        readOnlyKey,
        async list(prefix = "") {
            const names: string[] = [];
            let token: string | undefined;
            do {
                const query = new URLSearchParams({
                    "list-type": "2",
                    prefix,
                });
                if (token) query.set("continuation-token", token);
                const xml = await (await request(`?${query}`)).text();
                for (const match of xml.matchAll(/<Key>([^<]*)<\/Key>/g))
                    names.push(decodeXml(match[1]!));
                token = /<NextContinuationToken>([^<]*)</.exec(xml)?.[1];
            } while (token);
            return names.sort();
        },
        async put(object, body) {
            await request(objectPath(object), { method: "PUT", body });
        },
        async get(object) {
            const response = await request(objectPath(object));
            return new Uint8Array(await response.arrayBuffer());
        },
        revokeKey: () =>
            setKeyAccess("DenyBucketKey", id, key.accessKeyId, true),
        restoreKey: () =>
            setKeyAccess("AllowBucketKey", id, key.accessKeyId, true),
    };
}

function decodeXml(value: string): string {
    return value
        .replaceAll("&lt;", "<")
        .replaceAll("&gt;", ">")
        .replaceAll("&quot;", '"')
        .replaceAll("&apos;", "'")
        .replaceAll("&amp;", "&");
}
