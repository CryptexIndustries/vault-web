/**
 * Platform-neutral Online Services session lifecycle.
 *
 * Shared sync/link code uses this port for refresh and re-auth retries.
 * JWT storage and header injection stay in platform layers (web Jotai +
 * tRPC headers, extension SW + ProxyFetch).
 */
export interface OnlineServicesSessionPort {
    /** Best-effort refresh or establish before protected API calls. */
    ensureFresh(): Promise<boolean>;

    /** Full re-auth after a protected call returns UNAUTHORIZED. */
    forceReauthenticate(): Promise<boolean>;
}
