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
 * the tab.
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

/**
 * Returns `true` in the top frame and in sub-frames whose ancestors all
 * share this frame's origin, such as Apple's sign-in iframe. Autofill
 * refuses cross-origin frames to avoid clickjacked iframe phishing. Reading
 * a cross-origin parent's location throws, which rejects the frame. The SW
 * repeats the check against the top frame's origin.
 */
export function isSameOriginFrameChain(): boolean {
    try {
        for (let frame: Window = window; frame !== frame.top; ) {
            frame = frame.parent;
            if (frame.location.origin !== window.location.origin) return false;
        }
        return true;
    } catch {
        return false;
    }
}
