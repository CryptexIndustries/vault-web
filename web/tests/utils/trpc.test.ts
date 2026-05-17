import {
    describe,
    it,
    expect,
    jest,
    beforeEach,
} from "@jest/globals";

const ensureFreshOnlineServicesSessionMock = jest.fn(async () => true);
const createBareAuthHeaderMock = jest.fn(() => ({ Authorization: "" }));

jest.mock("../../src/app_lib/auth-session", () => ({
    ensureFreshOnlineServicesSession: ensureFreshOnlineServicesSessionMock,
    createBareAuthHeader: createBareAuthHeaderMock,
}));

jest.mock("@trpc/client", () => ({
    createTRPCClient: jest.fn(() => ({})),
    httpBatchLink: jest.fn((opts: unknown) => ({ httpBatchLink: opts })),
    loggerLink: jest.fn(() => ({ loggerLink: true })),
}));

jest.mock("@trpc/react-query", () => ({
    createTRPCReact: jest.fn(() => ({})),
}));

import { httpBatchLink } from "@trpc/client";
import { reactQueryClientConfig } from "../../src/utils/trpc";

type FakeOp = { id: number; path: string; type: "query" | "mutation" };

const buildOp = (path: string): FakeOp => ({
    id: 1,
    path,
    type: "query",
});

const getHeadersFn = () => {
    reactQueryClientConfig("http://example.test");
    const mockHttpBatchLink = httpBatchLink as unknown as jest.Mock;
    const lastCall = mockHttpBatchLink.mock.calls[
        mockHttpBatchLink.mock.calls.length - 1
    ]![0] as {
        headers: (args: { opList: FakeOp[] }) => Promise<Record<string, string>>;
    };
    return lastCall.headers;
};

describe("utils/trpc - createHeadersWithFreshSession", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        createBareAuthHeaderMock.mockReturnValue({ Authorization: "" });
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
});
