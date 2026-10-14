/**
 * HTTP client for the share server (`services/cmd/share-server`).
 *
 * The API lives under `/share-api/v1` on the same origin that serves the
 * `/s/<id>` recipient page, so a link names its own server. Tokens travel in
 * POST bodies, never in URLs, to keep them out of access logs.
 */

import { z } from "zod";
import { base64UrlToUint8, uint8ToBase64Url } from "../encoding";
import { SHARE_API_PATH, hashShareToken } from "./share-link";

export type ShareServerAuth =
    | { kind: "ticket"; ticket: string }
    | { kind: "token"; token: string };

export const shareStatusSchema = z.enum([
    "active",
    "viewed",
    "expired",
    "revoked",
    "burned",
    "unknown",
]);
export type ShareStatus = z.infer<typeof shareStatusSchema>;

const createResponseSchema = z.object({
    id: z.string(),
    expiresAt: z.number(),
});

const peekResponseSchema = z.object({
    passphrase: z.boolean(),
    expiresAt: z.number(),
});

const revealResponseSchema = z.object({ ciphertext: z.string() });

const statusReportSchema = z.object({
    id: z.string(),
    status: shareStatusSchema,
    expiresAt: z.number().nullable(),
    viewedAt: z.number().nullable(),
});
export type ShareStatusReport = z.infer<typeof statusReportSchema>;

const statusResponseSchema = z.object({
    shares: z.array(statusReportSchema),
});

const infoResponseSchema = z.object({
    version: z.literal(1),
    auth: z.enum(["ticket", "token"]),
    maxBytes: z.number(),
    maxTtl: z.number(),
});
export type ShareServerInfo = z.infer<typeof infoResponseSchema>;

const errorBodySchema = z.object({
    error: z.string(),
    attemptsLeft: z.number().optional(),
});

export type ShareServerErrorCode =
    | "unauthorized"
    | "forbidden"
    | "gone"
    | "wrong_passphrase"
    | "too_large"
    | "limit_reached"
    | "rate_limited"
    | "bad_request"
    | "unavailable";

export class ShareServerError extends Error {
    constructor(
        public readonly code: ShareServerErrorCode,
        public readonly status: number,
        public readonly attemptsLeft?: number,
    ) {
        super(`SHARE_SERVER_${code.toUpperCase()}`);
        this.name = "ShareServerError";
    }
}

const knownErrorCodes = new Set<string>([
    "unauthorized",
    "forbidden",
    "gone",
    "wrong_passphrase",
    "too_large",
    "limit_reached",
    "rate_limited",
    "bad_request",
]);

export type ShareClientOptions = {
    fetch?: typeof fetch;
};

export class ShareClient {
    private readonly base: string;
    private readonly fetchImpl: typeof fetch;

    constructor(origin: string, options: ShareClientOptions = {}) {
        this.base = `${new URL(origin).origin}${SHARE_API_PATH}`;
        this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    }

    async info(): Promise<ShareServerInfo> {
        return infoResponseSchema.parse(await this.request("GET", "/info"));
    }

    async create(
        input: {
            ciphertext: Uint8Array;
            peekTokenHash: Uint8Array;
            revealTokenHash: Uint8Array;
            manageToken: Uint8Array;
            ttlSeconds: number;
            passphrase: boolean;
        },
        auth: ShareServerAuth,
    ): Promise<{ id: string; expiresAt: number }> {
        const body = {
            ciphertext: uint8ToBase64Url(input.ciphertext),
            peekTokenHash: uint8ToBase64Url(input.peekTokenHash),
            revealTokenHash: uint8ToBase64Url(input.revealTokenHash),
            manageTokenHash: uint8ToBase64Url(
                hashShareToken(input.manageToken),
            ),
            ttl: input.ttlSeconds,
            passphrase: input.passphrase,
        };
        const authorization =
            auth.kind === "ticket"
                ? `Ticket ${auth.ticket}`
                : `Bearer ${auth.token}`;
        return createResponseSchema.parse(
            await this.request("POST", "/shares", body, authorization),
        );
    }

    async peek(
        id: string,
        peekToken: Uint8Array,
    ): Promise<z.infer<typeof peekResponseSchema>> {
        return peekResponseSchema.parse(
            await this.request(
                "POST",
                `/shares/${encodeURIComponent(id)}/peek`,
                {
                    peekToken: uint8ToBase64Url(peekToken),
                },
            ),
        );
    }

    /** Releases the ciphertext. The server deletes it in the same step. */
    async reveal(
        id: string,
        peekToken: Uint8Array,
        revealToken: Uint8Array,
    ): Promise<Uint8Array> {
        const response = revealResponseSchema.parse(
            await this.request(
                "POST",
                `/shares/${encodeURIComponent(id)}/reveal`,
                {
                    peekToken: uint8ToBase64Url(peekToken),
                    revealToken: uint8ToBase64Url(revealToken),
                },
            ),
        );
        return base64UrlToUint8(response.ciphertext);
    }

    async status(
        shares: { id: string; manageToken: Uint8Array }[],
    ): Promise<z.infer<typeof statusResponseSchema>["shares"]> {
        if (shares.length === 0) return [];
        return statusResponseSchema.parse(
            await this.request("POST", "/shares/status", {
                shares: shares.map((share) => ({
                    id: share.id,
                    manageToken: uint8ToBase64Url(share.manageToken),
                })),
            }),
        ).shares;
    }

    /**
     * Ends the share and returns its status afterwards: "revoked", or what it
     * already was ("viewed" if the recipient opened it a moment earlier).
     */
    async revoke(
        id: string,
        manageToken: Uint8Array,
    ): Promise<ShareStatusReport> {
        return statusReportSchema.parse(
            await this.request(
                "POST",
                `/shares/${encodeURIComponent(id)}/revoke`,
                { manageToken: uint8ToBase64Url(manageToken) },
            ),
        );
    }

    private async request(
        method: "GET" | "POST",
        path: string,
        body?: unknown,
        authorization?: string,
    ): Promise<unknown> {
        const headers: Record<string, string> = { Accept: "application/json" };
        if (body !== undefined) headers["Content-Type"] = "application/json";
        if (authorization) headers.Authorization = authorization;
        let response: Response;
        try {
            response = await this.fetchImpl(`${this.base}${path}`, {
                method,
                headers,
                body: body === undefined ? undefined : JSON.stringify(body),
                cache: "no-store",
                credentials: "omit",
                referrerPolicy: "no-referrer",
            });
        } catch {
            throw new ShareServerError("unavailable", 0);
        }
        if (response.status === 204) return null;
        const json: unknown = await response.json().catch(() => null);
        if (response.ok) return json;
        const parsed = errorBodySchema.safeParse(json);
        const code =
            parsed.success && knownErrorCodes.has(parsed.data.error)
                ? (parsed.data.error as ShareServerErrorCode)
                : response.status >= 500
                  ? "unavailable"
                  : "bad_request";
        throw new ShareServerError(
            code,
            response.status,
            parsed.success ? parsed.data.attemptsLeft : undefined,
        );
    }
}
