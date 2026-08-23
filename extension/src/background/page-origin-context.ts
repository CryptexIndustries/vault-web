import {
    ACTIVE_PAGE_ORIGIN_QUERY,
    type ActivePageOrigin,
} from "../types/sw-messaging";
import { etldPlus1 } from "../utils/etld";

const PAGE_ORIGIN_CONTEXT_PREFIX = "PAGE_ORIGIN_CONTEXT:";

type StoredPageOrigin = ActivePageOrigin & {
    documentId?: string;
    updatedAt: number;
};

const storageKey = (tabId: number) => `${PAGE_ORIGIN_CONTEXT_PREFIX}${tabId}`;

/**
 * Derives page context from the browser-authenticated message sender. Payload
 * data is deliberately ignored so a host page cannot select another origin.
 */
export function pageOriginFromSender(
    sender: chrome.runtime.MessageSender,
): StoredPageOrigin | null {
    const tabId = sender.tab?.id;
    const sourceUrl = sender.url ?? sender.tab?.url;
    if (tabId == null || !sourceUrl || sender.frameId !== 0) return null;

    try {
        const url = new URL(sourceUrl);
        if (url.protocol !== "http:" && url.protocol !== "https:") {
            return null;
        }

        const host = url.hostname.toLowerCase().replace(/\.$/, "");
        if (!host) return null;

        return {
            tabId,
            host,
            url: url.href,
            etldPlus1: etldPlus1(host),
            documentId: sender.documentId,
            updatedAt: Date.now(),
        };
    } catch {
        return null;
    }
}

export async function recordPageOrigin(
    sender: chrome.runtime.MessageSender,
): Promise<ActivePageOrigin | null> {
    const context = pageOriginFromSender(sender);
    if (!context) return null;

    await chrome.storage.session.set({
        [storageKey(context.tabId)]: context,
    });
    return context;
}

export async function clearPageOrigin(tabId: number): Promise<void> {
    await chrome.storage.session.remove(storageKey(tabId));
}

/**
 * Looks up the active tab by id only. This intentionally does not read
 * `Tab.url`, which is unavailable when a popup is opened programmatically and
 * production host permissions have been narrowed.
 */
export async function getActivePageOrigin(): Promise<ActivePageOrigin | null> {
    const [activeTab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
    });
    if (activeTab?.id == null) return null;

    const key = storageKey(activeTab.id);
    const stored = await chrome.storage.session.get(key);
    const context = stored[key] as StoredPageOrigin | undefined;
    if (!context || context.tabId !== activeTab.id) return null;

    try {
        const liveOrigin = (await chrome.tabs.sendMessage(activeTab.id, {
            kind: ACTIVE_PAGE_ORIGIN_QUERY,
        })) as
            | { url?: unknown; host?: unknown; etldPlus1?: unknown }
            | undefined;
        if (
            typeof liveOrigin?.url !== "string" ||
            typeof liveOrigin.host !== "string" ||
            typeof liveOrigin.etldPlus1 !== "string" ||
            liveOrigin.host !== context.host ||
            liveOrigin.etldPlus1 !== context.etldPlus1
        ) {
            return null;
        }

        return {
            tabId: context.tabId,
            url: liveOrigin.url,
            host: context.host,
            etldPlus1: context.etldPlus1,
        };
    } catch {
        // No current top-frame content script means the stored origin cannot
        // be proven live (commonly while a navigation is still loading).
        return null;
    }
}
