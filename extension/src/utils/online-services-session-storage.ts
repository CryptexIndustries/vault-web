/**
 * Service-worker owned storage for the Online Services session token.
 *
 * The popup, link, and offscreen contexts deliberately do NOT touch this -
 * they call back into the SW (via {@link MessageType.ProxyFetch} or the
 * dedicated establish/clear messages) so we have a single owner of the
 * Authorization header lifecycle.
 *
 * `chrome.storage.session` keeps the token in memory only and clears it when
 * the browser shuts down. That matches the JWT lifetime semantics and avoids
 * accidentally persisting credentials to disk between sessions.
 *
 * `deviceId` / `privateKeyJWK` are duplicated here from the unlocked vault
 * so the SW can re-authenticate when the popup is closed (i.e. the vault
 * session may be live but the popup atoms are gone). They are written ONLY
 * when the caller already had them in plaintext (link flow handing them in,
 * or the SW pulling them out of the unlocked vault).
 */

const STORAGE_KEY = "OS_SESSION";

export interface OnlineServicesSessionRecord {
    /** Bearer JWT signed by the auth router. `null` when never established. */
    sessionToken: string | null;
    /** Unix epoch (seconds) — matches `signSessionToken`'s `expiresAt`. */
    sessionExpiresAt: number | null;
    /** Device id that owns the passkey signing the challenge. */
    deviceId: string | null;
    /**
     * Private key JWK (serialised string) for the device passkey, kept so we
     * can re-establish a session without re-prompting the user when the SW
     * wakes up from a sleep or when the popup isn't open.
     */
    privateKeyJWK: string | null;
}

const EMPTY: OnlineServicesSessionRecord = {
    sessionToken: null,
    sessionExpiresAt: null,
    deviceId: null,
    privateKeyJWK: null,
};

export async function getOnlineServicesSession(): Promise<OnlineServicesSessionRecord> {
    const result = await chrome.storage.session.get(STORAGE_KEY);
    const raw = result[STORAGE_KEY];

    if (!raw || typeof raw !== "object") return { ...EMPTY };

    return {
        sessionToken:
            typeof raw.sessionToken === "string" ? raw.sessionToken : null,
        sessionExpiresAt:
            typeof raw.sessionExpiresAt === "number"
                ? raw.sessionExpiresAt
                : null,
        deviceId: typeof raw.deviceId === "string" ? raw.deviceId : null,
        privateKeyJWK:
            typeof raw.privateKeyJWK === "string" ? raw.privateKeyJWK : null,
    };
}

export async function setOnlineServicesSession(
    patch: Partial<OnlineServicesSessionRecord>,
): Promise<OnlineServicesSessionRecord> {
    const current = await getOnlineServicesSession();
    const next: OnlineServicesSessionRecord = { ...current, ...patch };
    await chrome.storage.session.set({ [STORAGE_KEY]: next });
    return next;
}

export async function clearOnlineServicesSession(): Promise<void> {
    await chrome.storage.session.remove(STORAGE_KEY);
}
