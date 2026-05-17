/**
 * @jest-environment node
 */
import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";

const nextResponseNextMock = jest.fn(() => ({ kind: "next" }));
const nextResponseCtorMock = jest.fn(
    (body: BodyInit | null, init?: ResponseInit) => ({
        kind: "ctor",
        body,
        status: init?.status,
    }),
);

jest.mock("next/server", () => ({
    NextResponse: Object.assign(
        function NextResponse(this: unknown, body: BodyInit | null, init?: ResponseInit) {
            return nextResponseCtorMock(body, init);
        },
        {
            next: () => nextResponseNextMock(),
        },
    ),
}));

import { middleware, config } from "../src/middleware";

type MutableProcessEnv = NodeJS.ProcessEnv & { NODE_ENV?: string };

const buildRequest = (pathname: string) =>
    ({
        nextUrl: {
            pathname,
        },
    }) as unknown as import("next/server").NextRequest;

describe("middleware", () => {
    const originalNodeEnv = (process.env as MutableProcessEnv).NODE_ENV;

    beforeEach(() => {
        nextResponseNextMock.mockClear();
        nextResponseCtorMock.mockClear();
    });

    afterEach(() => {
        (process.env as MutableProcessEnv).NODE_ENV = originalNodeEnv;
    });

    it("returns NextResponse.next() in non-production for any path", () => {
        (process.env as MutableProcessEnv).NODE_ENV = "development";
        const result = middleware(buildRequest("/dev/mock-devices"));
        expect(nextResponseNextMock).toHaveBeenCalledTimes(1);
        expect(nextResponseCtorMock).not.toHaveBeenCalled();
        expect(result).toEqual({ kind: "next" });
    });

    it("returns NextResponse.next() in test env for any path", () => {
        (process.env as MutableProcessEnv).NODE_ENV = "test";
        const result = middleware(buildRequest("/some/other/path"));
        expect(nextResponseNextMock).toHaveBeenCalledTimes(1);
        expect(result).toEqual({ kind: "next" });
    });

    it("returns a 404 response in production for /dev/mock-devices", () => {
        (process.env as MutableProcessEnv).NODE_ENV = "production";
        const result = middleware(buildRequest("/dev/mock-devices"));
        expect(nextResponseCtorMock).toHaveBeenCalledTimes(1);
        expect(nextResponseCtorMock).toHaveBeenCalledWith(null, { status: 404 });
        expect(result).toEqual({ kind: "ctor", body: null, status: 404 });
    });

    it("returns a 404 response in production for locale-prefixed /dev/mock-devices", () => {
        (process.env as MutableProcessEnv).NODE_ENV = "production";
        const result = middleware(buildRequest("/en/dev/mock-devices"));
        expect(nextResponseCtorMock).toHaveBeenCalledTimes(1);
        expect(result).toMatchObject({ status: 404 });
    });

    it("returns NextResponse.next() in production for non-dev-mock paths", () => {
        (process.env as MutableProcessEnv).NODE_ENV = "production";
        const result = middleware(buildRequest("/app"));
        expect(nextResponseNextMock).toHaveBeenCalledTimes(1);
        expect(nextResponseCtorMock).not.toHaveBeenCalled();
        expect(result).toEqual({ kind: "next" });
    });

    it("exports a matcher that limits the middleware to dev/mock-devices routes", () => {
        expect(config.matcher).toEqual([
            "/dev/mock-devices",
            "/:locale/dev/mock-devices",
        ]);
    });
});
