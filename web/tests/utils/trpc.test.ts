import {
    describe,
    it,
    expect,
    jest,
    beforeEach,
    afterEach,
} from "@jest/globals";

const ensureFreshOnlineServicesSessionMock = jest.fn(async () => true);
const createBareAuthHeaderMock = jest.fn(() => ({ Authorization: "" }));
const loggerLinkMock = jest.fn((options: unknown) => ({ loggerLink: options }));

jest.mock("../../src/app_lib/auth-session", () => ({
    ensureFreshOnlineServicesSession: ensureFreshOnlineServicesSessionMock,
    createBareAuthHeader: createBareAuthHeaderMock,
}));

jest.mock("@trpc/client", () => ({
    createTRPCClient: jest.fn(() => ({})),
    httpBatchLink: jest.fn((opts: unknown) => ({ httpBatchLink: opts })),
    loggerLink: loggerLinkMock,
}));

jest.mock("@trpc/react-query", () => ({
    createTRPCReact: jest.fn(() => ({})),
}));

import { httpBatchLink } from "@trpc/client";
import { reactQueryClientConfig } from "../../src/utils/trpc";

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const setNodeEnv = (value: string | undefined) => {
    Reflect.set(process.env, "NODE_ENV", value);
};

type FakeOp = { id: number; path: string; type: "query" | "mutation" };

const buildOp = (path: string): FakeOp => ({
    id: 1,
    path,
    type: "query",
});

type FakeLoggerOptions = {
    id: number;
    path: string;
    type: "query" | "mutation";
    direction: "up" | "down";
    input: unknown;
    result?: unknown;
    elapsedMs?: number;
};

type LoggerOptions = {
    enabled: (opts: FakeLoggerOptions) => boolean;
    logger: (opts: FakeLoggerOptions) => void;
};

const getLoggerOptions = (): LoggerOptions => {
    reactQueryClientConfig("http://example.test");
    const lastCall =
        loggerLinkMock.mock.calls[loggerLinkMock.mock.calls.length - 1];
    return lastCall?.[0] as LoggerOptions;
};

const getHeadersFn = () => {
    reactQueryClientConfig("http://example.test");
    const mockHttpBatchLink = httpBatchLink as unknown as jest.Mock;
    const lastCall = mockHttpBatchLink.mock.calls[
        mockHttpBatchLink.mock.calls.length - 1
    ]![0] as {
        headers: (args: {
            opList: FakeOp[];
        }) => Promise<Record<string, string>>;
    };
    return lastCall.headers;
};

describe("utils/trpc - createHeadersWithFreshSession", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        createBareAuthHeaderMock.mockReturnValue({ Authorization: "" });
    });

    afterEach(() => {
        setNodeEnv(ORIGINAL_NODE_ENV);
        jest.restoreAllMocks();
    });

    it("skips ensure when every op path starts with v1.auth.", async () => {
        const headersFn = getHeadersFn();

        await headersFn({
            opList: [
                buildOp("v1.auth.challenge"),
                buildOp("v1.auth.verify"),
                buildOp("v1.auth.refresh"),
            ],
        });

        expect(ensureFreshOnlineServicesSessionMock).not.toHaveBeenCalled();
        expect(createBareAuthHeaderMock).toHaveBeenCalled();
    });

    it("calls ensure when at least one op is not v1.auth.", async () => {
        const headersFn = getHeadersFn();

        await headersFn({
            opList: [
                buildOp("v1.auth.challenge"),
                buildOp("v1.user.configuration"),
            ],
        });

        expect(ensureFreshOnlineServicesSessionMock).toHaveBeenCalledTimes(1);
    });

    it("returns the bare auth header object", async () => {
        const headersFn = getHeadersFn();
        createBareAuthHeaderMock.mockReturnValueOnce({
            Authorization: "Bearer token-123",
        });

        const result = await headersFn({
            opList: [buildOp("v1.payment.getCheckoutURL")],
        });

        expect(result).toEqual({ Authorization: "Bearer token-123" });
    });

    it("keeps the full payload in development", () => {
        setNodeEnv("development");
        const consoleLog = jest
            .spyOn(console, "log")
            .mockImplementation(() => undefined);
        const consoleError = jest
            .spyOn(console, "error")
            .mockImplementation(() => undefined);
        const logger = getLoggerOptions();
        const input = {
            recoveryPhrase: "development-recovery-phrase",
            sessionToken: "development-session-token",
        };
        const result = {
            transfer: {
                url: "https://objects.example.test/signed-url",
            },
        };

        expect(
            logger.enabled({
                id: 1,
                path: "v1.backup.recoveryDownload",
                type: "mutation",
                direction: "up",
                input,
            }),
        ).toBe(true);
        logger.logger({
            id: 1,
            path: "v1.backup.recoveryDownload",
            type: "mutation",
            direction: "down",
            input,
            result,
            elapsedMs: 12,
        });

        expect(consoleLog).toHaveBeenCalledWith(
            "[tRPC] down mutation #1 v1.backup.recoveryDownload",
            { input, result, elapsedMs: 12 },
        );
        expect(consoleError).not.toHaveBeenCalled();
    });

    it("logs only safe metadata for production errors", () => {
        setNodeEnv("production");
        const consoleLog = jest
            .spyOn(console, "log")
            .mockImplementation(() => undefined);
        const consoleError = jest
            .spyOn(console, "error")
            .mockImplementation(() => undefined);
        const logger = getLoggerOptions();
        const error = new Error("secret-bearing server message");

        expect(
            logger.enabled({
                id: 2,
                path: "v1.backup.createRecoverySession",
                type: "mutation",
                direction: "down",
                input: { recoveryPhrase: "recovery-phrase" },
                result: error,
                elapsedMs: 7,
            }),
        ).toBe(true);
        logger.logger({
            id: 2,
            path: "v1.backup.createRecoverySession",
            type: "mutation",
            direction: "down",
            input: { recoveryPhrase: "recovery-phrase" },
            result: error,
            elapsedMs: 7,
        });

        expect(consoleError).toHaveBeenCalledWith(
            "[tRPC] down mutation #2 v1.backup.createRecoverySession",
            { elapsedMs: 7, error: "Error" },
        );
        expect(consoleLog).not.toHaveBeenCalled();
    });
});
