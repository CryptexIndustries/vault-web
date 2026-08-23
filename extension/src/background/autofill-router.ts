/**
 * Service-worker handlers for the autofill feature. Kept out of the
 * monolithic `background.ts` switch so the policy decisions (what to
 * return, when to wipe, when to skip the popup) all live in one file.
 *
 * Inputs are the already-decrypted payload object handed back by the
 * envelope layer, current vault state, and sender-derived origin context
 * where needed. Outputs are plain objects that the envelope layer will
 * encrypt and return to the caller.
 */

import { calculateTOTP } from "@cryptex-industries/vault-core/vault-utils/vault";
import * as VaultUtilTypes from "@cryptex-industries/vault-core/proto";
import {
    credentialMatchesPageUrl,
    findCredentialUrlMatch,
    getCredentialUrlRules,
    isCredentialUrlRuleValid,
    normalizeCredentialUrl,
    type CredentialUrlRule,
} from "@cryptex-industries/vault-core/credential-url";
import {
    GetCredentialsForOriginResponse,
    GetCredentialSecretRequest,
    GetCredentialSecretResponse,
    GenerateTOTPResponse,
    LiteCredential,
    PendingSavePrompt,
    SaveCredentialPromptRequest,
} from "../types/sw-messaging";

const PENDING_SAVE_KEY = "PENDING_SAVE";
const PENDING_SAVE_TTL_MS = 5 * 60 * 1000;
const SAVE_BADGE = "+";

export type AutofillRequestOrigin = {
    url: string;
    host: string;
};

/** Lightweight projection of a credential for the picker UI. */
export function toLiteCredential(
    c: VaultUtilTypes.Credential,
    matchedRule: CredentialUrlRule = {
        URL: c.URL,
        MatchMode:
            c.URLMatchMode ?? VaultUtilTypes.CredentialURLMatchMode.ExactHost,
    },
): LiteCredential {
    return {
        id: c.ID,
        name: c.Name,
        username: c.Username,
        url: matchedRule.URL,
        urlMatchMode: matchedRule.MatchMode,
        additionalUrls: c.AdditionalURLs ?? [],
        hasTOTP: Boolean(c.TOTP && c.TOTP.Secret),
        directoryId: c.DirectoryID,
    };
}

/** Matches every active credential against the sender-derived page URL. */
export function matchCredentialsForOrigin(
    credentials: VaultUtilTypes.Credential[] | undefined,
    request: { url: string },
): LiteCredential[] {
    const matches: LiteCredential[] = [];

    for (const cred of credentials ?? []) {
        if (cred.Deleted) continue;
        const match = findCredentialUrlMatch(cred, request.url);
        if (match) matches.push(toLiteCredential(cred, match.rule));
    }

    return matches;
}

export async function handleGetCredentialsForOrigin(
    vault: VaultUtilTypes.Vault | null,
    requestOrigin: AutofillRequestOrigin,
): Promise<GetCredentialsForOriginResponse> {
    if (!normalizeCredentialUrl(requestOrigin.url)) {
        return { ok: false, matches: [], error: "INVALID_ORIGIN" };
    }
    if (!vault) {
        return {
            ok: false,
            matches: [],
            error: "VAULT_NOT_UNLOCKED",
        };
    }

    const matches = matchCredentialsForOrigin(vault.Credentials, {
        url: requestOrigin.url,
    });
    return { ok: true, matches };
}

export async function handleGetCredentialSecret(
    payload: GetCredentialSecretRequest | null | undefined,
    vault: VaultUtilTypes.Vault | null,
    requestOrigin: AutofillRequestOrigin,
): Promise<GetCredentialSecretResponse> {
    if (!payload || typeof payload.id !== "string") {
        return { ok: false, error: "INVALID_PAYLOAD" };
    }
    if (!vault) {
        return { ok: false, error: "VAULT_NOT_UNLOCKED" };
    }

    const cred = (vault.Credentials ?? []).find(
        (c) => c.ID === payload.id && !c.Deleted,
    );
    if (!cred) {
        return { ok: false, error: "NOT_FOUND" };
    }
    const originCheck = credentialMatchesRequestOrigin(cred, requestOrigin);
    if (!originCheck.ok) {
        return { ok: false, error: originCheck.error };
    }

    return {
        ok: true,
        username: cred.Username ?? "",
        password: cred.Password ?? "",
        totpSecret:
            cred.TOTP && cred.TOTP.Secret
                ? {
                      secret: cred.TOTP.Secret,
                      algorithm: cred.TOTP.Algorithm,
                      digits: cred.TOTP.Digits,
                      period: cred.TOTP.Period,
                  }
                : null,
    };
}

export async function handleGenerateTOTP(
    payload: { id: string } | null | undefined,
    vault: VaultUtilTypes.Vault | null,
    requestOrigin: AutofillRequestOrigin,
): Promise<GenerateTOTPResponse> {
    if (!payload || typeof payload.id !== "string") {
        return { ok: false, error: "INVALID_PAYLOAD" };
    }
    if (!vault) {
        return { ok: false, error: "VAULT_NOT_UNLOCKED" };
    }
    const cred = (vault.Credentials ?? []).find(
        (c) => c.ID === payload.id && !c.Deleted,
    );
    if (!cred) return { ok: false, error: "NOT_FOUND" };
    const originCheck = credentialMatchesRequestOrigin(cred, requestOrigin);
    if (!originCheck.ok) {
        return { ok: false, error: originCheck.error };
    }
    if (!cred.TOTP || !cred.TOTP.Secret) {
        return { ok: false, error: "TOTP_NOT_CONFIGURED" };
    }
    try {
        const { code, timeRemaining } = calculateTOTP(cred.TOTP);
        return { ok: true, code, timeRemaining };
    } catch (err) {
        return {
            ok: false,
            error: err instanceof Error ? err.message : "TOTP_FAILED",
        };
    }
}

function credentialMatchesRequestOrigin(
    cred: VaultUtilTypes.Credential,
    requestOrigin: AutofillRequestOrigin,
): { ok: true } | { ok: false; error: string } {
    const hasVerifiedUrl = getCredentialUrlRules(cred).some(
        isCredentialUrlRuleValid,
    );
    if (!hasVerifiedUrl) {
        return { ok: false, error: "CREDENTIAL_ORIGIN_UNVERIFIED" };
    }
    if (credentialMatchesPageUrl(cred, requestOrigin.url)) {
        return { ok: true };
    }
    return { ok: false, error: "ORIGIN_MISMATCH" };
}

/**
 * Stash a save-prompt in session storage and surface a UI cue. The
 * content script mounts a persistent in-page save panel; the toolbar
 * badge and popup `GetPendingSavePrompt` poll are fallbacks when the
 * user navigates away before acting.
 */
export async function handleSaveCredentialPrompt(
    payload: SaveCredentialPromptRequest | null | undefined,
): Promise<{ ok: boolean; error?: string }> {
    if (
        !payload ||
        typeof payload.host !== "string" ||
        typeof payload.url !== "string" ||
        typeof payload.password !== "string"
    ) {
        return { ok: false, error: "INVALID_PAYLOAD" };
    }
    if (!payload.password) {
        return { ok: false, error: "EMPTY_PASSWORD" };
    }

    const prompt: PendingSavePrompt = {
        host: payload.host,
        url: payload.url,
        username: payload.username ?? "",
        password: payload.password,
        stashedAt: Date.now(),
    };

    await chrome.storage.session.set({ [PENDING_SAVE_KEY]: prompt });

    try {
        await chrome.action.setBadgeText({ text: SAVE_BADGE });
        await chrome.action.setBadgeBackgroundColor({ color: "#22c55e" });
    } catch (err) {
        console.debug("[SW] setBadge failed", err);
    }

    return { ok: true };
}

export async function handleGetPendingSavePrompt(): Promise<{
    ok: true;
    prompt: PendingSavePrompt | null;
}> {
    const data = await chrome.storage.session.get([PENDING_SAVE_KEY]);
    const raw = data[PENDING_SAVE_KEY] as PendingSavePrompt | undefined;
    if (!raw) return { ok: true, prompt: null };
    if (Date.now() - raw.stashedAt > PENDING_SAVE_TTL_MS) {
        await chrome.storage.session.remove(PENDING_SAVE_KEY);
        await clearSaveBadge();
        return { ok: true, prompt: null };
    }
    return { ok: true, prompt: raw };
}

export async function handleConsumePendingSavePrompt(): Promise<{
    ok: true;
}> {
    await chrome.storage.session.remove(PENDING_SAVE_KEY);
    await clearSaveBadge();
    return { ok: true };
}

async function clearSaveBadge(): Promise<void> {
    try {
        await chrome.action.setBadgeText({ text: "" });
    } catch (err) {
        console.debug("[SW] clear badge failed", err);
    }
}

export async function handleOpenPopup(): Promise<{
    ok: boolean;
    error?: string;
}> {
    try {
        await chrome.action.openPopup();
        return { ok: true };
    } catch (err) {
        return {
            ok: false,
            error: err instanceof Error ? err.message : "OPEN_POPUP_FAILED",
        };
    }
}
