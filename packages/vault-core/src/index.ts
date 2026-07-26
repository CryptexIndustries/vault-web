/**
 * @cryptex-industries/vault-core
 *
 * Prefer subpath imports for modules with proto name collisions
 * (e.g. `Vault`, `EncryptedBlob` classes vs protobuf interfaces).
 */

export {
    uint8ToBase64,
    base64ToUint8,
    uint8ToBase64Url,
    base64UrlToUint8,
} from "./encoding";
export {
    TOTPConstants,
    CredentialConstants,
    BACKUP_FILE_EXTENSION,
    LINK_FILE_EXTENSION,
    REQUIRED_FIELD_ERROR,
    ONLINE_SERVICES_SELECTION_ID,
} from "./consts";
export { normalizeCredentialUrl } from "./credential-url";

export {
    configureVaultCoreRuntime,
    getVaultCoreRuntime,
    getEnvelopeCrypto,
    getSecondFactorStore,
    isVaultCoreRuntimeConfigured,
    type VaultCoreRuntime,
    type VaultCorePusherEnv,
    type VaultCoreLogger,
    type VaultCoreOnlineServicesApi,
    type VaultCoreSecondFactorStore,
    type VaultEnvelopeCrypto,
    type VaultEnvelopeCryptoBackend,
    type VaultHkdfKey,
    type VaultKek,
} from "./runtime";

export {
    constructLinkPresenceChannelName,
    constructSyncPresenceChannelName,
} from "./presence";
export {
    authorizePresenceChannel,
    type AuthorizePresenceChannelInput,
    type PresenceChannelAuthResponse,
    type PresenceChannelUserData,
} from "./pusher-auth";

export type { OnlineServicesSessionPort } from "./online-services-session/port";
export {
    SESSION_REFRESH_LEAD_MS,
    FORCED_REAUTH_COOLDOWN_MS,
    shouldRefreshOnlineServicesSession,
    performOnlineServicesDeviceSigningKeyAuth,
    refreshOnlineServicesSessionTokens,
    createRefreshInFlightRunner,
    createForcedReauthGate,
    type OnlineServicesSessionTokens,
    type OnlineServicesAuthApi,
} from "./online-services-session/protocol";

/** Protobuf namespace (interfaces/enums/encode/decode). */
export * as VaultUtilTypes from "./proto/vault";
