/**
 * Generic "send an encrypted envelope to the SW and decrypt the reply"
 * client used by popup/link/offscreen contexts.
 *
 * Centralising this avoids duplicating the public-key bootstrap, the
 * STALE_KEY retry, and the response decryption between the tRPC proxy
 * fetch and the more bespoke calls (e.g. establishing/clearing the
 * Online Services session). One place to harden, one place to reason about.
 */

import {
    EncryptedEnvelope,
    EnvelopeOrigin,
    MessageType,
    PlaintextEnvelope,
} from "../types/sw-messaging";
import {
    createEncryptedEnvelope,
    createPlaintextEnvelope,
    decryptResponseEnvelope,
    isEncryptedEnvelope,
} from "./session-utils";

type ServerPublicKey = {
    keyId: string;
    publicKeyJwk: JsonWebKey;
};

let serverPublicKey: ServerPublicKey | null = null;
let inflightPublicKeyFetch: Promise<ServerPublicKey | null> | null = null;
let originOverride: EnvelopeOrigin | null = null;

/**
 * Forces `detectEnvelopeOrigin()` to return a specific value. Used by
 * the content script, which doesn't run on an extension URL and so
 * can't be classified by URL inspection alone. Pass `null` to revert
 * to auto-detection.
 */
export function setEnvelopeOriginOverride(origin: EnvelopeOrigin | null): void {
    originOverride = origin;
}

/**
 * Maps the current extension page to the envelope origin tag expected by
 * the SW's origin validator. See `utils/security-utils.ts#validateOrigin`.
 */
export function detectEnvelopeOrigin(): EnvelopeOrigin {
    if (originOverride) return originOverride;
    if (
        typeof window === "undefined" ||
        typeof window.location === "undefined"
    ) {
        return "worker";
    }
    const pathname = window.location.pathname;
    if (pathname.endsWith("/popup.html")) return "popup";
    if (pathname.endsWith("/link.html")) return "link";
    if (pathname.endsWith("/offscreen.html")) return "offscreen";
    if (pathname.endsWith("/autofill-icon.html")) return "autofill-icon";
    if (pathname.endsWith("/autofill-menu.html")) return "autofill-menu";
    if (pathname.endsWith("/autofill-save.html")) return "autofill-save";
    return "popup";
}

async function fetchServerPublicKey(): Promise<ServerPublicKey | null> {
    const envelope = createPlaintextEnvelope(
        MessageType.GetPublicKey,
        null,
        detectEnvelopeOrigin(),
    );
    try {
        const response: PlaintextEnvelope =
            await chrome.runtime.sendMessage(envelope);
        if (!response?.payload?.ok) {
            return null;
        }
        return {
            keyId: response.payload.keyId,
            publicKeyJwk: response.payload.publicKeyJwk,
        };
    } catch (error) {
        console.warn("[swEnvelopeClient] GetPublicKey threw", error);
        return null;
    }
}

export async function getServerPublicKey(
    forceRefresh = false,
): Promise<ServerPublicKey | null> {
    if (!forceRefresh && serverPublicKey) return serverPublicKey;
    if (inflightPublicKeyFetch) return inflightPublicKeyFetch;

    inflightPublicKeyFetch = (async () => {
        const next = await fetchServerPublicKey();
        if (next) serverPublicKey = next;
        return next;
    })().finally(() => {
        inflightPublicKeyFetch = null;
    });

    return inflightPublicKeyFetch;
}

export type SwEnvelopeResult<T> =
    | { ok: true; payload: T }
    | { ok: false; code?: string; error: string };

async function sendOnce<T>(
    messageType: MessageType,
    payload: object | null,
    key: ServerPublicKey,
): Promise<
    | { kind: "ok"; payload: T }
    | { kind: "stale-key" }
    | { kind: "error"; code?: string; error: string }
> {
    const envelope = await createEncryptedEnvelope(
        messageType,
        payload,
        key.publicKeyJwk,
        key.keyId,
        detectEnvelopeOrigin(),
    );

    const response: EncryptedEnvelope | PlaintextEnvelope =
        await chrome.runtime.sendMessage(envelope);

    if (isEncryptedEnvelope(response)) {
        const decrypted = await decryptResponseEnvelope<T>(response);
        if (!decrypted.ok) {
            return { kind: "error", error: "RESPONSE_DECRYPTION_FAILED" };
        }
        return { kind: "ok", payload: decrypted.payload };
    }

    if (response.payload?.code === "STALE_KEY") {
        return { kind: "stale-key" };
    }
    return {
        kind: "error",
        code: response.payload?.code,
        error:
            (response.payload?.error as string | undefined) ??
            "UNKNOWN_ENVELOPE_ERROR",
    };
}

/**
 * Sends an encrypted envelope of `messageType` carrying `payload` and
 * returns the decrypted SW response. Handles the public key bootstrap
 * (lazy + cached) and one STALE_KEY retry transparently.
 */
export async function sendEncryptedEnvelopeToSW<T>(
    messageType: MessageType,
    payload: object | null,
): Promise<SwEnvelopeResult<T>> {
    let key = await getServerPublicKey();
    if (!key) {
        return { ok: false, error: "PUBLIC_KEY_UNAVAILABLE" };
    }

    let result = await sendOnce<T>(messageType, payload, key);

    if (result.kind === "stale-key") {
        key = await getServerPublicKey(true);
        if (!key) {
            return { ok: false, error: "PUBLIC_KEY_UNAVAILABLE_AFTER_RETRY" };
        }
        result = await sendOnce<T>(messageType, payload, key);
    }

    if (result.kind === "ok") {
        return { ok: true, payload: result.payload };
    }

    return {
        ok: false,
        code: result.kind === "stale-key" ? "STALE_KEY" : result.code,
        error:
            result.kind === "stale-key"
                ? "STALE_KEY"
                : (result.error ?? "UNKNOWN_ENVELOPE_ERROR"),
    };
}
