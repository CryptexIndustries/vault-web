import * as Storage from "@/app_lib/vault-utils/storage";
import * as Vault from "@/app_lib/vault-utils/vault";
import { LiteCredential, MessageType } from "./types/sw-messaging";
import * as VaultUtilTypes from "@/app_lib/proto/vault";
import {
    generateECDHKeyPair,
    deriveSessionKey,
    base64UrlDecode,
} from "./utils/crypto-utils";
import {
    createEncryptedResponseEnvelope,
    decryptEnvelope,
    createPlaintextEnvelope,
    isEncryptedEnvelope,
    isPlaintextEnvelope,
} from "./utils/session-utils";
import { validateEnvelope } from "./utils/security-utils";
import { EncryptedEnvelope, PlaintextEnvelope } from "./types/sw-messaging";

const OFFSCREEN_URL = chrome.runtime.getURL("/offscreen.html");

const UNLOCKED_VAULT_METADATA_KEY = "UVM";
const UNLOCKED_VAULT_KEY = "UV";
const UNLOCKED_VAULT_SECRET_KEY = "UVS";

type LegacyMessage = {
    type: -1;
    payload: {
        error: string;
    };
};

/**
 * Processes an envelope-based message and returns the appropriate response envelope.
 */
async function processEnvelope(
    envelope: EncryptedEnvelope | PlaintextEnvelope,
    sender: chrome.runtime.MessageSender,
): Promise<EncryptedEnvelope | PlaintextEnvelope> {
    // Validate envelope security properties
    const validation = validateEnvelope(envelope, sender);
    if (!validation.valid) {
        // Return error response in plaintext for security errors
        return createPlaintextEnvelope(
            envelope.type,
            { ok: false, error: validation.error, code: validation.code },
            "worker",
        );
    }

    let decryptedPayload: any = null;
    let sessionKey: CryptoKey | null = null;

    // Handle encrypted envelopes
    if (isEncryptedEnvelope(envelope)) {
        try {
            // Get the active key pair
            const activeKey = await Storage.db.keyPairs
                .where("status")
                .equals("active")
                .first();
            if (!activeKey) {
                return createPlaintextEnvelope(
                    envelope.type,
                    {
                        ok: false,
                        error: "No active key available",
                        code: "NO_ACTIVE_KEY",
                    },
                    "worker",
                );
            }

            // Check if key ID matches
            if (envelope.keyId !== activeKey.keyId) {
                // Try to find the key by ID (might be decommissioned)
                const requestedKey = await Storage.db.keyPairs.get(
                    envelope.keyId,
                );
                if (requestedKey) {
                    return createPlaintextEnvelope(
                        envelope.type,
                        {
                            ok: false,
                            error: "Key has been rotated",
                            code: "STALE_KEY",
                            latestKeyId: activeKey.keyId,
                        },
                        "worker",
                    );
                } else {
                    return createPlaintextEnvelope(
                        envelope.type,
                        {
                            ok: false,
                            error: "Unknown key ID",
                            code: "INVALID_KEY",
                        },
                        "worker",
                    );
                }
            }

            // Decrypt the envelope
            decryptedPayload = await decryptEnvelope(
                envelope,
                activeKey.privateKey,
            );

            if (!decryptedPayload.ok) {
                return createPlaintextEnvelope(
                    envelope.type,
                    {
                        ok: false,
                        error: decryptedPayload.error,
                        code: decryptedPayload.code,
                    },
                    "worker",
                );
            }

            decryptedPayload = decryptedPayload.payload;

            // Derive session key for response encryption
            const ephemeralPublicKey = await crypto.subtle.importKey(
                "jwk",
                envelope.payload.ephemeralPub,
                { name: "ECDH", namedCurve: "P-256" },
                false,
                [],
            );
            const salt = base64UrlDecode(envelope.payload.salt);
            sessionKey = await deriveSessionKey(
                activeKey.privateKey,
                ephemeralPublicKey,
                salt,
                "cryptex-extension-session",
            );
        } catch (error) {
            console.error("[SW] Failed to decrypt envelope:", error);
            return createPlaintextEnvelope(
                envelope.type,
                {
                    ok: false,
                    error: "Decryption failed",
                    code: "DECRYPTION_FAILED",
                },
                "worker",
            );
        }
    } else {
        // The only clear text messages allowed are GetPublicKey
        if (envelope.type !== MessageType.GetPublicKey) {
            return createPlaintextEnvelope(
                envelope.type,
                {
                    ok: false,
                    error: "Only GetPublicKey messages are allowed in plaintext envelopes",
                    code: "INVALID_ENVELOPE_TYPE",
                },
                "worker",
            );
        }

        const publicKey = await retrieveActivePublicKey();
        if (!publicKey.ok) {
            return createPlaintextEnvelope(
                envelope.type,
                {
                    ok: false,
                    error: "Failed to retrieve an active public key",
                    code: "FAILED_TO_RETRIEVE_ACTIVE_PUBLIC_KEY",
                },
                "worker",
            );
        }

        return createPlaintextEnvelope(envelope.type, publicKey, "worker");
    }

    // NOTE: Here on out, we know that the envelope is an encrypted envelope and that we have a valid session key

    console.debug(
        "[SW] Previewing the decrypted/plaintext message before processing:",
        MessageType[envelope.type],
        "payload:",
        decryptedPayload,
    );

    // Process the message based on type
    const result = await processMessage(envelope.type, decryptedPayload);

    console.debug(
        "[SW] Previewing the response after processing:",
        MessageType[envelope.type],
        "result:",
        result,
    );

    // Re-encrypt the response envelope
    return await createEncryptedResponseEnvelope(envelope, result, sessionKey);
}

/**
 * Processes a decrypted message payload and returns the response.
 */
async function processMessage(type: MessageType, payload: any): Promise<any> {
    await ensureOffscreenDocument();

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

                const metadata =
                    Storage.VaultMetadata.deserializeMetadataBinary(
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

                const { vault, encryptionData } = res.value;

                // onlineServicesStore.set(onlineServicesDataAtom, {
                //     key: vault.LinkedDevices.APIKey ?? "",
                //     remoteData: null,
                // });

                await setVaultInSessionStorage(metadata, vault, encryptionData);

                return { ok: true };
            }

            case MessageType.Lock: {
                // Zero out the session storage (unlocked vault metadata and vault)
                await clearSessionStorage();

                return { ok: true };
            }

            case MessageType.GetState: {
                // TODO: await ensureOffscreenDocument();
                const meta = await getVaultMetadataFromSessionStorage();

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

            case MessageType.GetCredentials: {
                const vault = await getVaultFromSessionStorage();

                if (!vault) {
                    return {
                        ok: false,
                        credentials: [],
                        error: "VAULT_NOT_UNLOCKED",
                    };
                }

                const list: LiteCredential[] = (vault?.Credentials ?? []).map(
                    (c) => ({
                        id: c.ID,
                        name: c.Name,
                        username: c.Username,
                        url: c.URL,
                    }),
                );
                return { ok: true, credentials: list };
            }

            case MessageType.GetCredential: {
                const vault = await getVaultFromSessionStorage();

                if (!vault) {
                    return {
                        ok: false,
                        credential: null,
                        error: "VAULT_NOT_UNLOCKED",
                    };
                }

                const cred = (vault?.Credentials ?? []).find(
                    (c) => c.ID === payload.id,
                );
                if (!cred) {
                    return { ok: false, credential: null, error: "NOT_FOUND" };
                }
                return { ok: true, credential: cred };
            }

            case MessageType.CreateCredential: {
                const vault = await getVaultFromSessionStorage();
                const metadata = await getVaultMetadataFromSessionStorage();
                const vaultSecret = await getVaultSecretFromSessionStorage();

                if (!vault || !metadata || !vaultSecret) {
                    return {
                        ok: false,
                        credential: null,
                        error: "VAULT_NOT_UNLOCKED",
                    };
                }

                const data = await Vault.createCredential(payload.form);
                vault.Credentials.push(data.credential);

                const listHash = await Vault.hashCredentials(vault.Credentials);
                const diff: VaultUtilTypes.Diff = {
                    Hash: listHash,
                    Changes: data.changes,
                };
                vault.Diffs.push(diff);

                // TODO: Remove the unnecessary object assignment when we clean up the storage layer
                const metadataInstance = Object.assign(
                    new Storage.VaultMetadata(),
                    metadata,
                );
                await metadataInstance.save(vault, vaultSecret);

                await setVaultInSessionStorage(metadata, vault, vaultSecret);

                const lightCredential: LiteCredential = {
                    id: data.credential.ID,
                    name: data.credential.Name,
                    username: data.credential.Username,
                    url: data.credential.URL,
                };

                return { ok: true, credential: lightCredential };
            }

            case MessageType.UpdateCredential: {
                const vault = await getVaultFromSessionStorage();
                const metadata = await getVaultMetadataFromSessionStorage();
                const vaultSecret = await getVaultSecretFromSessionStorage();

                if (!vault || !metadata || !vaultSecret) {
                    return {
                        ok: false,
                        credential: null,
                        error: "VAULT_NOT_UNLOCKED",
                    };
                }

                const existingIndex = vault.Credentials.findIndex(
                    (c) => c.ID === payload.id,
                );

                if (existingIndex === -1) {
                    return { ok: false, credential: null, error: "NOT_FOUND" };
                }

                const existing = vault.Credentials[existingIndex];
                const data = await Vault.updateCredentialFromForm(
                    existing,
                    payload.form,
                );
                vault.Credentials[existingIndex] = data.credential;

                const listHash = await Vault.hashCredentials(vault.Credentials);
                const diff: VaultUtilTypes.Diff = {
                    Hash: listHash,
                    Changes: data.changes,
                };
                vault.Diffs.push(diff);

                // TODO: Remove the unnecessary object assignment when we clean up the storage layer
                const metadataInstance = Object.assign(
                    new Storage.VaultMetadata(),
                    metadata,
                );
                await metadataInstance.save(vault, vaultSecret);

                await setVaultInSessionStorage(metadata, vault, vaultSecret);

                return { ok: true, credential: data.credential };
            }

            case MessageType.DeleteCredential: {
                const vault = await getVaultFromSessionStorage();
                const metadata = await getVaultMetadataFromSessionStorage();
                const vaultSecret = await getVaultSecretFromSessionStorage();

                if (!vault || !metadata || !vaultSecret) {
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

                // TODO: Remove the unnecessary object assignment when we clean up the storage layer
                const metadataInstance = Object.assign(
                    new Storage.VaultMetadata(),
                    metadata,
                );
                await metadataInstance.save(vault, vaultSecret);

                await setVaultInSessionStorage(metadata, vault, vaultSecret);

                return { ok: true };
            }
            default:
                return { ok: false, error: "UNKNOWN_ENCRYPTED_MESSAGE_TYPE" };
        }
    } catch (error) {
        console.error(
            `[SW] Error processing encrypted message type "${MessageType[type]}":`,
            error,
        );
        return {
            ok: false,
            error: error instanceof Error ? error.message : "UNKNOWN_ERROR",
        };
    }
}

/**
 * Retrieves the active public key from the database.
 * @returns The active public key if successful, otherwise an error.
 */
async function retrieveActivePublicKey(): Promise<
    | {
          ok: boolean;
          keyId: string;
          curve: string;
          publicKeyJwk: JsonWebKey;
          createdAt: string;
      }
    | { ok: false; error: string }
> {
    try {
        const activeKey = await Storage.db.keyPairs
            .where("status")
            .equals("active")
            .first();

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
    } catch (error) {
        console.error("[SW] Failed to retrieve active public key:", error);
        return { ok: false, error: "FAILED_TO_RETRIEVE_ACTIVE_PUBLIC_KEY" };
    }
}

/**
 * Rotates the active ECDH key pair, marking the old one as decommissioned.
 */
async function rotateKeyPair(): Promise<void> {
    try {
        const currentActiveKey = await Storage.db.keyPairs
            .where("status")
            .equals("active")
            .first();
        if (currentActiveKey) {
            // Mark current active key as decommissioned
            await Storage.db.keyPairs.update(currentActiveKey.keyId, {
                status: "decommission",
            });
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

        console.debug(`[SW] Rotated ECDH key pair. New key ID: ${newKeyPair.keyId}`);

        // TODO: Broadcast KEY_ROTATED to all connected clients (popup, offscreen)
        // For now, clients will discover rotation on next request via STALE_KEY error
    } catch (error) {
        console.error("[SW] Failed to rotate key pair:", error);
        throw error;
    }
}

/**
 * Checks if key rotation is needed (30-day cadence) and performs rotation if necessary.
 */
async function checkAndRotateKeysIfNeeded(): Promise<void> {
    try {
        const activeKey = await Storage.db.keyPairs
            .where("status")
            .equals("active")
            .first();
        if (!activeKey) return;

        const keyAge = Date.now() - new Date(activeKey.createdAt).getTime();
        const thirtyDaysInMs = 30 * 24 * 60 * 60 * 1000;

        if (keyAge > thirtyDaysInMs) {
            console.debug("[SW] Active key is older than 30 days, rotating...");
            await rotateKeyPair();
        }
    } catch (error) {
        console.error("[SW] Failed to check key rotation:", error);
    }
}

/**
 * Ensures an active ECDH key pair exists for secure messaging.
 * Generates a new key pair if none exists.
 */
async function ensureActiveKeyPair(): Promise<void> {
    try {
        const existingActiveKey = await Storage.db.keyPairs
            .where("status")
            .equals("active")
            .first();
        if (existingActiveKey) {
            return; // Active key already exists
        }

        console.debug(
            "[SW] No active ECDH key pair found, generating new key pair...",
        );
        const keyPair = await generateECDHKeyPair();

        await Storage.db.keyPairs.add({
            keyId: keyPair.keyId,
            createdAt: keyPair.createdAt,
            status: "active",
            privateKey: keyPair.privateKey,
            publicKeyJwk: keyPair.publicKeyJwk,
        });

        console.debug(`[SW] Generated new ECDH key pair with ID: ${keyPair.keyId}`);
    } catch (error) {
        console.error("[SW] Failed to ensure active key pair:", error);
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
        justification: "Secure vault data synchronization.",
    });
}

async function getVaultFromSessionStorage(): Promise<VaultUtilTypes.Vault | null> {
    const _vault = await chrome.storage.session.get([UNLOCKED_VAULT_KEY]);
    return _vault[UNLOCKED_VAULT_KEY] as VaultUtilTypes.Vault | null;
}

async function getVaultMetadataFromSessionStorage(): Promise<VaultUtilTypes.VaultMetadata | null> {
    const _metadata = await chrome.storage.session.get([
        UNLOCKED_VAULT_METADATA_KEY,
    ]);
    return _metadata[
        UNLOCKED_VAULT_METADATA_KEY
    ] as VaultUtilTypes.VaultMetadata | null;
}

async function getVaultSecretFromSessionStorage(): Promise<Uint8Array | null> {
    const _vaultSecretB64 = await chrome.storage.session.get([
        UNLOCKED_VAULT_SECRET_KEY,
    ]);
    const _vaultSecret = _vaultSecretB64[UNLOCKED_VAULT_SECRET_KEY] as
        | string
        | null;

    // TODO: Replace with Uint8Array.fromBase64() in about 3 months
    return _vaultSecret
        ? Uint8Array.from(atob(_vaultSecret), (c) => c.charCodeAt(0))
        : null;
}

async function setVaultInSessionStorage(
    metadata: VaultUtilTypes.VaultMetadata,
    vault: VaultUtilTypes.Vault,
    vaultSecret: Uint8Array,
): Promise<void> {
    // Convert the encryption data to a base64 string
    const _vaultSecret = btoa(String.fromCharCode(...vaultSecret));

    await chrome.storage.session.set({
        [UNLOCKED_VAULT_METADATA_KEY]: metadata,
        [UNLOCKED_VAULT_KEY]: vault,
        [UNLOCKED_VAULT_SECRET_KEY]: _vaultSecret,
    });
}

async function clearSessionStorage(): Promise<void> {
    await chrome.storage.session.clear();
}

chrome.runtime.onMessage.addListener(
    (
        message: EncryptedEnvelope | PlaintextEnvelope,
        sender: chrome.runtime.MessageSender,
        sendResponse: (
            response: EncryptedEnvelope | PlaintextEnvelope | LegacyMessage,
        ) => void,
    ) => {
        void (async () => {
            try {
                // Check if this is an envelope-based message
                if (
                    isEncryptedEnvelope(message) ||
                    isPlaintextEnvelope(message)
                ) {
                    const responseEnvelope = await processEnvelope(
                        message,
                        sender,
                    );
                    sendResponse(responseEnvelope);
                    return;
                }

                // Legacy message handling (for backward compatibility during transition)
                // This can be removed once all clients use envelope-based messaging
                console.warn(
                    "[SW] Received legacy message format, should migrate to envelope-based messaging",
                    message,
                );
                sendResponse({
                    type: -1,
                    payload: { error: "LEGACY_MESSAGE_FORMAT_NOT_SUPPORTED" },
                });
            } catch (e) {
                console.error("[SW] Message handling error:", e);
                sendResponse({
                    type: -1,
                    payload: { error: "An unknown error occurred." },
                });
            }
        })();

        return true;
    },
);

// Ensure active key pair exists on service worker activation
chrome.runtime.onInstalled.addListener(async () => {
    console.debug(
        "[SW] Service worker installed/updated, ensuring active key pair...",
    );
    await ensureActiveKeyPair();
    // Also check if rotation is needed on install/update
    await checkAndRotateKeysIfNeeded();
});

// Also ensure key pair exists on startup
chrome.runtime.onStartup.addListener(async () => {
    console.debug("[SW] Service worker started, ensuring active key pair...");
    await ensureActiveKeyPair();
    // Check for key rotation on startup
    await checkAndRotateKeysIfNeeded();
});

// Set up idle detection to lock the vault after 30 minutes of inactivity
chrome.idle.setDetectionInterval(30 * 60 * 1000);
chrome.idle.onStateChanged.addListener(async (newState) => {
    if (newState === "idle") {
        console.debug("[SW] Vault locked due to inactivity");

        // Lock the vault
        await clearSessionStorage();
    }
});
