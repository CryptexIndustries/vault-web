/**
 * Minimal S3 client for backup destinations: put, get, delete and list,
 * signed with SigV4 in the device. Works against AWS and S3-compatible
 * services (B2, Wasabi, R2, MinIO, Garage).
 */

import { AwsV4Signer } from "aws4fetch";

import type * as VaultUtilTypes from "../proto/vault";
import { S3Error } from "./s3-errors";

export { S3Error, type S3ErrorCode } from "./s3-errors";

export type S3Location = Pick<
    VaultUtilTypes.BackupDestination,
    | "Endpoint"
    | "Region"
    | "Bucket"
    | "PathStyle"
    | "AccessKeyID"
    | "SecretAccessKey"
>;

export type S3Object = {
    key: string;
    size: number;
};

export type S3Fetch = (url: string, init: RequestInit) => Promise<Response>;

/**
 * A stalled request would otherwise hold up every later backup. Allow a
 * minute plus time for the body at a slow 16 KiB/s, so large vaults on poor
 * connections still get through. Sizes come from bucket listings, so treat
 * nonsense as zero and cap the wait at an hour.
 */
const requestTimeoutMs = (byteLength: number): number =>
    Number.isFinite(byteLength) && byteLength > 0
        ? Math.min(60_000 + Math.ceil(byteLength / 16_384) * 1_000, 3_600_000)
        : 60_000;

/** encodeURIComponent plus the characters SigV4 also escapes. */
const encodeRfc3986 = (value: string): string =>
    encodeURIComponent(value).replace(
        /[!'()*]/g,
        (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
    );

const encodeKey = (key: string): string =>
    key.split("/").map(encodeRfc3986).join("/");

export function s3ObjectUrl(
    location: Pick<S3Location, "Endpoint" | "Bucket" | "PathStyle">,
    key: string,
    query: Record<string, string> = {},
): string {
    const endpoint = new URL(location.Endpoint);
    const path = encodeKey(key);
    // "bucket.127.0.0.1" isn't a host, so an IP address endpoint is always
    // path-style.
    const ipAddress =
        endpoint.hostname.startsWith("[") ||
        /^\d+\.\d+\.\d+\.\d+$/.test(endpoint.hostname);
    const base =
        location.PathStyle || ipAddress
            ? `${endpoint.origin}/${encodeRfc3986(location.Bucket)}/${path}`
            : `${endpoint.protocol}//${location.Bucket}.${endpoint.host}/${path}`;
    // Built by hand: URLSearchParams writes spaces as "+", which S3 and the
    // signer would read differently.
    const search = Object.entries(query)
        .map(
            ([name, value]) => `${encodeRfc3986(name)}=${encodeRfc3986(value)}`,
        )
        .join("&");
    return search ? `${base}?${search}` : base;
}

const XML_ENTITIES: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
};

const decodeXml = (value: string): string =>
    value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
        if (entity[0] === "#") {
            const codePoint =
                entity[1] === "x" || entity[1] === "X"
                    ? Number.parseInt(entity.slice(2), 16)
                    : Number.parseInt(entity.slice(1), 10);
            return codePoint <= 0x10ffff
                ? String.fromCodePoint(codePoint)
                : match;
        }
        return XML_ENTITIES[entity] ?? match;
    });

// Service workers and React Native have no DOMParser, and these responses
// are flat, so tag matching is enough.
const xmlTag = (xml: string, tag: string): string | null => {
    const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(xml);
    return match ? decodeXml(match[1] ?? "") : null;
};

const xmlBlocks = (xml: string, tag: string): string[] =>
    Array.from(
        xml.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g")),
        (match) => match[1] ?? "",
    );

export function parseListObjectsV2(xml: string): {
    objects: S3Object[];
    nextContinuationToken: string | null;
} {
    if (!xml.includes("<ListBucketResult")) {
        throw new S3Error("INVALID_RESPONSE");
    }
    const objects = xmlBlocks(xml, "Contents").map((block) => {
        const key = xmlTag(block, "Key");
        if (key == null) throw new S3Error("INVALID_RESPONSE");
        return { key, size: Number(xmlTag(block, "Size") ?? 0) };
    });
    const truncated = xmlTag(xml, "IsTruncated") === "true";
    const nextContinuationToken = truncated
        ? xmlTag(xml, "NextContinuationToken")
        : null;
    if (truncated && !nextContinuationToken) {
        throw new S3Error("INVALID_RESPONSE");
    }
    return { objects, nextContinuationToken };
}

const WRONG_REGION_CODES = new Set([
    "AuthorizationHeaderMalformed",
    "PermanentRedirect",
    "IllegalLocationConstraintException",
]);

async function errorFromResponse(response: Response): Promise<S3Error> {
    const body = await response.text().catch(() => "");
    const s3Code = xmlTag(body, "Code");
    const options = { status: response.status };
    if (s3Code === "RequestTimeTooSkewed") {
        return new S3Error("CLOCK_SKEW", options);
    }
    if (s3Code === "NoSuchBucket")
        return new S3Error("NO_SUCH_BUCKET", options);
    if (s3Code === "NoSuchKey") return new S3Error("NOT_FOUND", options);
    if ((s3Code && WRONG_REGION_CODES.has(s3Code)) || response.status === 301) {
        return new S3Error("WRONG_REGION", options);
    }
    if (response.status === 401 || response.status === 403) {
        return new S3Error("ACCESS_DENIED", options);
    }
    if (response.status === 404) return new S3Error("NOT_FOUND", options);
    return new S3Error("REJECTED", options);
}

const hexSha256 = async (bytes: Uint8Array): Promise<string> =>
    Array.from(
        new Uint8Array(
            await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)),
        ),
        (byte) => byte.toString(16).padStart(2, "0"),
    ).join("");

/** Sends a signed request and reads the response, both within the timeout. */
async function send<T>(
    location: S3Location,
    request: {
        method: "GET" | "PUT" | "DELETE";
        key: string;
        query?: Record<string, string>;
        body?: Uint8Array;
        /** Expected response size, for the timeout. */
        responseBytes?: number;
    },
    fetchImpl: S3Fetch,
    read: (response: Response) => Promise<T>,
): Promise<T> {
    const headers: Record<string, string> = {};
    if (request.body) {
        headers["Content-Type"] = "application/octet-stream";
        // Signing the payload hash lets the service reject a corrupted body.
        headers["X-Amz-Content-Sha256"] = await hexSha256(request.body);
    }
    const url = s3ObjectUrl(location, request.key, request.query);
    const signed = await new AwsV4Signer({
        method: request.method,
        url,
        headers,
        accessKeyId: location.AccessKeyID,
        secretAccessKey: location.SecretAccessKey,
        service: "s3",
        region: location.Region,
    }).sign();

    const abort = new AbortController();
    const timeout = setTimeout(
        () => abort.abort(),
        requestTimeoutMs(
            (request.body?.byteLength ?? 0) + (request.responseBytes ?? 0),
        ),
    );
    try {
        let response: Response;
        try {
            // Header signing leaves the URL alone. Send the string we built:
            // React Native's URL re-encodes the query once it has been read.
            response = await fetchImpl(url, {
                method: signed.method,
                headers: signed.headers,
                body: request.body ? new Uint8Array(request.body) : undefined,
                cache: "no-store",
                credentials: "omit",
                signal: abort.signal,
            });
        } catch (cause) {
            throw new S3Error("NETWORK", { cause });
        }
        if (!response.ok) throw await errorFromResponse(response);
        try {
            return await read(response);
        } catch (cause) {
            if (cause instanceof S3Error) throw cause;
            throw new S3Error("NETWORK", { cause });
        }
    } finally {
        clearTimeout(timeout);
    }
}

const ignoreBody = async () => undefined;

const defaultFetch: S3Fetch = (url, init) => fetch(url, init);

export async function putS3Object(
    location: S3Location,
    key: string,
    bytes: Uint8Array,
    fetchImpl: S3Fetch = defaultFetch,
): Promise<void> {
    await send(
        location,
        { method: "PUT", key, body: bytes },
        fetchImpl,
        ignoreBody,
    );
}

export async function getS3Object(
    location: S3Location,
    key: string,
    fetchImpl: S3Fetch = defaultFetch,
    /** Size from the listing, so large downloads get more time. */
    expectedBytes?: number,
): Promise<Uint8Array> {
    return send(
        location,
        { method: "GET", key, responseBytes: expectedBytes },
        fetchImpl,
        async (response) => new Uint8Array(await response.arrayBuffer()),
    );
}

export async function deleteS3Object(
    location: S3Location,
    key: string,
    fetchImpl: S3Fetch = defaultFetch,
): Promise<void> {
    await send(location, { method: "DELETE", key }, fetchImpl, ignoreBody);
}

/** Every object under the prefix, across all result pages. */
export async function listS3Objects(
    location: S3Location,
    prefix: string,
    fetchImpl: S3Fetch = defaultFetch,
): Promise<S3Object[]> {
    const objects: S3Object[] = [];
    const seenTokens = new Set<string>();
    let continuationToken: string | null = null;
    do {
        const query: Record<string, string> = { "list-type": "2", prefix };
        if (continuationToken) query["continuation-token"] = continuationToken;
        const page = await send(
            location,
            { method: "GET", key: "", query },
            fetchImpl,
            async (response) => parseListObjectsV2(await response.text()),
        );
        objects.push(...page.objects);
        continuationToken = page.nextContinuationToken;
        // A service that hands back a token twice would page forever.
        if (continuationToken) {
            if (seenTokens.has(continuationToken)) {
                throw new S3Error("INVALID_RESPONSE");
            }
            seenTokens.add(continuationToken);
        }
    } while (continuationToken);
    return objects;
}
