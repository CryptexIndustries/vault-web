/**
 * Client-side `fetch` shim that hands every tRPC request to the SW.
 *
 * The popup/link contexts deliberately do not keep the Online Services
 * session token in their own memory: a popup close would wipe it and a
 * link page reload would force the user to re-authenticate. Instead we
 * hand the SW the bare request and the SW alone decides whether to inject
 * the Authorization header (see `background/request-auth-interceptor.ts`).
 *
 * This file is just the `fetch`-compatible adapter on top of the
 * generic envelope client (`sw-envelope-client.ts`). All the envelope /
 * crypto / STALE_KEY plumbing lives there.
 */

import {
    MessageType,
    ProxyFetchRequestPayload,
    ProxyFetchResponsePayload,
} from "../types/sw-messaging";
import { sendEncryptedEnvelopeToSW } from "./sw-envelope-client";

function buildHeadersRecord(init?: RequestInit): Record<string, string> {
    const headersInit = init?.headers;
    if (!headersInit) return {};

    if (headersInit instanceof Headers) {
        const out: Record<string, string> = {};
        headersInit.forEach((value, name) => {
            out[name] = value;
        });
        return out;
    }
    if (Array.isArray(headersInit)) {
        const out: Record<string, string> = {};
        for (const [name, value] of headersInit) {
            if (typeof name === "string" && typeof value === "string") {
                out[name] = value;
            }
        }
        return out;
    }
    return { ...(headersInit as Record<string, string>) };
}

async function normalizeBody(init?: RequestInit): Promise<string | null> {
    const body = init?.body;
    if (body == null) return null;
    if (typeof body === "string") return body;
    if (body instanceof Blob) return await body.text();
    if (body instanceof ArrayBuffer) {
        return new TextDecoder().decode(body);
    }
    if (ArrayBuffer.isView(body)) {
        // tRPC never sends binary, but stay defensive.
        return new TextDecoder().decode(
            new Uint8Array(
                body.buffer as ArrayBuffer,
                body.byteOffset,
                body.byteLength,
            ),
        );
    }
    return String(body);
}

/**
 * Drop-in `fetch` for tRPC's `httpBatchLink({fetch})`. Routes the call
 * through the SW so the SW alone owns the Authorization header.
 */
export async function swProxyFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
): Promise<Response> {
    const url =
        typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;
    const payload: ProxyFetchRequestPayload = {
        url,
        method: init?.method ?? "GET",
        headers: buildHeadersRecord(init),
        body: await normalizeBody(init),
    };

    const result = await sendEncryptedEnvelopeToSW<ProxyFetchResponsePayload>(
        MessageType.ProxyFetch,
        payload as unknown as object,
    );

    if (!result.ok) {
        throw new Error(`Proxy fetch failed: ${result.error}`);
    }

    const response = result.payload;
    if (response.error) {
        // SW couldn't even attempt the fetch (or it threw). Surface as a
        // network-style error to mirror what `fetch` itself would do.
        throw new Error(`Proxy fetch failed: ${response.error}`);
    }

    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: new Headers(response.headers),
    });
}
