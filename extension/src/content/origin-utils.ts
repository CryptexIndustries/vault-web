/**
 * Origin helpers for the content-script side of autofill. Re-exports
 * `etldPlus1` from the shared util so callers don't need to know which
 * file holds the small public-suffix table.
 */

import { etldPlus1 } from "../utils/etld";

export { etldPlus1 } from "../utils/etld";

/**
 * Returns the effective origin (`host` + `etldPlus1`) of the document
 * the content script is running in. Returns `null` for non-http(s)
 * documents (file://, chrome://, about:blank...), which the caller
 * should treat as "no autofill on this page".
 */
export function getEffectiveOrigin(): {
    url: string;
    host: string;
    etldPlus1: string;
} | null {
    if (typeof window === "undefined" || !window.location) return null;
    const proto = window.location.protocol;
    if (proto !== "http:" && proto !== "https:") return null;

    const host = window.location.hostname.toLowerCase().replace(/\.$/, "");
    if (!host) return null;

    return { url: window.location.href, host, etldPlus1: etldPlus1(host) };
}

/**
 * Returns `true` when the script is running in the top-most window of
 * the tab. Autofill explicitly refuses to run in sub-frames to avoid
 * clickjacked iframe phishing; the SW also enforces this server-side
 * via `sender.frameId === 0`.
 *
 * Wrapped in a try/catch because `window.top` access throws when the
 * top frame is a different origin and the browser blocks the read.
 */
export function isTopFrame(): boolean {
    try {
        return window.top === window.self;
    } catch {
        return false;
    }
}
