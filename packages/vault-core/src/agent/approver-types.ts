import type {
    Envelope,
    PairingOffer,
    RefusalReason,
    SignRequest,
} from "../proto/agent";
import type { AgentIdentity } from "./envelope";

/**
 * The contract between the platform-neutral approver (approver.ts) and its
 * host, the shared runtime (runtime.ts) that the Android app and the web
 * dashboard run. The host owns storage, UI and the vault; the approver owns
 * the relay connections and the protocol.
 */

/** Where an agent's relay is. Agents keep the relay they were paired on. */
export type RelayTarget =
    | { kind: "hosted"; url: string }
    | { kind: "custom"; url: string; token: string };

/** The minimal WebSocket the approver needs (browser and React Native). */
export interface WebSocketLike {
    binaryType: string;
    readonly readyState: number;
    send(data: Uint8Array): void;
    close(code?: number, reason?: string): void;
    onopen: ((ev: unknown) => void) | null;
    onclose: ((ev: { code: number; reason: string }) => void) | null;
    onerror: ((ev: unknown) => void) | null;
    onmessage:
        | ((ev: { data: ArrayBuffer | Uint8Array | string }) => void)
        | null;
}

export type ApproverHost = {
    /** This device's approver identity; it stays on this device, never synced. */
    identity: AgentIdentity;
    /** Name shown to agents, such as "Pixel 8". */
    deviceName: string;
    openWebSocket: (url: string, protocols: string[]) => WebSocketLike;
    fetch: typeof fetch;
    now?: () => number;
    /**
     * A relay pass for the hosted relay, bound to identity's relay key. The
     * host fetches and caches it (Online Services signs out when the vault
     * locks, so it is fetched while unlocked). Null when none is available.
     */
    getPass: (relay: RelayTarget) => Promise<string | null>;
    /** The relays this device's agents use; the approver connects to each. */
    relays: () => RelayTarget[];
    /** Agents this device approves, by agent key (base64url), with their peers. */
    agents: () => ApprovedAgent[];
    /**
     * The hosted relay this app is configured with (NEXT_PUBLIC_RELAY_URL,
     * EXPO_PUBLIC_RELAY_URL). A pairing code naming it is accepted before
     * any agent uses it, with relay pass authentication. Defaults to
     * HOSTED_RELAY_URL.
     */
    hostedRelayUrl?: string;
    /** Bound for unregistering a pairing that wasn't kept (PAIRING_CLEANUP_MS). */
    pairingCleanupMs?: number;
    /** A new sign request, seen for the first time. */
    onRequest: (request: IncomingRequest) => void;
    /**
     * The agent sent a request again that onRequest reported before (it
     * reconnected, or lost the answer): the host resends its answer if it
     * may. The approver resends its own refusals itself.
     */
    onRepeat?: (requestId: string) => void;
    /**
     * The relay withdrew the request (it says it doesn't know the agent).
     * The host owns expiry; the approver reports transport facts only.
     */
    onRequestGone: (requestId: string) => void;
    onAgentConfirmed: (agentId: string) => void;
    /**
     * The relay says it doesn't know the agent: it is missing from Ready, or
     * a Revoked frame came. The relay is untrusted (and may just have lost
     * its database), so hosts keep this as a local state and never treat it
     * as a revocation.
     */
    onRelayDroppedAgent: (agentId: string) => void;
    /** Ready lists the agent again. */
    onRelayListedAgent?: (agentId: string) => void;
    log?: (message: string, detail?: unknown) => void;
};

export type ApprovedAgent = {
    id: string;
    signPublicKey: Uint8Array;
    kemPublicKey: Uint8Array;
    relay: RelayTarget;
    /**
     * SSH wire public keys granted to the agent. When set, requests for other
     * keys are refused (KEY_NOT_GRANTED) without reaching onRequest.
     */
    grantedKeys?: Uint8Array[];
};

/** What the approver could verify about a request. */
export type RequestCheck = {
    kind: "login" | "signature" | "other";
    /** SSHSIG namespace ("git", "file", ...). */
    namespace?: string;
    /** Login user name from the userauth data. */
    user?: string;
    /** Server key that signed the session, verified by the approver. */
    verifiedHost?: {
        hostKey: Uint8Array;
        fingerprint: string;
        /** Names from the machine's known_hosts; reported, not verified. */
        names: string[];
    };
    /** Earlier hops when the request came through agent forwarding. */
    forwardedVia: { fingerprint: string; names: string[] }[];
    /** No usable session-bind: ask with a warning, never remember. */
    destinationUnknown: boolean;
    /** Logins: the userauth signature algorithm, such as "rsa-sha2-512". */
    algorithm?: string;
};

export type IncomingRequest = {
    /** base64url message ID; repeats of the same request reuse it. */
    id: string;
    agentId: string;
    receivedAt: number;
    expiresAt: number;
    sign: SignRequest;
    check: RequestCheck;
};

export type SignAnswer = { signature: Uint8Array } | { refusal: RefusalReason };

/** A scanned or pasted pairing code, claimed on its relay. */
export type ClaimedPairing = {
    relay: RelayTarget;
    offer: PairingOffer;
    /** The agent ID (base64url of offer.signPublicKey). */
    agentId: string;
    /** When the claim runs out (unix ms). */
    expiresAt: number;
};

export type PairingResult = {
    /** Show this; the terminal shows the same. */
    confirmationCode: string;
    /** Store it in the ConnectedAgent record. */
    revocationSeed: Uint8Array;
    keysRevision: number;
};

export type GrantedKeyInput = {
    /** SSH wire public key. */
    publicKey: Uint8Array;
    /** Shown by ssh-add -L, such as "GitHub (Cryptex Vault)". */
    comment: string;
};

export type { Envelope };
