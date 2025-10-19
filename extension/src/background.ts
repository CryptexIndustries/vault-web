// Background service worker: holds unlocked vault state and handles sync
import {
    vaultStore,
    unlockedVaultAtom,
    unlockedVaultMetadataAtom,
    onlineServicesStore,
    onlineServicesDataAtom,
} from "@/utils/atoms";
import * as Storage from "@/app_lib/vault-utils/storage";
import * as Vault from "@/app_lib/vault-utils/vault";
import { LiteCredential, AnyMessage, AnyMessageResponse, MessageType } from "./types/sw-messaging";
import * as VaultUtilTypes from "@/app_lib/proto/vault";
import { generateECDHKeyPair, deriveSessionKey, base64UrlDecode } from "./utils/crypto-utils";
import { createEncryptedResponseEnvelope, decryptEnvelope, createPlaintextEnvelope } from "./utils/session-utils";
import { validateEnvelope } from "./utils/security-utils";
import { EncryptedEnvelope, PlaintextEnvelope } from "./types/sw-messaging";

// Reuse the web app's atoms store in worker scope
const store = vaultStore;

const OFFSCREEN_URL = chrome.runtime.getURL("/offscreen.html");

/**
 * Type guard to check if a message is an encrypted envelope.
 */
function isEncryptedEnvelope(message: any): message is EncryptedEnvelope {
    return message &&
           typeof message.type === 'number' &&
           typeof message.requestId === 'string' &&
           typeof message.origin === 'string' &&
           typeof message.keyId === 'string' &&
           typeof message.timestamp === 'string' &&
           message.payload &&
           typeof message.payload.wrappedKey === 'string' &&
           message.payload.ephemeralPub &&
           typeof message.payload.salt === 'string' &&
           typeof message.payload.ciphertext === 'string' &&
           typeof message.payload.iv === 'string';
}

/**
 * Type guard to check if a message is a plaintext envelope.
 */
function isPlaintextEnvelope(message: any): message is PlaintextEnvelope {
    return message &&
           typeof message.type === 'number' &&
           typeof message.requestId === 'string' &&
           typeof message.origin === 'string' &&
           typeof message.timestamp === 'string' &&
           !message.payload?.ciphertext; // Plaintext doesn't have ciphertext
}

/**
 * Processes an envelope-based message and returns the appropriate response envelope.
 */
async function processEnvelope(
    envelope: EncryptedEnvelope | PlaintextEnvelope,
    sender: chrome.runtime.MessageSender
): Promise<EncryptedEnvelope | PlaintextEnvelope> {
    // Validate envelope security properties
    const validation = validateEnvelope(envelope, sender);
    if (!validation.valid) {
        // Return error response in plaintext for security errors
        return createPlaintextEnvelope(
            envelope.type,
            { ok: false, error: validation.error, code: validation.code },
            "worker"
        );
    }

    let decryptedPayload: any = null;
    let sessionKey: CryptoKey | null = null;

    // Handle encrypted envelopes
    if (isEncryptedEnvelope(envelope)) {
        try {
            // Get the active key pair
            const activeKey = await Storage.db.keyPairs.where("status").equals("active").first();
            if (!activeKey) {
                return createPlaintextEnvelope(
                    envelope.type,
                    { ok: false, error: "No active key available", code: "NO_ACTIVE_KEY" },
                    "worker"
                );
            }

            // Check if key ID matches
            if (envelope.keyId !== activeKey.keyId) {
                // Try to find the key by ID (might be decommissioned)
                const requestedKey = await Storage.db.keyPairs.get(envelope.keyId);
                if (requestedKey) {
                    return createPlaintextEnvelope(
                        envelope.type,
                        { ok: false, error: "Key has been rotated", code: "STALE_KEY", latestKeyId: activeKey.keyId },
                        "worker"
                    );
                } else {
                    return createPlaintextEnvelope(
                        envelope.type,
                        { ok: false, error: "Unknown key ID", code: "INVALID_KEY" },
                        "worker"
                    );
                }
            }

            // Decrypt the envelope
            decryptedPayload = await decryptEnvelope(envelope, activeKey.privateKey);

            if (!decryptedPayload.ok) {
                return createPlaintextEnvelope(
                    envelope.type,
                    { ok: false, error: decryptedPayload.error, code: decryptedPayload.code },
                    "worker"
                );
            }

            decryptedPayload = decryptedPayload.payload;

            // Derive session key for response encryption
            const ephemeralPublicKey = await crypto.subtle.importKey(
                "jwk",
                envelope.payload.ephemeralPub,
                { name: "ECDH", namedCurve: "P-256" },
                false,
                []
            );
            const salt = base64UrlDecode(envelope.payload.salt);
            sessionKey = await deriveSessionKey(
                activeKey.privateKey,
                ephemeralPublicKey,
                salt,
                "cryptex-extension-session"
            );
        } catch (error) {
            console.error("Failed to decrypt envelope:", error);
            return createPlaintextEnvelope(
                envelope.type,
                { ok: false, error: "Decryption failed", code: "DECRYPTION_FAILED" },
                "worker"
            );
        }
    } else {
        // Plaintext envelope
        decryptedPayload = envelope.payload;
    }

    console.debug("SW Decrypted/Plaintext type:", MessageType[envelope.type], "payload:", decryptedPayload);

    // Process the message based on type
    const result = await processMessage(envelope.type, decryptedPayload);

    console.debug("SW Response before encryption:", MessageType[envelope.type], "result:", result);

    // Return appropriate response envelope
    if (sessionKey && isEncryptedEnvelope(envelope)) {
        // Encrypt sensitive responses
        return await createEncryptedResponseEnvelope(envelope, result, sessionKey);
    } else {
        // Plaintext response for non-sensitive operations
        return createPlaintextEnvelope(envelope.type, result, "worker");
    }
}

/**
 * Processes a decrypted message payload and returns the response.
 */
async function processMessage(type: MessageType, payload: any): Promise<any> {
    try {
        switch (type) {
            case MessageType.Unlock: {
                if (!payload.index) {
                    return { ok: false, error: "METADATA_INDEX_NULL" };
                }

                const rec = await Storage.db.vaults.get(payload.index);
                if (!rec) {
                    return { ok: false, error: "METADATA_NOT_FOUND" };
                }

                const metadata = Storage.VaultMetadata.deserializeMetadataBinary(
                    rec.data,
                    payload.index,
                );

                const res = await metadata.decryptVault(
                    payload.form.Secret,
                    payload.form.Encryption,
                    payload.form.EncryptionKeyDerivationFunction,
                    payload.form.EncryptionConfig,
                );

                if (res.isErr()) {
                    return { ok: false, error: res.error };
                }

                const vault = res.value;

                store.set(unlockedVaultMetadataAtom, metadata);
                store.set(unlockedVaultAtom, vault);
                onlineServicesStore.set(onlineServicesDataAtom, {
                    key: vault.LinkedDevices.APIKey ?? "",
                    remoteData: null,
                });

                return { ok: true };
            }

            case MessageType.Lock: {
                store.set(unlockedVaultMetadataAtom, null);
                store.set(unlockedVaultAtom, new Vault.Vault());
                return { ok: true };
            }

            case MessageType.GetState: {
                await ensureOffscreenDocument();
                const meta = store.get(unlockedVaultMetadataAtom);

                if (!meta) {
                    return { unlocked: false, metadata: null };
                }

                return {
                    unlocked: true,
                    metadata: {
                        id: meta.DBIndex,
                        name: meta.Name,
                    },
                };
            }

            case MessageType.EnsureOffscreen: {
                await ensureOffscreenDocument();
                return { ok: true };
            }

            case MessageType.GetCredentials: {
                const vault = store.get(unlockedVaultAtom);
                const list: LiteCredential[] = (vault?.Credentials ?? []).map((c) => ({
                    id: c.ID,
                    name: c.Name,
                    username: c.Username,
                    url: c.URL,
                }));
                return { ok: true, credentials: list };
            }

            case MessageType.GetCredential: {
                const vault = store.get(unlockedVaultAtom);
                const cred = (vault?.Credentials ?? []).find(
                    (c) => c.ID === payload.id,
                );
                if (!cred) {
                    return { ok: false, credential: null, error: "NOT_FOUND" };
                }
                return { ok: true, credential: cred };
            }

            case MessageType.CreateCredential: {
                const vault = store.get(unlockedVaultAtom);
                const metadata = store.get(unlockedVaultMetadataAtom);

                if (!vault || !metadata) {
                    return { ok: false, credential: null, error: "VAULT_NOT_UNLOCKED" };
                }

                const data = await Vault.createCredential(payload.form);
                vault.Credentials.push(data.credential);

                const listHash = await Vault.hashCredentials(vault.Credentials);
                const diff: VaultUtilTypes.Diff = {
                    Hash: listHash,
                    Changes: data.changes,
                };
                vault.Diffs.push(diff);

                await metadata.save(vault);

                const lightCredential: LiteCredential = {
                    id: data.credential.ID,
                    name: data.credential.Name,
                    username: data.credential.Username,
                    url: data.credential.URL,
                };

                return { ok: true, credential: lightCredential };
            }

            case MessageType.UpdateCredential: {
                const vault = store.get(unlockedVaultAtom);
                const metadata = store.get(unlockedVaultMetadataAtom);

                if (!vault || !metadata) {
                    return { ok: false, credential: null, error: "VAULT_NOT_UNLOCKED" };
                }

                const existingIndex = vault.Credentials.findIndex(
                    (c) => c.ID === payload.id,
                );

                if (existingIndex === -1) {
                    return { ok: false, credential: null, error: "NOT_FOUND" };
                }

                const existing = vault.Credentials[existingIndex];
                const data = await Vault.updateCredentialFromForm(existing, payload.form);
                vault.Credentials[existingIndex] = data.credential;

                const listHash = await Vault.hashCredentials(vault.Credentials);
                const diff: VaultUtilTypes.Diff = {
                    Hash: listHash,
                    Changes: data.changes,
                };
                vault.Diffs.push(diff);

                await metadata.save(vault);

                return { ok: true, credential: data.credential };
            }

            case MessageType.DeleteCredential: {
                const vault = store.get(unlockedVaultAtom);
                const metadata = store.get(unlockedVaultMetadataAtom);

                if (!vault || !metadata) {
                    return { ok: false, error: "VAULT_NOT_UNLOCKED" };
                }

                const index = vault.Credentials.findIndex(
                    (c) => c.ID === payload.id,
                );

                if (index === -1) {
                    return { ok: false, error: "NOT_FOUND" };
                }

                const deletedCredential = vault.Credentials[index];
                vault.Credentials.splice(index, 1);

                const change: VaultUtilTypes.DiffChange = {
                    Type: VaultUtilTypes.DiffType.Delete,
                    ID: deletedCredential.ID,
                    Props: deletedCredential,
                };

                const listHash = await Vault.hashCredentials(vault.Credentials);
                const diff: VaultUtilTypes.Diff = {
                    Hash: listHash,
                    Changes: change,
                };
                vault.Diffs.push(diff);

                await metadata.save(vault);

                return { ok: true };
            }

            case MessageType.GetPublicKey: {
                const activeKey = await Storage.db.keyPairs.where("status").equals("active").first();
                if (!activeKey) {
                    return { ok: false, error: "NO_ACTIVE_KEY" };
                }

                return {
                    ok: true,
                    keyId: activeKey.keyId,
                    curve: "P-256",
                    publicKeyJwk: activeKey.publicKeyJwk,
                    createdAt: activeKey.createdAt,
                };
            }

            default:
                return { ok: false, error: "UNKNOWN_MESSAGE_TYPE" };
        }
    } catch (error) {
        console.error(`Error processing message type ${type}:`, error);
        return { ok: false, error: error instanceof Error ? error.message : "UNKNOWN_ERROR" };
    }
}

/**
 * Rotates the active ECDH key pair, marking the old one as decommissioned.
 */
async function rotateKeyPair(): Promise<void> {
    try {
        const currentActiveKey = await Storage.db.keyPairs.where("status").equals("active").first();
        if (currentActiveKey) {
            // Mark current active key as decommissioned
            await Storage.db.keyPairs.update(currentActiveKey.keyId, { status: "decommission" });
        }

        // Generate new active key pair
        const newKeyPair = await generateECDHKeyPair();
        await Storage.db.keyPairs.add({
            keyId: newKeyPair.keyId,
            createdAt: newKeyPair.createdAt,
            status: "active",
            privateKey: newKeyPair.privateKey,
            publicKeyJwk: newKeyPair.publicKeyJwk,
        });

        console.log(`Rotated ECDH key pair. New key ID: ${newKeyPair.keyId}`);

        // TODO: Broadcast KEY_ROTATED to all connected clients (popup, offscreen)
        // For now, clients will discover rotation on next request via STALE_KEY error
    } catch (error) {
        console.error("Failed to rotate key pair:", error);
        throw error;
    }
}

/**
 * Checks if key rotation is needed (30-day cadence) and performs rotation if necessary.
 */
async function checkAndRotateKeysIfNeeded(): Promise<void> {
    try {
        const activeKey = await Storage.db.keyPairs.where("status").equals("active").first();
        if (!activeKey) return;

        const keyAge = Date.now() - new Date(activeKey.createdAt).getTime();
        const thirtyDaysInMs = 30 * 24 * 60 * 60 * 1000;

        if (keyAge > thirtyDaysInMs) {
            console.log("Active key is older than 30 days, rotating...");
            await rotateKeyPair();
        }
    } catch (error) {
        console.error("Failed to check key rotation:", error);
    }
}

/**
 * Ensures an active ECDH key pair exists for secure messaging.
 * Generates a new key pair if none exists.
 */
async function ensureActiveKeyPair(): Promise<void> {
    try {
        const existingActiveKey = await Storage.db.keyPairs.where("status").equals("active").first();
        if (existingActiveKey) {
            return; // Active key already exists
        }

        console.log("No active ECDH key pair found, generating new key pair...");
        const keyPair = await generateECDHKeyPair();

        await Storage.db.keyPairs.add({
            keyId: keyPair.keyId,
            createdAt: keyPair.createdAt,
            status: "active",
            privateKey: keyPair.privateKey,
            publicKeyJwk: keyPair.publicKeyJwk,
        });

        console.log(`Generated new ECDH key pair with ID: ${keyPair.keyId}`);
    } catch (error) {
        console.error("Failed to ensure active key pair:", error);
        throw error;
    }
}

async function ensureOffscreenDocument(): Promise<void> {
    if (!chrome.offscreen) return;

    const existingContexts = await chrome.runtime.getContexts?.({
        contextTypes: ["OFFSCREEN_DOCUMENT"],
        documentUrls: [OFFSCREEN_URL],
    });

    if (existingContexts && existingContexts.length > 0) {
        return;
    }

    await chrome.offscreen.createDocument({
        url: OFFSCREEN_URL,
        reasons: [chrome.offscreen.Reason.WEB_RTC],
        justification: "Secure vault synchronization",
    });
}

chrome.runtime.onMessage.addListener(
    (message: any, sender: chrome.runtime.MessageSender, sendResponse: (response: any) => void) => {
        (async () => {
            try {
                // Check if this is an envelope-based message
                if (isEncryptedEnvelope(message) || isPlaintextEnvelope(message)) {
                    const responseEnvelope = await processEnvelope(message, sender);
                    sendResponse(responseEnvelope);
                    return;
                }

                // Legacy message handling (for backward compatibility during transition)
                // This can be removed once all clients use envelope-based messaging
                console.warn("Received legacy message format, should migrate to envelope-based messaging", message);
                sendResponse({ type: -1, payload: { error: "LEGACY_MESSAGE_FORMAT_NOT_SUPPORTED" } });
            } catch (e) {
                console.error("Message handling error:", e);
                sendResponse({ type: -1, payload: { error: "An unknown error occurred." } });
                return false;
            }
        })();

        return true; // keep channel open for async sendResponse
    },
);

// Ensure active key pair exists on service worker activation
chrome.runtime.onInstalled.addListener(async () => {
    console.log("Service worker installed/updated, ensuring active key pair...");
    await ensureActiveKeyPair();
    // Also check if rotation is needed on install/update
    await checkAndRotateKeysIfNeeded();
});

// Also ensure key pair exists on startup
chrome.runtime.onStartup.addListener(async () => {
    console.log("Service worker started, ensuring active key pair...");
    await ensureActiveKeyPair();
    // Check for key rotation on startup
    await checkAndRotateKeysIfNeeded();
});
