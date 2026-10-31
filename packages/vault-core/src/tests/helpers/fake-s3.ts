import { expect } from "@jest/globals";

import type { S3Fetch } from "../../vault-utils/s3-client";

/** In-memory path-style S3. Set putStatus or deleteStatus on the options to fail those requests. */
export function fakeBucket(
    options: {
        denyDelete?: boolean;
        putStatus?: number;
        deleteStatus?: number;
    } = {},
) {
    const objects = new Map<string, Uint8Array>();
    const fetchImpl: S3Fetch = async (url, init) => {
        const method = init.method ?? "GET";
        expect(new Headers(init.headers).get("Authorization")).toMatch(
            /^AWS4-HMAC-SHA256 Credential=GK123\//,
        );
        const parsed = new URL(url);
        const [, bucket, ...rest] = parsed.pathname.split("/");
        if (bucket !== "vault-backups") {
            return new Response("<Error><Code>NoSuchBucket</Code></Error>", {
                status: 404,
            });
        }
        const key = rest.map(decodeURIComponent).join("/");
        if (method === "PUT") {
            if (options.putStatus) {
                return new Response("<Error><Code>SlowDown</Code></Error>", {
                    status: options.putStatus,
                });
            }
            objects.set(key, new Uint8Array(init.body as Uint8Array));
            return new Response(null, { status: 200 });
        }
        if (method === "DELETE") {
            if (options.deleteStatus) {
                return new Response("<Error><Code>SlowDown</Code></Error>", {
                    status: options.deleteStatus,
                });
            }
            if (options.denyDelete) {
                return new Response(
                    "<Error><Code>AccessDenied</Code></Error>",
                    { status: 403 },
                );
            }
            objects.delete(key);
            return new Response(null, { status: 204 });
        }
        if (parsed.searchParams.get("list-type") === "2") {
            const prefix = parsed.searchParams.get("prefix") ?? "";
            const contents = [...objects.keys()]
                .filter((name) => name.startsWith(prefix))
                .sort()
                .map(
                    (name) =>
                        `<Contents><Key>${name}</Key><Size>${objects.get(name)!.byteLength}</Size></Contents>`,
                )
                .join("");
            return new Response(
                `<?xml version="1.0"?><ListBucketResult>${contents}<IsTruncated>false</IsTruncated></ListBucketResult>`,
            );
        }
        const body = objects.get(key);
        return body
            ? new Response(new Uint8Array(body))
            : new Response("<Error><Code>NoSuchKey</Code></Error>", {
                  status: 404,
              });
    };
    return { objects, fetchImpl };
}
