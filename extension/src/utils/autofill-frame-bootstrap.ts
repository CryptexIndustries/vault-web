import {
    MessageType,
    type AutofillFrameKind,
    type ClaimAutofillFrameResponse,
} from "../types/sw-messaging";
import {
    sendEncryptedEnvelopeToSW,
    type SwEnvelopeResult,
} from "./sw-envelope-client";

const MOUNT_ID_PARAM = "cryptexMountId";
const TOKEN_BYTES = 16;

export type AutofillFrameBootstrap = {
    mountId: string;
    nonce: string;
};

function randomToken(): string {
    const bytes = new Uint8Array(TOKEN_BYTES);
    crypto.getRandomValues(bytes);
    return btoa(String.fromCharCode(...bytes))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/g, "");
}

export function withAutofillFrameMount(url: string, mountId: string): string {
    const nextUrl = new URL(url);
    nextUrl.searchParams.set(MOUNT_ID_PARAM, mountId);
    return nextUrl.toString();
}

export async function createAutofillFrameBootstrap(
    kind: AutofillFrameKind,
): Promise<AutofillFrameBootstrap | null> {
    const bootstrap = {
        mountId: randomToken(),
        nonce: randomToken(),
    };
    let res: SwEnvelopeResult<{ ok: boolean; error?: string }>;
    try {
        res = await sendEncryptedEnvelopeToSW<{ ok: boolean; error?: string }>(
            MessageType.RegisterAutofillFrame,
            { ...bootstrap, kind },
        );
    } catch (err) {
        console.debug("[autofill-frame-bootstrap] register threw", err);
        return null;
    }
    if (!res.ok || !res.payload?.ok) {
        console.debug(
            "[autofill-frame-bootstrap] register failed",
            !res.ok ? res.error : res.payload?.error,
        );
        return null;
    }
    return bootstrap;
}

export async function claimAutofillFrameBootstrap(
    kind: AutofillFrameKind,
): Promise<AutofillFrameBootstrap | null> {
    const mountId = new URLSearchParams(window.location.search).get(
        MOUNT_ID_PARAM,
    );
    if (!mountId) return null;

    let res: SwEnvelopeResult<ClaimAutofillFrameResponse>;
    try {
        res = await sendEncryptedEnvelopeToSW<ClaimAutofillFrameResponse>(
            MessageType.ClaimAutofillFrame,
            { mountId, kind },
        );
    } catch (err) {
        console.debug("[autofill-frame-bootstrap] claim threw", err);
        return null;
    }
    if (!res.ok || !res.payload?.ok || !res.payload.nonce) {
        console.debug(
            "[autofill-frame-bootstrap] claim failed",
            !res.ok ? res.error : res.payload?.error,
        );
        return null;
    }
    return { mountId, nonce: res.payload.nonce };
}

export function isExpectedAutofillInit(
    data: unknown,
    bootstrap: AutofillFrameBootstrap,
): boolean {
    return (
        !!data &&
        typeof data === "object" &&
        (data as { kind?: unknown }).kind === "init" &&
        (data as { mountId?: unknown }).mountId === bootstrap.mountId &&
        (data as { nonce?: unknown }).nonce === bootstrap.nonce
    );
}
