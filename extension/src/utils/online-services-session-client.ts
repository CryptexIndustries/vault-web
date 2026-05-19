/**
 * UI-side client for the SW's Online Services session lifecycle.
 *
 * Counterpart to `app_lib/auth-session-ext.ts`, which is what actually
 * holds the token. These wrappers just speak the envelope protocol so
 * the popup/link page never need to know about the underlying storage
 * or JWT semantics.
 */

import { MessageType } from "../types/sw-messaging";
import { sendEncryptedEnvelopeToSW } from "./sw-envelope-client";

export async function establishOnlineServicesSessionViaSW(args: {
    deviceId: string;
    privateKeyJWK: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
    const result = await sendEncryptedEnvelopeToSW<
        { ok: true } | { ok: false; error: string }
    >(MessageType.OnlineServicesEstablish, args);

    if (!result.ok) return { ok: false, error: result.error };
    return result.payload;
}

export async function clearOnlineServicesSessionViaSW(): Promise<void> {
    await sendEncryptedEnvelopeToSW<{ ok: true }>(
        MessageType.OnlineServicesClear,
        null,
    );
}

