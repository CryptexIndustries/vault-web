import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    jest,
} from "@jest/globals";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

let mockRouter = {
    isReady: true,
    query: {} as Record<string, string | string[] | undefined>,
    replace: jest.fn<(url: string) => Promise<boolean>>(),
};

jest.mock("next/router", () => ({ useRouter: () => mockRouter }));
jest.mock("next/head", () => ({ __esModule: true, default: () => null }));
jest.mock("@/components/marketing/site", () => ({
    Site: ({ children }: { children: ReactNode }) => <main>{children}</main>,
    Label: ({ children }: { children: ReactNode }) => <p>{children}</p>,
    s: { pageHero: "pageHero", actions: "actions", button: "button" },
}));

import BillingReturnPage from "@/pages/billing/return";
import { billingReturnDestination } from "@/lib/billing-return";

(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("billing return destinations", () => {
    it.each(["success", "cancel", "return"])(
        "maps %s only to registered apps or the local web vault",
        (outcome) => {
            expect(
                billingReturnDestination({
                    target: "mobile-production",
                    outcome,
                }),
            ).toBe(`cryptex:///billing-return?outcome=${outcome}`);
            expect(
                billingReturnDestination({ target: "mobile-preprod", outcome }),
            ).toBe(`cryptex-preprod:///billing-return?outcome=${outcome}`);
            expect(billingReturnDestination({ target: "web", outcome })).toBe(
                "/app",
            );
        },
    );

    it.each([
        {},
        { target: "mobile-production" },
        { target: "mobile-production", outcome: "paid" },
        { target: "https://evil.example", outcome: "success" },
        { target: "javascript:alert(1)", outcome: "success" },
        { target: ["mobile-production", "mobile-preprod"], outcome: "success" },
        { target: "web", outcome: ["success", "cancel"] },
        { target: "web", outcome: "success", url: "https://evil.example" },
        { target: "web", outcome: "success", session_id: "cs_secret" },
    ])(
        "rejects invalid, repeated or arbitrary return parameters %j",
        (query) => {
            expect(billingReturnDestination(query)).toBeNull();
        },
    );
});

describe("billing return page", () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        mockRouter = {
            isReady: true,
            query: { target: "mobile-preprod", outcome: "success" },
            replace: jest
                .fn<(url: string) => Promise<boolean>>()
                .mockResolvedValue(false),
        };
        container = document.createElement("div");
        root = createRoot(container);
    });

    afterEach(() => act(() => root.unmount()));

    it("attempts the matching app and keeps a visible tap fallback without claiming payment", async () => {
        await act(async () => root.render(<BillingReturnPage />));
        expect(mockRouter.replace).toHaveBeenCalledWith(
            "cryptex-preprod:///billing-return?outcome=success",
        );
        const link = container.querySelector("a");
        expect(link?.getAttribute("href")).toBe(
            "cryptex-preprod:///billing-return?outcome=success",
        );
        expect(link?.textContent).toBe("Return to Cryptex Vault");
        expect(container.textContent).toContain(
            "close this browser tab after returning",
        );
        expect(container.textContent).not.toMatch(
            /payment successful|membership upgraded|payment received/i,
        );
    });

    it("leaves the fallback available if automatic navigation fails", async () => {
        mockRouter.replace.mockRejectedValue(
            new Error("Browser blocked the app link"),
        );
        await act(async () => root.render(<BillingReturnPage />));
        expect(container.querySelector("a")?.getAttribute("href")).toBe(
            "cryptex-preprod:///billing-return?outcome=success",
        );
    });

    it("waits for router readiness before offering or opening a destination", async () => {
        mockRouter.isReady = false;
        await act(async () => root.render(<BillingReturnPage />));
        expect(mockRouter.replace).not.toHaveBeenCalled();
        expect(container.querySelector("a")).toBeNull();
        expect(container.querySelector('[role="status"]')).not.toBeNull();
    });

    it("shows an error without navigation or a return button for invalid parameters", async () => {
        mockRouter.query = {
            target: "https://evil.example",
            outcome: "success",
        };
        await act(async () => root.render(<BillingReturnPage />));
        expect(mockRouter.replace).not.toHaveBeenCalled();
        expect(container.querySelector("a")).toBeNull();
        expect(
            container.querySelector('[role="alert"]')?.textContent,
        ).toContain("This return link is invalid");
    });
});
