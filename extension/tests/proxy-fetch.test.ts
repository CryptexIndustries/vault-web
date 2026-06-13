/**
 * @jest-environment node
 */
import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const mockEnsureFreshOnlineServicesSession = jest.fn(async () => undefined);
const mockGetOnlineServicesAuthorizationHeader = jest.fn(
    async () => "Bearer sw-token",
);

jest.mock("../src/env", () => ({
    env: {
        NEXT_PUBLIC_APP_URL: "https://app.example.test/base",
    },
}));

jest.mock("../src/app_lib/auth-session-ext", () => ({
    ensureFreshOnlineServicesSession: mockEnsureFreshOnlineServicesSession,
    getOnlineServicesAuthorizationHeader:
        mockGetOnlineServicesAuthorizationHeader,
}));

import { handleProxyFetch } from "../src/background/request-auth-interceptor";
import {
    isTrpcApiRequest,
    trpcBatchRequiresAuth,
} from "../src/utils/trpc-auth-url";

describe("handleProxyFetch", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        globalThis.fetch = jest.fn(async () => {
            return new Response("ok", {
                status: 200,
                statusText: "OK",
                headers: { "x-test": "1" },
            });
        }) as typeof fetch;
    });

    it("rejects non-tRPC destinations without fetching", async () => {
        const response = await handleProxyFetch({
            url: "https://signaling.example.test/apps/123/events",
            method: "POST",
            headers: {
                Authorization: "Bearer caller-token",
                "content-type": "application/json",
            },
            body: "{}",
        });

        expect(response).toEqual({
            ok: false,
            status: 0,
            statusText: "Proxy fetch destination not allowed",
            headers: {},
            body: "",
            error: "PROXY_FETCH_DESTINATION_NOT_ALLOWED",
        });
        expect(globalThis.fetch).not.toHaveBeenCalled();
        expect(mockEnsureFreshOnlineServicesSession).not.toHaveBeenCalled();
        expect(mockGetOnlineServicesAuthorizationHeader).not.toHaveBeenCalled();
    });

    it("proxies configured tRPC requests with SW-owned authorization", async () => {
        const response = await handleProxyFetch({
            url: "https://app.example.test/base/api/trpc/v1.device.turnCredentials?batch=1",
            method: "POST",
            headers: {
                Authorization: "Bearer caller-token",
                "x-client": "popup",
            },
            body: '{"0":{"json":{"syncId":"sync_1"}}}',
        });

        expect(response).toMatchObject({
            ok: true,
            status: 200,
            statusText: "OK",
            body: "ok",
        });
        expect(globalThis.fetch).toHaveBeenCalledWith(
            "https://app.example.test/base/api/trpc/v1.device.turnCredentials?batch=1",
            {
                method: "POST",
                headers: {
                    "x-client": "popup",
                    Authorization: "Bearer sw-token",
                },
                body: '{"0":{"json":{"syncId":"sync_1"}}}',
                credentials: "omit",
            },
        );
        expect(mockEnsureFreshOnlineServicesSession).toHaveBeenCalledTimes(1);
        expect(mockGetOnlineServicesAuthorizationHeader).toHaveBeenCalledTimes(
            1,
        );
    });

    it("rejects non-GET/POST methods before fetch", async () => {
        const response = await handleProxyFetch({
            url: "https://app.example.test/base/api/trpc/v1.device.turnCredentials?batch=1",
            method: "PUT",
            headers: {},
            body: "{}",
        });

        expect(response.error).toBe("PROXY_FETCH_METHOD_NOT_ALLOWED");
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("rejects malformed headers and bodies before fetch", async () => {
        const malformedHeaders = await handleProxyFetch({
            url: "https://app.example.test/base/api/trpc/v1.device.turnCredentials?batch=1",
            method: "POST",
            headers: { "x-valid": 1 },
            body: "{}",
        } as never);
        const malformedBody = await handleProxyFetch({
            url: "https://app.example.test/base/api/trpc/v1.device.turnCredentials?batch=1",
            method: "POST",
            headers: {},
            body: { nested: true },
        } as never);

        expect(malformedHeaders.error).toBe("INVALID_PROXY_FETCH_PAYLOAD");
        expect(malformedBody.error).toBe("INVALID_PROXY_FETCH_PAYLOAD");
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });
});

describe("tRPC proxy URL helpers", () => {
    it("requires exact configured origin and tRPC path", () => {
        expect(
            isTrpcApiRequest(
                "https://app.example.test/base/api/trpc/v1.vault.list?batch=1",
                "https://app.example.test/base",
            ),
        ).toBe(true);
        expect(
            isTrpcApiRequest(
                "https://app.example.test.evil/base/api/trpc/v1.vault.list?batch=1",
                "https://app.example.test/base",
            ),
        ).toBe(false);
        expect(
            isTrpcApiRequest(
                "https://app.example.test/base/api/trpcish/v1.vault.list",
                "https://app.example.test/base",
            ),
        ).toBe(false);
    });

    it("does not attach auth to auth-only batches", () => {
        expect(
            trpcBatchRequiresAuth(
                "https://app.example.test/base/api/trpc/v1.auth.challenge,v1.auth.verify?batch=1",
            ),
        ).toBe(false);
        expect(
            trpcBatchRequiresAuth(
                "https://app.example.test/base/api/trpc/v1.auth.refresh,v1.device.turnCredentials?batch=1",
            ),
        ).toBe(true);
    });
});
