/**
 * SW-owned session storage for the single active credential form draft.
 *
 * Modeled on the autofill router's PENDING_SAVE stash: while the popup's
 * credential form is open and dirty, the popup debounces a stash of the
 * current form values here so the work survives a popup close. The next
 * popup open reads the draft back (validated against the live unlocked
 * vault) and re-presents the form pre-filled.
 *
 * Ownership and lifetime: only the SW touches `DRAFT_STORAGE_KEY`. The
 * value lives in `chrome.storage.session`, so it is wiped on vault lock,
 * idle auto-lock, and browser shutdown; the SW additionally clears it on
 * a successful save, on explicit discard, and when a stale draft is
 * detected on read.
 */

import {
    CredentialDraftFormSchema,
    type CredentialFormSchemaType,
} from "@cryptex-industries/vault-core/vault-utils/vault";
import * as VaultUtilTypes from "@cryptex-industries/vault-core/proto";
import type {
    CredentialDraft,
    CredentialDraftMode,
    SaveCredentialDraftRequest,
} from "../types/sw-messaging";

const DRAFT_STORAGE_KEY = "DRAFT_SAVE";

/** Structural guard for the raw session-storage read. */
export function isCredentialDraft(value: unknown): value is CredentialDraft {
    if (typeof value !== "object" || value === null) return false;

    const candidate = value as Record<string, unknown>;
    if (
        typeof candidate.vaultDbIndex !== "number" ||
        (candidate.mode !== "create" && candidate.mode !== "edit") ||
        (typeof candidate.credentialId !== "string" &&
            candidate.credentialId !== null) ||
        (typeof candidate.credentialVersion !== "number" &&
            candidate.credentialVersion !== null) ||
        typeof candidate.stashedAt !== "number"
    ) {
        return false;
    }

    const form = candidate.form;
    if (typeof form !== "object" || form === null) return false;

    const draftForm = form as Record<string, unknown>;
    return (
        (typeof draftForm.ID === "string" || draftForm.ID === null) &&
        typeof draftForm.Name === "string" &&
        typeof draftForm.Password === "string"
    );
}

/**
 * Reads the stashed draft. Missing values pass through; corrupt or
 * foreign values under the key are wiped so a later re-present cannot
 * surface stale bytes.
 */
export async function getCredentialDraft(): Promise<CredentialDraft | null> {
    const data = await chrome.storage.session.get([DRAFT_STORAGE_KEY]);
    const raw = data[DRAFT_STORAGE_KEY] as unknown;
    if (!isCredentialDraft(raw)) {
        console.debug("[SW] Dropping missing or malformed credential draft");
        await chrome.storage.session.remove(DRAFT_STORAGE_KEY);
        return null;
    }
    return raw;
}

/** Stashes (or replaces) the active draft. */
export async function setCredentialDraft(
    draft: CredentialDraft,
): Promise<void> {
    await chrome.storage.session.set({ [DRAFT_STORAGE_KEY]: draft });
}

/** Clears the stashed draft. */
export async function clearCredentialDraft(): Promise<void> {
    await chrome.storage.session.remove(DRAFT_STORAGE_KEY);
}

/**
 * Pure staleness check: a draft is restorable iff it belongs to the given
 * vault index AND (for edit drafts) the credential still exists, is not
 * deleted, and its `Version` matches the stashed version. Create drafts
 * are restorable for the whole session (nothing to race against).
 */
export function validateCredentialDraftAgainstVault(
    draft: CredentialDraft,
    vault: VaultUtilTypes.Vault,
    vaultDbIndex: number,
): boolean {
    if (draft.vaultDbIndex !== vaultDbIndex) return false;

    if (draft.mode === "create") return true;

    const credential = vault.Credentials.find(
        (c) => c.ID === draft.credentialId,
    );
    return (
        credential != null &&
        !credential.Deleted &&
        credential.Version === draft.credentialVersion
    );
}

/**
 * Validates an untrusted `SaveCredentialDraft` payload from the popup.
 * Validates the form's shape against `CredentialDraftFormSchema` (an
 * in-flight draft may be incomplete; completeness is enforced at submit
 * time) and enforces the mode/credentialId invariants. Returns a normalized
 * request on success.
 */
export function validateSaveCredentialDraftRequest(
    payload: unknown,
):
    | { ok: true; request: SaveCredentialDraftRequest }
    | { ok: false; error: string } {
    if (typeof payload !== "object" || payload === null) {
        return { ok: false, error: "INVALID_DRAFT_PAYLOAD" };
    }

    const candidate = payload as {
        mode?: unknown;
        credentialId?: unknown;
        form?: unknown;
    };
    if (candidate.mode !== "create" && candidate.mode !== "edit") {
        return { ok: false, error: "INVALID_DRAFT_MODE" };
    }
    let credentialId: string | undefined;
    if (candidate.mode === "edit") {
        if (
            typeof candidate.credentialId !== "string" ||
            candidate.credentialId.length === 0
        ) {
            return { ok: false, error: "DRAFT_CREDENTIAL_ID_REQUIRED" };
        }
        credentialId = candidate.credentialId;
    }
    const parsed = CredentialDraftFormSchema.safeParse(candidate.form);
    if (!parsed.success) {
        return { ok: false, error: "INVALID_DRAFT_FORM" };
    }

    return {
        ok: true,
        request: {
            mode: candidate.mode,
            credentialId,
            form: parsed.data,
        },
    };
}

/**
 * Normalizes form values into the stashed draft shape: `ID` is forced to
 * the draft's identity (credentialId for edit, null for create), `Tags`
 * defaults to "". Partially-filled custom fields are kept; rows that are
 * entirely blank are dropped. Mirrors the popup's `handleFormSubmit`
 * normalization.
 */
export function normalizeDraftForm(
    form: CredentialFormSchemaType,
    mode: CredentialDraftMode,
    credentialId: string | null,
): CredentialFormSchemaType {
    return {
        ...form,
        ID: mode === "edit" ? credentialId : null,
        Tags: form.Tags ?? "",
        CustomFields: (form.CustomFields ?? []).filter(
            (f) => f.Name.trim() !== "" || f.Value.trim() !== "",
        ),
    };
}
