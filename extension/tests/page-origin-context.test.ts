/**
 * @jest-environment node
 */
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    jest,
} from "@jest/globals";

import {
    clearPageOrigin,
    getActivePageOrigin,
    pageOriginFromSender,
    recordPageOrigin,
} from "../src/background/page-origin-context";

const sessionValues: Record<string, unknown> = {};
let activeTab: chrome.tabs.Tab;
let liveOrigin: { host: string; etldPlus1: string };

beforeEach(() => {
    for (const key of Object.keys(sessionValues)) delete sessionValues[key];
    activeTab = { id: 17, active: true } as chrome.tabs.Tab;
    liveOrigin = {
        host: "accounts.example.com",
        etldPlus1: "example.com",
    };

    globalThis.chrome = {
        storage: {
            session: {
                set: jest.fn(async (values: Record<string, unknown>) => {
                    Object.assign(sessionValues, values);
                }),
                get: jest.fn(async (key: string) => ({
                    [key]: sessionValues[key],
                })),
                remove: jest.fn(async (key: string) => {
                    delete sessionValues[key];
                }),
            },
        },
        tabs: {
            query: jest.fn(async () => [activeTab]),
            sendMessage: jest.fn(async () => liveOrigin),
        },
    } as unknown as typeof chrome;
});

afterEach(() => {
    delete (globalThis as { chrome?: typeof chrome }).chrome;
});

describe("page origin context", () => {
    it("derives the origin from the authenticated top-frame sender", () => {
        const context = pageOriginFromSender({
            frameId: 0,
            documentId: "document-1",
            url: "https://Login.Example.com/path",
            tab: { id: 17 } as chrome.tabs.Tab,
        });

        expect(context).toMatchObject({
            tabId: 17,
            host: "login.example.com",
            etldPlus1: "example.com",
            documentId: "document-1",
        });
    });

    it("finds a reported origin by active tab id without Tab.url", async () => {
        await recordPageOrigin({
            frameId: 0,
            url: "https://accounts.example.com/login",
            tab: { id: 17 } as chrome.tabs.Tab,
        });

        expect(activeTab.url).toBeUndefined();
        await expect(getActivePageOrigin()).resolves.toEqual({
            tabId: 17,
            host: "accounts.example.com",
            etldPlus1: "example.com",
        });
    });

    it("does not retain the previous host after navigation invalidation", async () => {
        await recordPageOrigin({
            frameId: 0,
            url: "https://old.example.com",
            tab: { id: 17 } as chrome.tabs.Tab,
        });

        await clearPageOrigin(17);

        await expect(getActivePageOrigin()).resolves.toBeNull();
    });

    it("rejects stored context that does not match the live document", async () => {
        await recordPageOrigin({
            frameId: 0,
            url: "https://accounts.example.com",
            tab: { id: 17 } as chrome.tabs.Tab,
        });
        liveOrigin = {
            host: "other.example.com",
            etldPlus1: "example.com",
        };

        await expect(getActivePageOrigin()).resolves.toBeNull();
    });
});
