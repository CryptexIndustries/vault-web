import * as Storage from "@/app_lib/vault-utils/storage";
import * as Vault from "@cryptex-industries/vault-core/vault-utils/vault";
import "./vault-core-runtime";
import { MessageType } from "./types/sw-messaging";
import type {
    EncryptedEnvelope,
    EnvelopeOrigin,
    LiteCredential,
    PlaintextEnvelope,
} from "./types/sw-messaging";
import * as VaultUtilTypes from "@cryptex-industries/vault-core/proto";
import {
    type VaultWriteKind,
    vaultWriteCoordinator,
} from "@cryptex-industries/vault-core/vault-utils/vault-write-coordinator";
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
import { handleProxyFetch } from "./background/request-auth-interceptor";
import {
    claimAutofillFrameBootstrap,
    registerAutofillFrameBootstrap,
} from "./background/autofill-frame-bootstrap";
import {
    handleConsumePendingSavePrompt,
    handleGenerateTOTP,
    handleGetCredentialsForOrigin,
    handleGetCredentialSecret,
    handleGetPendingSavePrompt,
    handleOpenPopup,
    handleSaveCredentialPrompt,
    toLiteCredential,
} from "./background/autofill-router";
import type { AutofillRequestOrigin } from "./background/autofill-router";
import {
    allowOnlineServicesSessionEstablishment,
    clearOnlineServicesSession as clearOnlineServicesSessionInSW,
    ensureFreshOnlineServicesSession,
    ensureOnlineServicesSessionFromUnlockedVault,
    establishOnlineServicesSession,
    forceOnlineServicesSessionReauthentication,
} from "./app_lib/auth-session-ext";
import {
    clearAllVaultKeyMaterial,
    clearSessionDEK,
    getSessionDEK,
    setSessionDEKFromVaultMetadata,
} from "./background/session-dek-store";
import { etldPlus1 } from "./utils/etld";
import { registerVaultActionStateIndicator } from "./background/action-icon";
import {
    clearPageOrigin,
    getActivePageOrigin,
    recordPageOrigin,
} from "./background/page-origin-context";

const UNLOCKED_VAULT_METADATA_KEY = "UVM";
const UNLOCKED_VAULT_KEY = "UV";
const ACTIVE_VAULT_DB_INDEX_KEY = "AVI";

registerVaultActionStateIndicator();

type LegacyMessage = {
    type: -1;
    payload: {
        error: string;
    };
};

const POPUP_MESSAGE_TYPES = new Set<MessageType>([
    MessageType.GetState,
    MessageType.Unlock,
    MessageType.Lock,
    MessageType.GetCredentials,
    MessageType.GetCredential,
    MessageType.CreateCredential,
    MessageType.UpdateCredential,
    MessageType.DeleteCredential,
    MessageType.GetLinkedDevices,
    MessageType.GetDirectories,
    MessageType.SyncGetItems,
    MessageType.SyncGetVersionVectors,
    MessageType.SyncGetConfiguration,
    MessageType.SyncUpdateItems,
    MessageType.ProxyFetch,
    MessageType.OnlineServicesEnsureFresh,
    MessageType.OnlineServicesForceReauthenticate,
    MessageType.GetPendingSavePrompt,
    MessageType.ConsumePendingSavePrompt,
    MessageType.GetActivePageOrigin,
]);

const ALLOWED_ENCRYPTED_MESSAGE_TYPES_BY_ORIGIN: Record<
    EnvelopeOrigin,
    ReadonlySet<MessageType>
> = {
    popup: POPUP_MESSAGE_TYPES,
    link: new Set<MessageType>([
        MessageType.ProxyFetch,
        MessageType.OnlineServicesEstablish,
        MessageType.OnlineServicesClear,
        MessageType.OnlineServicesEnsureFresh,
        MessageType.OnlineServicesForceReauthenticate,
    ]),
    worker: new Set<MessageType>(),
    "autofill-cs": new Set<MessageType>([
        MessageType.GetState,
        MessageType.GetCredentialSecret,
        MessageType.GenerateTOTP,
        MessageType.SaveCredentialPrompt,
        MessageType.GetPendingSavePrompt,
        MessageType.OpenPopup,
        MessageType.RegisterAutofillFrame,
        MessageType.ReportPageOrigin,
    ]),
    "autofill-menu": new Set<MessageType>([
        MessageType.GetCredentialsForOrigin,
        MessageType.ClaimAutofillFrame,
    ]),
    "autofill-generator": new Set<MessageType>([
        MessageType.ClaimAutofillFrame,
    ]),
    "autofill-save": new Set<MessageType>([
        MessageType.CreateCredential,
        MessageType.ConsumePendingSavePrompt,
        MessageType.ClaimAutofillFrame,
    ]),
};

function isEncryptedMessageAllowedForOrigin(
    origin: EnvelopeOrigin,
    type: MessageType,
): boolean {
    return ALLOWED_ENCRYPTED_MESSAGE_TYPES_BY_ORIGIN[origin].has(type);
}

function getAutofillRequestOrigin(
    sender: chrome.runtime.MessageSender,
): AutofillRequestOrigin | null {
    const sourceUrl = sender.url ?? sender.tab?.url;
    if (!sourceUrl) return null;

    try {
        const url = new URL(sourceUrl);
        if (url.protocol !== "http:" && url.protocol !== "https:") {
            return null;
        }

        const host = url.hostname.toLowerCase().replace(/\.$/, "");
        if (!host) return null;
        return { host, etldPlus1: etldPlus1(host) };
    } catch {
        return null;
    }
}

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
        if (
            !isEncryptedMessageAllowedForOrigin(envelope.origin, envelope.type)
        ) {
            return createPlaintextEnvelope(
                envelope.type,
                {
                    ok: false,
                    error: "Message type is not allowed for this origin",
                    code: "MESSAGE_TYPE_NOT_ALLOWED",
                    origin: envelope.origin,
                    messageType:
                        MessageType[envelope.type] ?? String(envelope.type),
                },
                "worker",
            );
        }

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
                const decryptErrorRaw = decryptedPayload.error.error;
                const decryptErrorMessage =
                    typeof decryptErrorRaw === "string"
                        ? decryptErrorRaw
                        : "UNKNOWN_DECRYPTION_ERROR";

                return createPlaintextEnvelope(
                    envelope.type,
                    {
                        ok: false,
                        error: decryptErrorMessage,
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
    const result = await processMessage(
        envelope.type,
        decryptedPayload,
        sender,
    );

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
async function processMessage(
    type: MessageType,
    payload: any,
    sender: chrome.runtime.MessageSender,
): Promise<any> {
    const writeKind = VAULT_WRITE_MESSAGE_TYPES[type];
    if (writeKind) {
        return vaultWriteCoordinator.run(writeKind, () =>
            processMessageUncoordinated(type, payload, sender),
        );
    }

    return processMessageUncoordinated(type, payload, sender);
}

const VAULT_WRITE_MESSAGE_TYPES: Partial<Record<MessageType, VaultWriteKind>> =
    {
        [MessageType.Unlock]: "vault.unlock",
        [MessageType.Lock]: "vault.lock",
        [MessageType.CreateCredential]: "credential.upsert",
        [MessageType.UpdateCredential]: "credential.upsert",
        [MessageType.DeleteCredential]: "credential.delete",
        [MessageType.SyncUpdateItems]: "synchronization.apply",
    };

async function processMessageUncoordinated(
    type: MessageType,
    payload: any,
    sender: chrome.runtime.MessageSender,
): Promise<any> {
    try {
        if (type === MessageType.RegisterAutofillFrame) {
            return registerAutofillFrameBootstrap(payload, sender);
        }
        if (type === MessageType.ClaimAutofillFrame) {
            return claimAutofillFrameBootstrap(payload, sender);
        }

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

                const { vault } = res.value;

                if (metadata.DBIndex == null) {
                    return { ok: false, error: "METADATA_INDEX_NULL" };
                }

                await setSessionDEKFromVaultMetadata(
                    metadata.DBIndex,
                    metadata,
                    {
                        masterPassword: payload.form.Secret,
                    },
                );
                await setVaultInSessionStorage(
                    metadata,
                    vault,
                    metadata.DBIndex,
                );
                allowOnlineServicesSessionEstablishment();

                // Seed the Online Services session from the just-unlocked
                // vault so the SW has both the credentials AND a fresh JWT
                // before any tRPC call reaches the proxy-fetch interceptor.
                // Fire-and-forget keeps unlock latency unaffected; the
                // interceptor will await any in-flight establish via
                // `ensureFreshOnlineServicesSession`'s singleton.
                void ensureOnlineServicesSessionFromUnlockedVault()
                    .then((established) => {
                        if (!established && vault.OnlineServices) {
                            console.warn(
                                "[SW] OS session bootstrap on unlock did not establish a session",
                            );
                        }
                    })
                    .catch((error) => {
                        console.warn(
                            "[SW] OS session bootstrap on unlock failed",
                            error,
                        );
                    });

                return { ok: true };
            }

            case MessageType.Lock: {
                // The OS session is tied to the unlocked vault's identity.
                // Its bearer is captured and local auth is invalidated before
                // remote revocation; then all vault material is removed.
                await clearOnlineServicesSessionInSW();
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

                const list: LiteCredential[] = (vault?.Credentials ?? [])
                    .filter((c) => !c.Deleted)
                    .map(toLiteCredential);
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
                const dek = await getVaultDEKFromSessionStorage();

                if (!vault || !metadata || !dek) {
                    return {
                        ok: false,
                        credential: null,
                        error: "VAULT_NOT_UNLOCKED",
                    };
                }

                const data = await Vault.createCredential(payload.form);
                vault.Credentials.push(data);

                // TODO: Remove the unnecessary object assignment when we clean up the storage layer
                const metadataInstance = Object.assign(
                    new Storage.VaultMetadata(),
                    metadata,
                );

                console.log(
                    metadata.Blob?.Envelope?.Slots.map((s) => ({
                        isUint8: s.WrappedDEK instanceof Uint8Array,
                        ctor: s.WrappedDEK?.constructor?.name,
                        len: s.WrappedDEK?.length,
                    })),
                );

                await metadataInstance.save(vault, dek);

                await setVaultInSessionStorage(
                    metadataInstance,
                    vault,
                    metadata.DBIndex!,
                );

                const lightCredential: LiteCredential = toLiteCredential(data);

                return { ok: true, credential: lightCredential };
            }

            case MessageType.UpdateCredential: {
                const vault = await getVaultFromSessionStorage();
                const metadata = await getVaultMetadataFromSessionStorage();
                const dek = await getVaultDEKFromSessionStorage();

                if (!vault || !metadata || !dek) {
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
                vault.Credentials[existingIndex] = data;

                // TODO: Remove the unnecessary object assignment when we clean up the storage layer
                const metadataInstance = Object.assign(
                    new Storage.VaultMetadata(),
                    metadata,
                );
                await metadataInstance.save(vault, dek);

                await setVaultInSessionStorage(
                    metadataInstance,
                    vault,
                    metadata.DBIndex!,
                );

                return { ok: true };
            }

            case MessageType.DeleteCredential: {
                const vault = await getVaultFromSessionStorage();
                const metadata = await getVaultMetadataFromSessionStorage();
                const dek = await getVaultDEKFromSessionStorage();

                if (!vault || !metadata || !dek) {
                    return { ok: false, error: "VAULT_NOT_UNLOCKED" };
                }

                const index = vault.Credentials.findIndex(
                    (c) => c.ID === payload.id,
                );

                if (index === -1) {
                    return { ok: false, error: "NOT_FOUND" };
                }

                const credListResult = await Vault.deleteCredential(
                    vault.Credentials,
                    payload.id,
                );
                if (credListResult.isErr()) {
                    return { ok: false, error: credListResult.error };
                }
                vault.Credentials = [...credListResult.value];

                // TODO: Remove the unnecessary object assignment when we clean up the storage layer
                const metadataInstance = Object.assign(
                    new Storage.VaultMetadata(),
                    metadata,
                );
                await metadataInstance.save(vault, dek);

                await setVaultInSessionStorage(
                    metadataInstance,
                    vault,
                    metadata.DBIndex!,
                );

                return { ok: true };
            }

            case MessageType.GetLinkedDevices: {
                const vault = await getVaultFromSessionStorage();

                if (!vault) {
                    return {
                        ok: false,
                        devices: [],
                        error: "VAULT_NOT_UNLOCKED",
                    };
                }

                if (!vault.LinkedDevices) {
                    return {
                        ok: false,
                        devices: [],
                        error: "NO_SYNCHRONIZATION_CONFIGURATION",
                    };
                }

                return { ok: true, devices: vault.LinkedDevices.Devices };
            }

            case MessageType.GetDirectories: {
                const vault = await getVaultFromSessionStorage();
                return vault
                    ? {
                          ok: true,
                          directories: vault.Directories.filter(
                              (directory) => !directory.Deleted,
                          ),
                      }
                    : {
                          ok: false,
                          directories: [],
                          error: "VAULT_NOT_UNLOCKED",
                      };
            }
            case MessageType.SyncGetItems: {
                const vault = await getVaultFromSessionStorage();
                if (!vault) {
                    return {
                        ok: false,
                        credentials: [],
                        directories: [],
                        error: "VAULT_NOT_UNLOCKED",
                    };
                }

                const credentialIDs = new Set(
                    payload.items
                        .filter(
                            (item: VaultUtilTypes.SyncItemReference) =>
                                item.Type ===
                                VaultUtilTypes.SyncItemType.CredentialItem,
                        )
                        .map(
                            (item: VaultUtilTypes.SyncItemReference) => item.ID,
                        ),
                );
                const directoryIDs = new Set(
                    payload.items
                        .filter(
                            (item: VaultUtilTypes.SyncItemReference) =>
                                item.Type ===
                                VaultUtilTypes.SyncItemType.DirectoryItem,
                        )
                        .map(
                            (item: VaultUtilTypes.SyncItemReference) => item.ID,
                        ),
                );
                const credentials = vault.Credentials.filter((credential) =>
                    credentialIDs.has(credential.ID),
                );
                const directories = vault.Directories.filter((directory) =>
                    directoryIDs.has(directory.ID),
                );
                return { ok: true, credentials, directories };
            }
            case MessageType.SyncGetVersionVectors: {
                const vault = await getVaultFromSessionStorage();
                if (!vault) {
                    return {
                        ok: false,
                        credentialVersionVectors: [],
                        directoryVersionVectors: [],
                        error: "VAULT_NOT_UNLOCKED",
                    };
                }

                const credentialVersionVectors = vault.Credentials.map((c) => ({
                    ID: c.ID,
                    Hash: c.Hash ?? "",
                    Version: c.Version,
                    DateModifiedTimestamp: c.DateModifiedTimestamp,
                    Deleted: c.Deleted,
                }));
                const directoryVersionVectors = vault.Directories.map(
                    (directory) => ({
                        ID: directory.ID,
                        Hash: directory.Hash ?? "",
                        Version: directory.Version,
                        DateModifiedTimestamp: directory.DateModifiedTimestamp,
                        Deleted: directory.Deleted,
                    }),
                );

                return {
                    ok: true,
                    credentialVersionVectors,
                    directoryVersionVectors,
                };
            }
            case MessageType.SyncGetConfiguration: {
                const vault = await getVaultFromSessionStorage();
                if (!vault) {
                    return {
                        ok: false,
                        configuration: null,
                        error: "VAULT_NOT_UNLOCKED",
                    };
                }
                return { ok: true, config: vault.LinkedDevices };
            }
            case MessageType.SyncUpdateItems: {
                const vault = await getVaultFromSessionStorage();
                const metadata = await getVaultMetadataFromSessionStorage();
                const dek = await getVaultDEKFromSessionStorage();

                if (!vault || !metadata || !dek) {
                    return { ok: false, error: "VAULT_NOT_UNLOCKED" };
                }

                for (const directory of payload.directories) {
                    const existingIndex = vault.Directories.findIndex(
                        (entry) => entry.ID === directory.ID,
                    );
                    const existing = vault.Directories[existingIndex];
                    if (
                        !Vault.shouldAcceptVersionedRecord(existing, directory)
                    ) {
                        continue;
                    }
                    if (existingIndex === -1) vault.Directories.push(directory);
                    else vault.Directories[existingIndex] = directory;
                }

                const deletedDirectoryIDs = new Set(
                    vault.Directories.filter(
                        (directory) => directory.Deleted,
                    ).map((directory) => directory.ID),
                );
                for (const existing of vault.Credentials) {
                    if (
                        existing.Deleted ||
                        !deletedDirectoryIDs.has(existing.DirectoryID)
                    ) {
                        continue;
                    }
                    existing.Deleted = true;
                    existing.Name = "Unnamed item";
                    existing.Username = "";
                    existing.Password = "";
                    existing.TOTP = undefined;
                    existing.Tags = "";
                    existing.URL = "";
                    existing.Notes = "";
                    existing.CustomFields = [];
                    existing.Version += 1;
                    existing.Hash = await Vault.hashCredential(
                        Object.assign(new Vault.VaultCredential(), existing),
                    );
                }

                for (const credential of payload.credentials) {
                    const existingIndex = vault.Credentials.findIndex(
                        (entry) => entry.ID === credential.ID,
                    );
                    const existing = vault.Credentials[existingIndex];
                    if (
                        !Vault.shouldAcceptVersionedRecord(existing, credential)
                    ) {
                        continue;
                    }
                    const directory = credential.DirectoryID
                        ? vault.Directories.find(
                              (entry) => entry.ID === credential.DirectoryID,
                          )
                        : undefined;
                    if (
                        credential.DirectoryID &&
                        (!directory || directory.Deleted)
                    ) {
                        credential.Deleted = true;
                        credential.Name = "Unnamed item";
                        credential.Username = "";
                        credential.Password = "";
                        credential.TOTP = undefined;
                        credential.Tags = "";
                        credential.URL = "";
                        credential.Notes = "";
                        credential.CustomFields = [];
                        credential.Hash = await Vault.hashCredential(
                            Object.assign(
                                new Vault.VaultCredential(),
                                credential,
                            ),
                        );
                    }
                    if (existingIndex !== -1) {
                        vault.Credentials[existingIndex] = credential;
                    } else {
                        vault.Credentials.push(credential);
                    }
                }

                // TODO: Remove the unnecessary object assignment when we clean up the storage layer
                const metadataInstance = Object.assign(
                    new Storage.VaultMetadata(),
                    metadata,
                );
                await metadataInstance.save(vault, dek);

                await setVaultInSessionStorage(
                    metadataInstance,
                    vault,
                    metadata.DBIndex!,
                );

                return { ok: true };
            }

            case MessageType.ProxyFetch: {
                // Forward to the request-auth-interceptor, which owns the
                // logic that decides if/which Authorization header to attach.
                const response = await handleProxyFetch(payload);
                return response;
            }

            case MessageType.OnlineServicesEstablish: {
                if (
                    !payload ||
                    typeof payload.deviceId !== "string" ||
                    typeof payload.privateKeyJWK !== "string"
                ) {
                    return {
                        ok: false,
                        error: "INVALID_ESTABLISH_PAYLOAD",
                    };
                }
                allowOnlineServicesSessionEstablishment();
                const result = await establishOnlineServicesSession({
                    deviceId: payload.deviceId,
                    privateKeyJWK: payload.privateKeyJWK,
                });
                return result;
            }

            case MessageType.OnlineServicesClear: {
                await clearOnlineServicesSessionInSW();
                return { ok: true };
            }

            case MessageType.OnlineServicesEnsureFresh: {
                const ok = await ensureFreshOnlineServicesSession();
                return { ok };
            }

            case MessageType.OnlineServicesForceReauthenticate: {
                const ok = await forceOnlineServicesSessionReauthentication();
                return { ok };
            }

            case MessageType.GetCredentialsForOrigin: {
                const vault = await getVaultFromSessionStorage();
                return await handleGetCredentialsForOrigin(payload, vault);
            }

            case MessageType.GetActivePageOrigin: {
                return {
                    ok: true,
                    context: await getActivePageOrigin(),
                };
            }

            case MessageType.GetCredentialSecret: {
                const vault = await getVaultFromSessionStorage();
                const requestOrigin = getAutofillRequestOrigin(sender);
                if (!requestOrigin) {
                    return { ok: false, error: "REQUEST_ORIGIN_UNAVAILABLE" };
                }
                return await handleGetCredentialSecret(
                    payload,
                    vault,
                    requestOrigin,
                );
            }

            case MessageType.GenerateTOTP: {
                const vault = await getVaultFromSessionStorage();
                const requestOrigin = getAutofillRequestOrigin(sender);
                if (!requestOrigin) {
                    return { ok: false, error: "REQUEST_ORIGIN_UNAVAILABLE" };
                }
                return await handleGenerateTOTP(payload, vault, requestOrigin);
            }

            case MessageType.SaveCredentialPrompt: {
                return await handleSaveCredentialPrompt(payload);
            }

            case MessageType.GetPendingSavePrompt: {
                return await handleGetPendingSavePrompt();
            }

            case MessageType.ConsumePendingSavePrompt: {
                return await handleConsumePendingSavePrompt();
            }

            case MessageType.OpenPopup: {
                await recordPageOrigin(sender);
                return await handleOpenPopup();
            }

            case MessageType.ReportPageOrigin: {
                const context = await recordPageOrigin(sender);
                return context
                    ? { ok: true }
                    : { ok: false, error: "PAGE_ORIGIN_UNAVAILABLE" };
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

        console.debug(
            `[SW] Rotated ECDH key pair. New key ID: ${newKeyPair.keyId}`,
        );

        // TODO: Broadcast KEY_ROTATED to all connected clients (popup)
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

        console.debug(
            `[SW] Generated new ECDH key pair with ID: ${keyPair.keyId}`,
        );
    } catch (error) {
        console.error("[SW] Failed to ensure active key pair:", error);
        throw error;
    }
}

async function getVaultFromSessionStorage(): Promise<VaultUtilTypes.Vault | null> {
    const _vault = await chrome.storage.session.get([UNLOCKED_VAULT_KEY]);
    return _vault[UNLOCKED_VAULT_KEY] as VaultUtilTypes.Vault | null;
}

async function getVaultMetadataFromSessionStorage(): Promise<VaultUtilTypes.VaultMetadata | null> {
    const _metadata = await chrome.storage.session.get([
        UNLOCKED_VAULT_METADATA_KEY,
    ]);
    const encodedMetadata = _metadata[UNLOCKED_VAULT_METADATA_KEY];
    if (encodedMetadata == null) return null;
    return Storage.VaultMetadata.deserializeMetadataBinary(
        Uint8Array.fromBase64(encodedMetadata),
    );
}

async function getActiveVaultDbIndex(): Promise<number | null> {
    const stored = await chrome.storage.session.get([
        ACTIVE_VAULT_DB_INDEX_KEY,
    ]);
    const idx = stored[ACTIVE_VAULT_DB_INDEX_KEY];
    return typeof idx === "number" ? idx : null;
}

async function getVaultDEKFromSessionStorage(): Promise<CryptoKey | null> {
    const vaultDbIndex = await getActiveVaultDbIndex();
    if (vaultDbIndex == null) return null;
    return getSessionDEK(vaultDbIndex);
}

async function setVaultInSessionStorage(
    metadata: VaultUtilTypes.VaultMetadata,
    vault: VaultUtilTypes.Vault,
    vaultDbIndex: number,
): Promise<void> {
    const encodedMetadata = VaultUtilTypes.VaultMetadata.encode(metadata)
        .finish()
        .toBase64();
    await chrome.storage.session.set({
        [UNLOCKED_VAULT_METADATA_KEY]: encodedMetadata,
        [UNLOCKED_VAULT_KEY]: vault,
        [ACTIVE_VAULT_DB_INDEX_KEY]: vaultDbIndex,
    });
}

async function clearSessionStorage(): Promise<void> {
    const idx = await getActiveVaultDbIndex();
    if (idx != null) {
        await clearSessionDEK(idx);
    }
    await clearAllVaultKeyMaterial();
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

// Invalidate site-specific popup context before a navigation can expose
// credentials for the page that used to occupy this tab. The new top-level
// content script records the destination origin once it starts.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === "loading" || typeof changeInfo.url === "string") {
        void clearPageOrigin(tabId);
    }
});

chrome.tabs.onRemoved.addListener((tabId) => {
    void clearPageOrigin(tabId);
});

// Set up idle detection to lock the vault after 30 minutes of inactivity
chrome.idle.setDetectionInterval(60 * 30);
chrome.idle.onStateChanged.addListener(async (newState) => {
    if (newState === "idle") {
        console.debug("[SW] Vault locked due to inactivity");

        await vaultWriteCoordinator.run("vault.lock", async () => {
            // Match explicit lock ordering: invalidate/capture Online Services,
            // revoke remotely, then remove every local session value.
            await clearOnlineServicesSessionInSW();
            await clearSessionStorage();
        });
    }
});
