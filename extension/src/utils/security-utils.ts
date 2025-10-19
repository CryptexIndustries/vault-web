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
    sender: chrome.runtime.MessageSender
): { valid: true } | { valid: false; error: string; code: string } {
    // Validate timestamp
    const messageTime = new Date(envelope.timestamp).getTime();
    const now = Date.now();
    const timeDiff = Math.abs(now - messageTime);

    if (timeDiff > TIMESTAMP_SKEW_TOLERANCE) {
        return { valid: false, error: "Message timestamp is outside acceptable range", code: "TIMESTAMP_SKEW" };
    }

    // Check nonce cache for replay protection
    const cacheKey = `${envelope.origin}:${envelope.requestId}`;
    const cachedTimestamp = nonceCache.get(cacheKey);

    if (cachedTimestamp) {
        // If we have a cached entry, it's a replay
        return { valid: false, error: "Request ID already used (replay attack)", code: "REPLAY_DETECTED" };
    }

    // Validate origin based on sender information
    const validation = validateOrigin(envelope.origin, sender);
    if (!validation.valid) {
        return validation;
    }

    // Cache the nonce
    nonceCache.set(cacheKey, messageTime);

    // Clean up expired nonces periodically (simple cleanup)
    if (Math.random() < 0.01) { // 1% chance on each validation
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
    sender: chrome.runtime.MessageSender
): { valid: true } | { valid: false; error: string; code: string } {
    // For popup messages
    if (claimedOrigin === "popup") {
        // Popup should come from extension pages
        if (!sender.url?.startsWith(chrome.runtime.getURL(""))) {
            return { valid: false, error: "Invalid popup origin", code: "INVALID_ORIGIN" };
        }
        // Additional validation: sender.tab should exist for popup
        // if (!sender.tab) {
        //     return { valid: false, error: "Popup message must come from a tab context", code: "INVALID_ORIGIN" };
        // }
        return { valid: true };
    }

    // For offscreen document messages
    if (claimedOrigin === "offscreen") {
        // Offscreen should come from the offscreen document
        const offscreenUrl = chrome.runtime.getURL("/offscreen.html");
        if (sender.url !== offscreenUrl) {
            return { valid: false, error: "Invalid offscreen origin", code: "INVALID_ORIGIN" };
        }
        return { valid: true };
    }

    // For worker messages (responses from SW)
    if (claimedOrigin === "worker") {
        // Worker messages should come from the service worker itself
        // This is mainly for consistency, worker-originated messages are trusted
        return { valid: true };
    }

    return { valid: false, error: "Unknown origin type", code: "INVALID_ORIGIN" };
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

    toDelete.forEach(key => nonceCache.delete(key));
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
