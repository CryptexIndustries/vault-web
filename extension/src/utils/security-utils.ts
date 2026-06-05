import { EncryptedEnvelope, PlaintextEnvelope } from "../types/sw-messaging";

export type EnvelopeLike = EncryptedEnvelope | PlaintextEnvelope;

// In-memory cache for request IDs to prevent replay attacks
// Maps origin+requestId to timestamp
const nonceCache = new Map<string, number>();
const NONCE_CACHE_TTL = 10 * 60 * 1000; // 10 minutes in milliseconds
const TIMESTAMP_SKEW_TOLERANCE = 2 * 60 * 1000; // ±2 minutes

/**
 * Validates a message envelope for security (timestamp, nonce, origin).
 * @param envelope The envelope to validate
 * @param sender The Chrome sender object
 * @returns Validation result with error code if invalid
 */
export function validateEnvelope(
    envelope: EnvelopeLike,
    sender: chrome.runtime.MessageSender,
): { valid: true } | { valid: false; error: string; code: string } {
    // Validate timestamp
    const messageTime = new Date(envelope.timestamp).getTime();

    if (isNaN(messageTime)) {
        return {
            valid: false,
            error: "Invalid message timestamp",
            code: "INVALID_TIMESTAMP",
        };
    }

    const now = Date.now();
    const timeDiff = Math.abs(now - messageTime);

    if (timeDiff > TIMESTAMP_SKEW_TOLERANCE) {
        return {
            valid: false,
            error: "Message timestamp is outside acceptable range",
            code: "TIMESTAMP_SKEW",
        };
    }

    // Check nonce cache for replay protection
    const cacheKey = `${envelope.origin}:${envelope.requestId}`;
    const cachedTimestamp = nonceCache.get(cacheKey);

    if (cachedTimestamp) {
        // If we have a cached entry, it's a replay
        return {
            valid: false,
            error: "Request ID already used (replay attack)",
            code: "REPLAY_DETECTED",
        };
    }

    // Validate origin based on sender information
    const validation = validateOrigin(envelope.origin, sender);
    if (!validation.valid) {
        return validation;
    }

    // Cache the nonce
    nonceCache.set(cacheKey, messageTime);

    // Clean up expired nonces periodically (simple cleanup)
    if (Math.random() < 0.01) {
        // 1% chance on each validation
        cleanupExpiredNonces();
    }

    return { valid: true };
}

/**
 * Validates the origin of a message based on Chrome sender information.
 * @param claimedOrigin The origin claimed in the envelope
 * @param sender The Chrome sender object
 * @returns Validation result
 */
function validateOrigin(
    claimedOrigin: string,
    sender: chrome.runtime.MessageSender,
): { valid: true } | { valid: false; error: string; code: string } {
    // For popup messages
    if (claimedOrigin === "popup") {
        // Popup should come from extension pages
        if (!sender.url?.startsWith(chrome.runtime.getURL("/popup.html"))) {
            return {
                valid: false,
                error: "Invalid popup origin",
                code: "INVALID_ORIGIN",
            };
        }
        return { valid: true };
    }

    // The receive-link flow runs in a dedicated extension page (link.html)
    // to give the QR scanner / linking progress more room than the action
    // popup. It needs to talk to the SW just like the popup does.
    if (claimedOrigin === "link") {
        if (!sender.url?.startsWith(chrome.runtime.getURL("/link.html"))) {
            return {
                valid: false,
                error: "Invalid link page origin",
                code: "INVALID_ORIGIN",
            };
        }
        return { valid: true };
    }

    // For offscreen document messages
    if (claimedOrigin === "offscreen") {
        // Offscreen should come from the offscreen document
        const offscreenUrl = chrome.runtime.getURL("/offscreen.html");
        if (sender.url !== offscreenUrl) {
            return {
                valid: false,
                error: "Invalid offscreen origin",
                code: "INVALID_ORIGIN",
            };
        }
        return { valid: true };
    }

    // For worker messges
    if (claimedOrigin === "worker") {
        if (sender.id !== chrome.runtime.id) {
            return {
                valid: false,
                error: "Worker message must come from the service worker itself",
                code: "INVALID_SENDER",
            };
        }
        return { valid: true };
    }

    // Autofill icon iframe: extension-origin page loaded inside a host
    // tab. Validate against its known URL prefix; the page is rendered
    // cross-origin to the host so the host cannot spoof it.
    if (claimedOrigin === "autofill-icon") {
        if (
            !sender.url?.startsWith(
                chrome.runtime.getURL("/autofill-icon.html"),
            )
        ) {
            return {
                valid: false,
                error: "Invalid autofill-icon origin",
                code: "INVALID_ORIGIN",
            };
        }
        return { valid: true };
    }

    // Autofill menu iframe: same reasoning as the icon iframe.
    if (claimedOrigin === "autofill-menu") {
        if (
            !sender.url?.startsWith(
                chrome.runtime.getURL("/autofill-menu.html"),
            )
        ) {
            return {
                valid: false,
                error: "Invalid autofill-menu origin",
                code: "INVALID_ORIGIN",
            };
        }
        return { valid: true };
    }

    // Autofill save iframe: persistent save-login panel on host pages.
    if (claimedOrigin === "autofill-save") {
        if (
            !sender.url?.startsWith(
                chrome.runtime.getURL("/autofill-save.html"),
            )
        ) {
            return {
                valid: false,
                error: "Invalid autofill-save origin",
                code: "INVALID_ORIGIN",
            };
        }
        return { valid: true };
    }

    // Content script: lives in an isolated world inside a tab. Chrome
    // populates `sender.tab` for content-script messages. We additionally
    // enforce `frameId === 0` so messages originating from sub-frames
    // (clickjacking risk) can never claim the autofill-cs origin even if
    // a future content_scripts entry allows `all_frames`.
    if (claimedOrigin === "autofill-cs") {
        if (sender.id !== chrome.runtime.id) {
            return {
                valid: false,
                error: "autofill-cs must come from this extension",
                code: "INVALID_SENDER",
            };
        }
        if (!sender.tab) {
            return {
                valid: false,
                error: "autofill-cs must come from a tab",
                code: "INVALID_ORIGIN",
            };
        }
        if (sender.frameId !== 0) {
            return {
                valid: false,
                error: "autofill-cs is only allowed in the top frame",
                code: "INVALID_FRAME",
            };
        }
        return { valid: true };
    }

    return {
        valid: false,
        error: "Unknown origin type",
        code: "INVALID_ORIGIN",
    };
}

/**
 * Validates a response envelope from a worker message.
 * The difference between this and validateEnvelope is that we need to validate without the sender information.
 */
export function TODOvalidateResponseEnvelope(
    envelope: EnvelopeLike,
): { valid: true } | { valid: false; error: string; code: string } {
    return validateEnvelope(envelope, { origin: "worker" });
}

/**
 * Cleans up expired nonces from the cache.
 */
function cleanupExpiredNonces(): void {
    const now = Date.now();
    const toDelete: string[] = [];

    for (const [key, timestamp] of nonceCache.entries()) {
        if (now - timestamp > NONCE_CACHE_TTL) {
            toDelete.push(key);
        }
    }

    toDelete.forEach((key) => nonceCache.delete(key));
}

/**
 * Clears the nonce cache (useful for testing or key rotation).
 */
export function clearNonceCache(): void {
    nonceCache.clear();
}

/**
 * Gets the current nonce cache size (for debugging).
 */
export function getNonceCacheSize(): number {
    return nonceCache.size;
}
