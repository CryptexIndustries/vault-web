import type {
    AutofillFrameKind,
    ClaimAutofillFrameRequest,
    ClaimAutofillFrameResponse,
    RegisterAutofillFrameRequest,
} from "../types/sw-messaging";

const FRAME_BOOTSTRAP_TTL_MS = 2 * 60 * 1000;
const MAX_ID_LENGTH = 128;

type StoredFrameBootstrap = {
    nonce: string;
    kind: AutofillFrameKind;
    tabId: number;
    frameId: number;
    createdAt: number;
};

const frameBootstraps = new Map<string, StoredFrameBootstrap>();

function cleanupExpiredFrameBootstraps(now = Date.now()): void {
    for (const [mountId, stored] of frameBootstraps.entries()) {
        if (now - stored.createdAt > FRAME_BOOTSTRAP_TTL_MS) {
            frameBootstraps.delete(mountId);
        }
    }
}

function isValidToken(value: unknown): value is string {
    return (
        typeof value === "string" &&
        value.length > 0 &&
        value.length <= MAX_ID_LENGTH &&
        /^[A-Za-z0-9_-]+$/.test(value)
    );
}

function isFrameKind(value: unknown): value is AutofillFrameKind {
    return (
        value === "autofill-icon" ||
        value === "autofill-menu" ||
        value === "autofill-generator" ||
        value === "autofill-save"
    );
}

export function registerAutofillFrameBootstrap(
    payload: RegisterAutofillFrameRequest | null | undefined,
    sender: chrome.runtime.MessageSender,
): { ok: boolean; error?: string } {
    cleanupExpiredFrameBootstraps();

    if (
        !payload ||
        !isValidToken(payload.mountId) ||
        !isValidToken(payload.nonce) ||
        !isFrameKind(payload.kind)
    ) {
        return { ok: false, error: "INVALID_AUTOFILL_FRAME_BOOTSTRAP" };
    }

    const tabId = sender.tab?.id;
    if (typeof tabId !== "number" || typeof sender.frameId !== "number") {
        return { ok: false, error: "AUTOFILL_FRAME_SENDER_UNAVAILABLE" };
    }

    frameBootstraps.set(payload.mountId, {
        nonce: payload.nonce,
        kind: payload.kind,
        tabId,
        frameId: sender.frameId,
        createdAt: Date.now(),
    });

    return { ok: true };
}

export function claimAutofillFrameBootstrap(
    payload: ClaimAutofillFrameRequest | null | undefined,
    sender: chrome.runtime.MessageSender,
): ClaimAutofillFrameResponse {
    cleanupExpiredFrameBootstraps();

    if (
        !payload ||
        !isValidToken(payload.mountId) ||
        !isFrameKind(payload.kind)
    ) {
        return { ok: false, error: "INVALID_AUTOFILL_FRAME_CLAIM" };
    }

    const stored = frameBootstraps.get(payload.mountId);
    if (!stored) {
        return { ok: false, error: "AUTOFILL_FRAME_BOOTSTRAP_NOT_FOUND" };
    }

    const tabId = sender.tab?.id;
    if (
        stored.kind !== payload.kind ||
        typeof tabId !== "number" ||
        tabId !== stored.tabId
    ) {
        return { ok: false, error: "AUTOFILL_FRAME_BOOTSTRAP_MISMATCH" };
    }

    frameBootstraps.delete(payload.mountId);
    return { ok: true, nonce: stored.nonce };
}

export function clearAutofillFrameBootstrapsForTest(): void {
    frameBootstraps.clear();
}
