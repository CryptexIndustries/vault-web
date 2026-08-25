import type * as VaultUtilTypes from "@cryptex-industries/vault-core/proto";
import { isRegistrableDomain } from "@cryptex-industries/vault-core/credential-url";
import {
    decodeBase64Url,
    generatePasskeyAssertion,
} from "../content/passkey-assertion";
import type {
    BeginPasskeyAssertionRequest,
    BeginPasskeyAssertionResponse,
    CancelPasskeyAssertionRequest,
    CompletePasskeyAssertionRequest,
    CompletePasskeyAssertionResponse,
    ConsumePasskeyAssertionResultResponse,
    GetPendingPasskeyAssertionResponse,
    PasskeyAssertionCandidate,
} from "../types/sw-messaging";
import type { SerializedPasskeyAssertion } from "../content/passkey-assertion";
import type { AutofillRequestOrigin } from "./autofill-router";
import { verifyVaultMasterPassword } from "./session-dek-store";

type VaultMetadata = VaultUtilTypes.VaultMetadata;

const CEREMONY_PREFIX = "PASSKEY_ASSERTION_CEREMONY:";
const PENDING_CONFIRMATION_KEY = "PASSKEY_ASSERTION_PENDING_CONFIRMATION";
const CEREMONY_TTL_MS = 2 * 60 * 1000;
const MAX_PASSWORD_ATTEMPTS = 5;
const MAX_CHALLENGE_BYTES = 4096;
const MAX_CHALLENGE_CHARACTERS = 5462;
const MAX_ALLOW_CREDENTIALS = 256;
const MAX_CREDENTIAL_ID_BYTES = 1024;
const MAX_CREDENTIAL_ID_CHARACTERS = 1366;
const MAX_ACTIVE_CEREMONIES = 32;
const MAX_RP_ID_CHARACTERS = 253;

type SenderBinding = {
    tabId: number;
    frameId: number;
    documentId?: string;
};

type StoredPasskeyAssertionCeremony = {
    version: 2;
    vaultDbIndex: number;
    binding: SenderBinding;
    origin: string;
    rpId: string;
    challenge: string;
    userVerification: UserVerificationRequirement;
    eligibleCredentials: Array<{
        vaultCredentialId: string;
        authenticatorCredentialId: string;
    }>;
    createdAt: number;
    passwordAttempts: number;
    result?:
        | { outcome: "authenticated"; assertion: SerializedPasskeyAssertion }
        | { outcome: "fallback" };
};

const ceremonyKey = (id: string) => `${CEREMONY_PREFIX}${id}`;

function normalizeRpId(value: string): string | null {
    const rpId = value.trim().toLowerCase().replace(/\.$/u, "");
    if (
        !rpId ||
        rpId.length > MAX_RP_ID_CHARACTERS ||
        rpId.includes(":") ||
        rpId.includes("/") ||
        rpId.includes("@")
    ) {
        return null;
    }
    try {
        const parsed = new URL(`https://${rpId}`);
        return parsed.hostname === rpId ? rpId : null;
    } catch {
        return null;
    }
}

export function resolveValidRpId(
    requestOrigin: AutofillRequestOrigin,
    requestedRpId?: string,
): string | null {
    const source = new URL(requestOrigin.url);
    const loopback =
        source.hostname === "localhost" ||
        source.hostname.endsWith(".localhost") ||
        source.hostname.startsWith("127.") ||
        source.hostname === "[::1]";
    if (
        source.protocol !== "https:" &&
        !(source.protocol === "http:" && loopback)
    ) {
        return null;
    }
    const originHost = requestOrigin.host.toLowerCase().replace(/\.$/u, "");
    const rpId = normalizeRpId(requestedRpId ?? originHost);
    if (!rpId) return null;
    if (rpId === "localhost") return originHost === "localhost" ? rpId : null;
    if (/^(?:\d{1,3}\.){3}\d{1,3}$/u.test(rpId)) {
        return rpId === originHost ? rpId : null;
    }
    if (rpId !== originHost && !originHost.endsWith(`.${rpId}`)) return null;
    // A public suffix (for example "com" or "co.uk") is never an RP ID.
    if (!isRegistrableDomain(rpId)) return null;
    return rpId;
}

function senderBinding(
    sender: chrome.runtime.MessageSender,
): SenderBinding | null {
    const tabId = sender.tab?.id;
    if (typeof tabId !== "number" || typeof sender.frameId !== "number") {
        return null;
    }
    return {
        tabId,
        frameId: sender.frameId,
        documentId: sender.documentId,
    };
}

function bindingMatches(
    stored: SenderBinding,
    sender: chrome.runtime.MessageSender,
): boolean {
    const current = senderBinding(sender);
    return (
        !!current &&
        current.tabId === stored.tabId &&
        current.frameId === stored.frameId &&
        (!stored.documentId || current.documentId === stored.documentId)
    );
}

function isValidRequest(
    request: BeginPasskeyAssertionRequest | null | undefined,
): request is BeginPasskeyAssertionRequest {
    if (
        !request?.publicKey ||
        typeof request.publicKey.challenge !== "string" ||
        request.publicKey.challenge.length > MAX_CHALLENGE_CHARACTERS ||
        !/^[A-Za-z0-9_-]+$/u.test(request.publicKey.challenge) ||
        (request.publicKey.rpId !== undefined &&
            typeof request.publicKey.rpId !== "string")
    ) {
        return false;
    }
    try {
        const challenge = decodeBase64Url(request.publicKey.challenge);
        if (!challenge.length || challenge.length > MAX_CHALLENGE_BYTES) {
            return false;
        }
    } catch {
        return false;
    }
    if (
        !Array.isArray(request.publicKey.allowCredentials) ||
        request.publicKey.allowCredentials.length > MAX_ALLOW_CREDENTIALS ||
        !["required", "preferred", "discouraged"].includes(
            request.publicKey.userVerification,
        )
    ) {
        return false;
    }
    return request.publicKey.allowCredentials.every((descriptor) => {
        if (
            descriptor?.type !== "public-key" ||
            typeof descriptor.id !== "string" ||
            descriptor.id.length > MAX_CREDENTIAL_ID_CHARACTERS ||
            !/^[A-Za-z0-9_-]+$/u.test(descriptor.id)
        ) {
            return false;
        }
        try {
            const id = decodeBase64Url(descriptor.id);
            return id.length > 0 && id.length <= MAX_CREDENTIAL_ID_BYTES;
        } catch {
            return false;
        }
    });
}

function isCeremonyId(value: unknown): value is string {
    return (
        typeof value === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
            value,
        )
    );
}

function isStoredCeremony(
    value: unknown,
): value is StoredPasskeyAssertionCeremony {
    if (!value || typeof value !== "object") return false;
    const ceremony = value as Partial<StoredPasskeyAssertionCeremony>;
    return (
        ceremony.version === 2 &&
        Number.isSafeInteger(ceremony.vaultDbIndex) &&
        !!ceremony.binding &&
        Number.isSafeInteger(ceremony.binding.tabId) &&
        Number.isSafeInteger(ceremony.binding.frameId) &&
        (ceremony.binding.documentId === undefined ||
            typeof ceremony.binding.documentId === "string") &&
        typeof ceremony.origin === "string" &&
        typeof ceremony.rpId === "string" &&
        typeof ceremony.challenge === "string" &&
        ["required", "preferred", "discouraged"].includes(
            ceremony.userVerification!,
        ) &&
        Array.isArray(ceremony.eligibleCredentials) &&
        ceremony.eligibleCredentials.every(
            (candidate) =>
                typeof candidate?.vaultCredentialId === "string" &&
                typeof candidate.authenticatorCredentialId === "string",
        ) &&
        typeof ceremony.createdAt === "number" &&
        Number.isFinite(ceremony.createdAt) &&
        Number.isSafeInteger(ceremony.passwordAttempts) &&
        ceremony.passwordAttempts! >= 0 &&
        (ceremony.result === undefined ||
            ceremony.result.outcome === "authenticated" ||
            ceremony.result.outcome === "fallback")
    );
}

async function pruneCeremonies(binding: SenderBinding): Promise<void> {
    const all = await chrome.storage.session.get(null);
    const entries = Object.entries(all).filter(([key]) =>
        key.startsWith(CEREMONY_PREFIX),
    );
    const now = Date.now();
    const remove: string[] = [];
    const retained: Array<{
        key: string;
        ceremony: StoredPasskeyAssertionCeremony;
    }> = [];
    for (const [key, value] of entries) {
        if (
            !isStoredCeremony(value) ||
            now - value.createdAt > CEREMONY_TTL_MS ||
            (value.binding.tabId === binding.tabId &&
                value.binding.frameId === binding.frameId &&
                value.binding.documentId === binding.documentId)
        ) {
            remove.push(key);
        } else {
            retained.push({ key, ceremony: value });
        }
    }
    retained.sort(
        (left, right) => left.ceremony.createdAt - right.ceremony.createdAt,
    );
    const overflow = Math.max(0, retained.length - MAX_ACTIVE_CEREMONIES + 1);
    remove.push(...retained.slice(0, overflow).map(({ key }) => key));
    if (remove.length) await chrome.storage.session.remove(remove);
}

function candidateFromCredential(
    credential: VaultUtilTypes.Credential,
): PasskeyAssertionCandidate {
    return {
        credentialId: credential.ID,
        userName: credential.Passkey!.UserName,
        userDisplayName:
            credential.Passkey!.UserDisplayName || credential.Passkey!.UserName,
    };
}

export async function beginPasskeyAssertion(
    request: BeginPasskeyAssertionRequest | null | undefined,
    vault: VaultUtilTypes.Vault | null,
    vaultDbIndex: number | null | undefined,
    requestOrigin: AutofillRequestOrigin,
    sender: chrome.runtime.MessageSender,
): Promise<BeginPasskeyAssertionResponse> {
    if (!isValidRequest(request))
        return { ok: false, error: "INVALID_PAYLOAD" };
    if (!vault || vaultDbIndex == null) {
        return { ok: false, error: "VAULT_NOT_UNLOCKED" };
    }
    const binding = senderBinding(sender);
    if (!binding) return { ok: false, error: "REQUEST_ORIGIN_UNAVAILABLE" };
    const rpId = resolveValidRpId(requestOrigin, request.publicKey.rpId);
    if (!rpId) return { ok: false, error: "INVALID_RP_ID" };

    const allowedIds = new Set(
        request.publicKey.allowCredentials.map((descriptor) => descriptor.id),
    );
    const hasAllowList = allowedIds.size > 0;
    const eligible = (vault.Credentials ?? []).filter((credential) => {
        const passkey = credential.Passkey;
        if (credential.Deleted || !passkey || passkey.RPID !== rpId)
            return false;
        return hasAllowList
            ? allowedIds.has(passkey.CredentialID)
            : passkey.Discoverable;
    });

    if (!eligible.length) {
        return { ok: true, ceremonyId: null };
    }

    const pending = await chrome.storage.session.get(PENDING_CONFIRMATION_KEY);
    const pendingId = pending[PENDING_CONFIRMATION_KEY];
    if (typeof pendingId === "string") {
        const existing = await readCeremony(pendingId);
        if (existing && !existing.result) {
            return { ok: false, error: "PASSKEY_CONFIRMATION_BUSY" };
        }
        await chrome.storage.session.remove(PENDING_CONFIRMATION_KEY);
    }

    await pruneCeremonies(binding);
    const ceremonyId = crypto.randomUUID();
    const ceremony: StoredPasskeyAssertionCeremony = {
        version: 2,
        vaultDbIndex,
        binding,
        origin: new URL(requestOrigin.url).origin,
        rpId,
        challenge: request.publicKey.challenge,
        userVerification: request.publicKey.userVerification,
        eligibleCredentials: eligible.map((credential) => ({
            vaultCredentialId: credential.ID,
            authenticatorCredentialId: credential.Passkey!.CredentialID,
        })),
        createdAt: Date.now(),
        passwordAttempts: 0,
    };
    await chrome.storage.session.set({
        [ceremonyKey(ceremonyId)]: ceremony,
        [PENDING_CONFIRMATION_KEY]: ceremonyId,
    });

    return { ok: true, ceremonyId };
}

async function readCeremony(
    ceremonyId: string,
): Promise<StoredPasskeyAssertionCeremony | null> {
    const key = ceremonyKey(ceremonyId);
    const result = await chrome.storage.session.get(key);
    const ceremony = result[key];
    if (!isStoredCeremony(ceremony)) {
        if (ceremony !== undefined) await chrome.storage.session.remove(key);
        return null;
    }
    if (Date.now() - ceremony.createdAt > CEREMONY_TTL_MS) {
        await chrome.storage.session.remove(key);
        return null;
    }
    return ceremony;
}

export async function completePasskeyAssertion(
    request: CompletePasskeyAssertionRequest | null | undefined,
    vault: VaultUtilTypes.Vault | null,
    metadata: VaultMetadata | null,
): Promise<CompletePasskeyAssertionResponse> {
    if (
        !request ||
        !isCeremonyId(request.ceremonyId) ||
        typeof request.credentialId !== "string" ||
        request.credentialId.length === 0 ||
        request.credentialId.length > 128
    ) {
        return { ok: false, error: "INVALID_PAYLOAD" };
    }
    const ceremony = await readCeremony(request.ceremonyId);
    if (!ceremony) return { ok: false, error: "CEREMONY_NOT_FOUND" };
    if (ceremony.result) {
        return { ok: false, error: "CEREMONY_ALREADY_FINISHED" };
    }
    const pending = await chrome.storage.session.get(PENDING_CONFIRMATION_KEY);
    if (pending[PENDING_CONFIRMATION_KEY] !== request.ceremonyId) {
        return { ok: false, error: "CEREMONY_NOT_PENDING" };
    }
    if (!vault || !metadata || metadata.DBIndex !== ceremony.vaultDbIndex) {
        return { ok: false, error: "VAULT_NOT_UNLOCKED" };
    }
    const eligible = ceremony.eligibleCredentials.find(
        (candidate) => candidate.vaultCredentialId === request.credentialId,
    );
    if (!eligible) {
        return { ok: false, error: "CREDENTIAL_NOT_ELIGIBLE" };
    }

    const requiresPassword = ceremony.userVerification !== "discouraged";
    if (requiresPassword) {
        if (!request.vaultPassword) {
            return { ok: false, error: "VAULT_PASSWORD_REQUIRED" };
        }
        const verified = await verifyVaultMasterPassword(
            metadata,
            request.vaultPassword,
        );
        if (!verified) {
            ceremony.passwordAttempts += 1;
            if (ceremony.passwordAttempts >= MAX_PASSWORD_ATTEMPTS) {
                await chrome.storage.session.remove(
                    ceremonyKey(request.ceremonyId),
                );
                await chrome.storage.session.remove(PENDING_CONFIRMATION_KEY);
                return { ok: false, error: "TOO_MANY_PASSWORD_ATTEMPTS" };
            }
            await chrome.storage.session.set({
                [ceremonyKey(request.ceremonyId)]: ceremony,
            });
            return { ok: false, error: "INVALID_VAULT_PASSWORD" };
        }
    }

    const credential = (vault.Credentials ?? []).find(
        (candidate) =>
            candidate.ID === request.credentialId &&
            !candidate.Deleted &&
            candidate.Passkey?.RPID === ceremony.rpId,
    );
    if (!credential?.Passkey) {
        return { ok: false, error: "CREDENTIAL_NOT_FOUND" };
    }
    if (
        credential.Passkey.CredentialID !== eligible.authenticatorCredentialId
    ) {
        return { ok: false, error: "CREDENTIAL_CHANGED" };
    }

    try {
        const assertion = await generatePasskeyAssertion({
            passkey: credential.Passkey,
            challenge: ceremony.challenge,
            rpId: ceremony.rpId,
            origin: ceremony.origin,
            userVerified: requiresPassword,
        });
        ceremony.result = { outcome: "authenticated", assertion };
        await chrome.storage.session.set({
            [ceremonyKey(request.ceremonyId)]: ceremony,
        });
        await chrome.storage.session.remove(PENDING_CONFIRMATION_KEY);
        return { ok: true };
    } catch {
        return { ok: false, error: "ASSERTION_GENERATION_FAILED" };
    }
}

export async function cancelPasskeyAssertion(
    request: CancelPasskeyAssertionRequest | null | undefined,
    sender: chrome.runtime.MessageSender,
): Promise<{ ok: boolean; error?: string }> {
    if (!request || !isCeremonyId(request.ceremonyId)) {
        return { ok: false, error: "INVALID_PAYLOAD" };
    }
    const ceremony = await readCeremony(request.ceremonyId);
    if (!ceremony) return { ok: true };
    if (!bindingMatches(ceremony.binding, sender)) {
        return { ok: false, error: "CEREMONY_SENDER_MISMATCH" };
    }
    const pending = await chrome.storage.session.get(PENDING_CONFIRMATION_KEY);
    await chrome.storage.session.remove(ceremonyKey(request.ceremonyId));
    if (pending[PENDING_CONFIRMATION_KEY] === request.ceremonyId) {
        await chrome.storage.session.remove(PENDING_CONFIRMATION_KEY);
    }
    return { ok: true };
}

export async function getPendingPasskeyAssertion(
    vault: VaultUtilTypes.Vault | null,
): Promise<GetPendingPasskeyAssertionResponse> {
    const stored = await chrome.storage.session.get(PENDING_CONFIRMATION_KEY);
    const ceremonyId = stored[PENDING_CONFIRMATION_KEY];
    if (typeof ceremonyId !== "string") return { ok: true, pending: null };
    const ceremony = await readCeremony(ceremonyId);
    if (!ceremony || ceremony.result) {
        await chrome.storage.session.remove(PENDING_CONFIRMATION_KEY);
        return { ok: true, pending: null };
    }
    if (!vault) return { ok: false, error: "VAULT_NOT_UNLOCKED" };
    const candidates = ceremony.eligibleCredentials.flatMap((eligible) => {
        const credential = (vault.Credentials ?? []).find(
            (item) =>
                item.ID === eligible.vaultCredentialId &&
                !item.Deleted &&
                item.Passkey?.CredentialID ===
                    eligible.authenticatorCredentialId &&
                item.Passkey.RPID === ceremony.rpId,
        );
        return credential ? [candidateFromCredential(credential)] : [];
    });
    if (!candidates.length) return { ok: false, error: "CREDENTIAL_NOT_FOUND" };
    return {
        ok: true,
        pending: {
            ceremonyId,
            rpId: ceremony.rpId,
            candidates,
            requiresPassword: ceremony.userVerification !== "discouraged",
        },
    };
}

export async function consumePasskeyAssertionResult(
    request: CancelPasskeyAssertionRequest | null | undefined,
    vaultDbIndex: number | null | undefined,
    requestOrigin: AutofillRequestOrigin,
    sender: chrome.runtime.MessageSender,
): Promise<ConsumePasskeyAssertionResultResponse> {
    if (!request || !isCeremonyId(request.ceremonyId)) {
        return { ok: false, error: "INVALID_PAYLOAD" };
    }
    const ceremony = await readCeremony(request.ceremonyId);
    if (!ceremony) return { ok: false, error: "CEREMONY_NOT_FOUND" };
    if (!bindingMatches(ceremony.binding, sender)) {
        return { ok: false, error: "CEREMONY_SENDER_MISMATCH" };
    }
    if (
        vaultDbIndex !== ceremony.vaultDbIndex ||
        new URL(requestOrigin.url).origin !== ceremony.origin ||
        resolveValidRpId(requestOrigin, ceremony.rpId) !== ceremony.rpId
    ) {
        return { ok: false, error: "CEREMONY_ORIGIN_MISMATCH" };
    }
    if (!ceremony.result) return { ok: true, status: "pending" };
    await chrome.storage.session.remove(ceremonyKey(request.ceremonyId));
    return ceremony.result.outcome === "authenticated"
        ? {
              ok: true,
              status: "authenticated",
              assertion: ceremony.result.assertion,
          }
        : { ok: true, status: ceremony.result.outcome };
}

export async function declinePasskeyAssertion(
    request: CancelPasskeyAssertionRequest | null | undefined,
): Promise<{ ok: boolean; error?: string }> {
    if (!request || !isCeremonyId(request.ceremonyId)) {
        return { ok: false, error: "INVALID_PAYLOAD" };
    }
    const ceremony = await readCeremony(request.ceremonyId);
    if (!ceremony) return { ok: true };
    if (!ceremony.result) {
        ceremony.result = { outcome: "fallback" };
        await chrome.storage.session.set({
            [ceremonyKey(request.ceremonyId)]: ceremony,
        });
    }
    const pending = await chrome.storage.session.get(PENDING_CONFIRMATION_KEY);
    if (pending[PENDING_CONFIRMATION_KEY] === request.ceremonyId) {
        await chrome.storage.session.remove(PENDING_CONFIRMATION_KEY);
    }
    return { ok: true };
}
