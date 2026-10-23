import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import {
    base64ToUint8,
    uint8ToBase64,
} from "@cryptex-industries/vault-core/encoding";
import {
    generateAgentIdentity,
    type AgentIdentity,
} from "@cryptex-industries/vault-core/agent/envelope";
import type {
    CachedAgent,
    CustomRelay,
    LocalAgentApproval,
    LocalApprovalStore,
} from "@cryptex-industries/vault-core/agent/runtime";

/**
 * SSH agent approver state kept outside the vault, so the relay connection,
 * notifications and Deny work while the vault is locked. Signing still needs
 * the unlocked vault: no SSH private key is stored here.
 *
 * - Approver identity (two 32-byte seeds) and custom relay tokens: device
 *   secure storage, readable after the first unlock since boot.
 * - The hosted relay pass: secure storage too (bound to the identity key).
 * - Agents this device approves (IDs, names, public keys, relay): plain app
 *   storage, since all of it is public and names only feed notifications.
 * - The agents this phone paired and the keys it granted them: secure
 *   storage. The runtime serves and signs only what this list and the synced
 *   record agree on, so a linked device can't add agents or grants here.
 */

const IDENTITY_KEY = "cryptex.agent.identity";
const RELAY_PASS_KEY = "cryptex.agent.relay-pass";
const CUSTOM_RELAYS_KEY = "cryptex.agent.relays";
const AGENT_CACHE_KEY = "cryptex:agent-cache";
const LOCAL_APPROVALS_KEY = "cryptex.agent.local-approvals";

const secureOptions: SecureStore.SecureStoreOptions = {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

const secure = {
    get: (key: string) => SecureStore.getItemAsync(key, secureOptions),
    set: (key: string, value: unknown) =>
        SecureStore.setItemAsync(key, JSON.stringify(value), secureOptions),
    remove: (key: string) => SecureStore.deleteItemAsync(key, secureOptions),
};

/** Stored JSON through read(), or the fallback when missing or unreadable. */
function parseStored<T>(saved: string | null, fallback: T, read: (parsed: unknown) => T): T {
    if (!saved) return fallback;
    try {
        return read(JSON.parse(saved));
    } catch {
        return fallback;
    }
}

let identityPromise: Promise<AgentIdentity> | null = null;

/** This device's approver identity, created on first use. */
export function loadApproverIdentity(): Promise<AgentIdentity> {
    identityPromise ??= (async () => {
        const saved = await secure.get(IDENTITY_KEY);
        if (saved) {
            const parsed = JSON.parse(saved) as { sign: string; kem: string };
            return {
                signSeed: base64ToUint8(parsed.sign),
                kemSeed: base64ToUint8(parsed.kem),
            };
        }
        const identity = generateAgentIdentity();
        await secure.set(IDENTITY_KEY, {
            sign: uint8ToBase64(identity.signSeed),
            kem: uint8ToBase64(identity.kemSeed),
        });
        return identity;
    })().catch((error: unknown) => {
        identityPromise = null;
        throw error;
    });
    return identityPromise;
}

type StoredRelayPass = {
    pass: string;
    expiresAt: number;
    /** The relay key (base64url) the pass was issued for. */
    key: string;
};

export async function loadRelayPass(): Promise<StoredRelayPass | null> {
    return parseStored(await secure.get(RELAY_PASS_KEY), null, (parsed) => parsed as StoredRelayPass);
}

export async function saveRelayPass(pass: StoredRelayPass | null) {
    if (!pass) await secure.remove(RELAY_PASS_KEY);
    else await secure.set(RELAY_PASS_KEY, pass);
}

export async function loadCustomRelays(): Promise<CustomRelay[]> {
    return parseStored(await secure.get(CUSTOM_RELAYS_KEY), [], (parsed) =>
        Array.isArray(parsed)
            ? (parsed as CustomRelay[]).filter(
                  (relay) => typeof relay.origin === "string" && typeof relay.token === "string",
              )
            : [],
    );
}

/** Adds or replaces the token for one relay. */
export async function saveCustomRelay(relay: CustomRelay) {
    const relays = (await loadCustomRelays()).filter((item) => item.origin !== relay.origin);
    await secure.set(CUSTOM_RELAYS_KEY, [...relays, relay]);
}

export async function removeCustomRelay(origin: string) {
    await secure.set(
        CUSTOM_RELAYS_KEY,
        (await loadCustomRelays()).filter((item) => item.origin !== origin),
    );
}

export async function loadAgentCache(): Promise<CachedAgent[]> {
    return parseStored(await AsyncStorage.getItem(AGENT_CACHE_KEY), [], (parsed) =>
        Array.isArray(parsed) ? (parsed as CachedAgent[]) : [],
    );
}

export async function saveAgentCache(agents: CachedAgent[]) {
    if (!agents.length) await AsyncStorage.removeItem(AGENT_CACHE_KEY);
    else await AsyncStorage.setItem(AGENT_CACHE_KEY, JSON.stringify(agents));
}

/** The runtime owns the contents (accept, sendKeys, tombstone cleanup). */
export const localApprovals: LocalApprovalStore = {
    async load(): Promise<LocalAgentApproval[]> {
        return parseStored(await secure.get(LOCAL_APPROVALS_KEY), [], (parsed) =>
            Array.isArray(parsed)
                ? (parsed as LocalAgentApproval[]).filter(
                      (item) =>
                          typeof item?.agentId === "string" &&
                          Array.isArray(item.keys) &&
                          item.keys.every((key) => typeof key === "string"),
                  )
                : [],
        );
    },
    async save(approvals: LocalAgentApproval[]) {
        if (!approvals.length) await secure.remove(LOCAL_APPROVALS_KEY);
        else await secure.set(LOCAL_APPROVALS_KEY, approvals);
    },
};
