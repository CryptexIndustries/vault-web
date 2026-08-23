import type {
    CredentialURL,
    CredentialURLMatchMode,
} from "@cryptex-industries/vault-core/proto";

export enum MessageType {
    GetState = 0,
    Unlock = 2,
    Lock = 3,
    GetCredentials = 4,
    GetCredential = 5,
    CreateCredential = 6,
    UpdateCredential = 7,
    DeleteCredential = 8,
    GetLinkedDevices = 9,
    GetPublicKey = 10,

    SyncGetItems = 11,
    SyncGetVersionVectors = 12,
    SyncGetConfiguration = 13,
    SyncUpdateItems = 14,

    /**
     * Proxied tRPC fetch from a UI context (popup/link page) to the SW.
     * The SW is solely responsible for attaching the Authorization header
     * and performing/refreshing the Online Services session. Body is the
     * raw fetch payload; SW returns the deserialized HTTP response shape.
     */
    ProxyFetch = 15,

    /**
     * Bootstraps an Online Services session in the SW using the device
     * credentials decrypted out of a link package. Used during the link
     * receive flow, before the vault has been persisted.
     */
    OnlineServicesEstablish = 16,

    /** Discards any cached Online Services session token in the SW. */
    OnlineServicesClear = 17,

    /** Refreshes or re-establishes the SW Online Services session. */
    OnlineServicesEnsureFresh = 18,

    /** Forces a full Online Services re-auth in the SW after UNAUTHORIZED. */
    OnlineServicesForceReauthenticate = 28,

    /**
     * Autofill: list credentials authorized for the sender-derived page URL.
     * Never returns secrets.
     */
    GetCredentialsForOrigin = 19,

    /**
     * Autofill: one-shot fetch of a credential's secret material
     * (username + password + optional TOTP secret). The SW does not cache
     * the response; the caller is expected to wipe the values immediately
     * after injecting them into the page.
     */
    GetCredentialSecret = 20,

    /**
     * Autofill: stash a "would you like to save this login?" prompt
     * payload in SW-owned session storage and surface a UI cue (badge +
     * best-effort `chrome.action.openPopup()`). The popup later reads the
     * payload through `GetPendingSavePrompt`.
     */
    SaveCredentialPrompt = 21,

    /** Autofill: popup reads a pending save-credential prompt (if any). */
    GetPendingSavePrompt = 22,

    /** Autofill: popup clears a pending save-credential prompt. */
    ConsumePendingSavePrompt = 23,

    /**
     * Autofill: content script asks the SW to open the action popup so
     * the user can unlock the vault. The SW invokes
     * `chrome.action.openPopup()` (best-effort; not all Chrome versions
     * honour it outside a user gesture).
     */
    OpenPopup = 24,

    /**
     * Autofill: compute a fresh TOTP code for a credential. Used by the
     * inline menu when the focused field is `one-time-code`.
     */
    GenerateTOTP = 25,

    /**
     * Autofill: content script registers an iframe bootstrap nonce with
     * the SW before loading an extension iframe on a host page.
     */
    RegisterAutofillFrame = 26,

    /**
     * Autofill: extension iframe claims its bootstrap nonce from the SW.
     * The host page can see the mount id in the iframe URL, but cannot
     * call this extension-only message to learn the secret nonce.
     */
    ClaimAutofillFrame = 27,
    GetDirectories = 29,

    /** Popup: read the sender-verified origin context for the active tab. */
    GetActivePageOrigin = 30,

    /** Content script: refresh its tab's sender-verified page origin. */
    ReportPageOrigin = 31,

    /**
     * Popup: record a completed synchronization with a linked device so the
     * persisted `LinkedDevice.LastSync` can feed the last-sync UI.
     */
    SyncSetLastSync = 32,
}

/**
 * The set of in-extension contexts that may originate envelope traffic.
 * "link" covers the dedicated `link.html` page used for the receive-link
 * flow, which historically wasn't recognised by the origin validator.
 * The "autofill-*" origins cover the page-injected autofill surfaces:
 *   - `autofill-cs`: content script running in the host page (isolated
 *     world). Only ever validated when `sender.frameId === 0` so
 *     clickjacked sub-frames cannot pose as the top frame.
 *   - `autofill-menu`: shared inline picker/unlock iframe loaded from the
 *     extension.
 *   - `autofill-generator`: inline password generator iframe loaded from
 *     the extension.
 *   - `autofill-save`: persistent save-login iframe loaded from the
 *     extension.
 */
export type EnvelopeOrigin =
    | "popup"
    | "worker"
    | "link"
    | "autofill-cs"
    | "autofill-menu"
    | "autofill-generator"
    | "autofill-save";

/**
 * Wire shape used by `MessageType.ProxyFetch` request payloads.
 * Only string bodies are supported (sufficient for tRPC `httpBatchLink`).
 */
export interface ProxyFetchRequestPayload {
    url: string;
    method: string;
    headers: Record<string, string>;
    body: string | null;
}

/** Wire shape returned to the caller after the SW executes the proxied fetch. */
export interface ProxyFetchResponsePayload {
    ok: boolean;
    status: number;
    statusText: string;
    headers: Record<string, string>;
    body: string;
    error?: string;
}

// The payload is defined by the message type
// export type Message<T extends MessageType> = {
//     type: T;
//     payload: MessagePayload[T];
// };

// export type MessagePayload = {
//     [MessageType.GetState]: undefined;
//     [MessageType.Unlock]: {
//         index?: number;
//         form: EncryptionFormGroupSchemaType;
//     };
//     [MessageType.Lock]: undefined;
//     [MessageType.GetCredentials]: undefined;
//     [MessageType.GetCredential]: {
//         id: string;
//     };
//     [MessageType.CreateCredential]: {
//         form: CredentialFormSchemaType;
//     };
//     [MessageType.UpdateCredential]: {
//         id: string;
//         form: CredentialFormSchemaType;
//     };
//     [MessageType.DeleteCredential]: {
//         id: string;
//     };
//     [MessageType.GetPublicKey]: undefined;
// };

export type LiteCredential = {
    id: string;
    name: string;
    username: string;
    url: string;
    urlMatchMode: CredentialURLMatchMode;
    additionalUrls: CredentialURL[];
    hasTOTP?: boolean;
    directoryId: string;
};

export interface ActivePageOrigin {
    tabId: number;
    host: string;
    url: string;
    etldPlus1: string;
}

export interface GetActivePageOriginResponse {
    ok: true;
    context: ActivePageOrigin | null;
}

/** Internal SW-to-content-script query used to validate the current document. */
export const ACTIVE_PAGE_ORIGIN_QUERY = "cryptex:active-page-origin" as const;

/** Response for `MessageType.GetCredentialsForOrigin`. */
export interface GetCredentialsForOriginResponse {
    ok: boolean;
    matches: LiteCredential[];
    error?: string;
}
export type AutofillFrameKind =
    | "autofill-menu"
    | "autofill-generator"
    | "autofill-save";

export interface RegisterAutofillFrameRequest {
    mountId: string;
    nonce: string;
    kind: AutofillFrameKind;
}

export interface ClaimAutofillFrameRequest {
    mountId: string;
    kind: AutofillFrameKind;
}

export interface ClaimAutofillFrameResponse {
    ok: boolean;
    nonce?: string;
    error?: string;
}

/** Payload for `MessageType.GetCredentialSecret`. */
export interface GetCredentialSecretRequest {
    id: string;
}

/** Response for `MessageType.GetCredentialSecret`. */
export interface GetCredentialSecretResponse {
    ok: boolean;
    username?: string;
    password?: string;
    totpSecret?: {
        secret: string;
        algorithm: number;
        digits: number;
        period: number;
    } | null;
    error?: string;
}

/** Payload for `MessageType.SaveCredentialPrompt`. */
export interface SaveCredentialPromptRequest {
    host: string;
    url: string;
    username: string;
    password: string;
}

/** Response shape returned from `MessageType.GetPendingSavePrompt`. */
export interface PendingSavePrompt {
    host: string;
    url: string;
    username: string;
    password: string;
    /** Epoch millis when the prompt was stashed. Used to enforce a TTL. */
    stashedAt: number;
}

/** Response for `MessageType.GenerateTOTP`. */
export interface GenerateTOTPResponse {
    ok: boolean;
    code?: string;
    timeRemaining?: number;
    error?: string;
}

/** Payload for `MessageType.SyncSetLastSync`. */
export interface SyncSetLastSyncRequest {
    deviceId: string;
    /** ISO-8601 timestamp of the completed synchronization. */
    timestamp: string;
}

// type MessageResponsePayload = {
//     [-1]: { error: string }; // Error response
//     [MessageType.GetState]: {
//         unlocked: boolean;
//         metadata: { id?: number; name: string } | null;
//     };
//     [MessageType.Unlock]: { ok: boolean; error?: string };
//     [MessageType.Lock]: { ok: boolean };
//     [MessageType.GetCredentials]: {
//         ok: boolean;
//         credentials: LiteCredential[];
//     };
//     [MessageType.GetCredential]: {
//         ok: boolean;
//         credential: VaultCredential | null;
//         error?: string;
//     };
//     [MessageType.CreateCredential]: {
//         ok: boolean;
//         credential: VaultCredential | null;
//         error?: string;
//     };
//     [MessageType.UpdateCredential]: {
//         ok: boolean;
//         credential: VaultCredential | null;
//         error?: string;
//     };
//     [MessageType.DeleteCredential]: { ok: boolean; error?: string };
//     [MessageType.GetPublicKey]: {
//         ok: boolean;
//         keyId: string;
//         curve: string;
//         publicKeyJwk: JsonWebKey;
//         createdAt: string;
//         error?: string;
//     };
// };

// Discriminated unions for better type-narrowing on message handlers
// export type AnyMessage =
//     | { type: MessageType.GetState; payload: MessagePayload[MessageType.GetState] }
//     | { type: MessageType.Unlock; payload: MessagePayload[MessageType.Unlock] }
//     | { type: MessageType.Lock; payload: MessagePayload[MessageType.Lock] }
//     | { type: MessageType.GetCredentials; payload: MessagePayload[MessageType.GetCredentials] }
//     | { type: MessageType.GetCredential; payload: MessagePayload[MessageType.GetCredential] }
//     | { type: MessageType.CreateCredential; payload: MessagePayload[MessageType.CreateCredential] }
//     | { type: MessageType.UpdateCredential; payload: MessagePayload[MessageType.UpdateCredential] }
//     | { type: MessageType.DeleteCredential; payload: MessagePayload[MessageType.DeleteCredential] }
//     | { type: MessageType.EnsureOffscreen; payload: MessagePayload[MessageType.EnsureOffscreen] }
//     | { type: MessageType.GetPublicKey; payload: MessagePayload[MessageType.GetPublicKey] }

// export type AnyMessageResponse =
//     | { type: -1; payload: MessageResponsePayload[-1] } // Error response
//     | { type: MessageType.GetState; payload: MessageResponsePayload[MessageType.GetState] }
//     | { type: MessageType.Unlock; payload: MessageResponsePayload[MessageType.Unlock] }
//     | { type: MessageType.Lock; payload: MessageResponsePayload[MessageType.Lock] }
//     | { type: MessageType.GetCredentials; payload: MessageResponsePayload[MessageType.GetCredentials] }
//     | { type: MessageType.GetCredential; payload: MessageResponsePayload[MessageType.GetCredential] }
//     | { type: MessageType.CreateCredential; payload: MessageResponsePayload[MessageType.CreateCredential] }
//     | { type: MessageType.UpdateCredential; payload: MessageResponsePayload[MessageType.UpdateCredential] }
//     | { type: MessageType.DeleteCredential; payload: MessageResponsePayload[MessageType.DeleteCredential] }
//     | { type: MessageType.EnsureOffscreen; payload: MessageResponsePayload[MessageType.EnsureOffscreen] }
//     | { type: MessageType.GetPublicKey; payload: MessageResponsePayload[MessageType.GetPublicKey] }

// Encrypted envelope structure for secure messaging
export interface EncryptedEnvelope {
    type: MessageType;
    requestId: string;
    origin: EnvelopeOrigin;
    keyId: string;
    timestamp: string;
    payload: {
        wrappedKey: string; // base64url encoded ephemeral public key
        ephemeralPub: JsonWebKey;
        salt: string; // base64url encoded salt
        ciphertext: string | null; // base64url encoded encrypted data
        iv: string | null; // base64url encoded IV
    };
}

// Plaintext envelope for non-sensitive messages (like GET_PUBLIC_KEY)
export interface PlaintextEnvelope {
    type: MessageType;
    requestId: string;
    origin: EnvelopeOrigin;
    timestamp: string;
    payload: ({ ok: boolean } & any) | { ok: false; error: string };
}
