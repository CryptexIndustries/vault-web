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

// Reuse the web app's atoms store in worker scope
const store = vaultStore;

chrome.runtime.onMessage.addListener(
    (message: AnyMessage, _sender: any, sendResponse: (response: AnyMessageResponse) => void) => {
        (async () => {
            try {
                if (message.type === MessageType.Unlock) {
                    if (!message.payload.index) {
                        sendResponse({ type: message.type, payload: { ok: false, error: "METADATA_INDEX_NULL" } });
                        return;
                    }

                    const rec = await Storage.db.vaults.get(
                        message.payload.index,
                    );

                    if (!rec) {
                        sendResponse({ type: message.type, payload: { ok: false, error: "METADATA_NOT_FOUND" } });
                        return;
                    }

                    const metadata =
                        Storage.VaultMetadata.deserializeMetadataBinary(
                            rec.data,
                            message.payload.index,
                        );

                    const res = await metadata.decryptVault(
                        message.payload.form.Secret,
                        message.payload.form.Encryption,
                        message.payload.form.EncryptionKeyDerivationFunction,
                        message.payload.form.EncryptionConfig,
                    );

                    if (res.isErr()) {
                        sendResponse({ type: message.type, payload: { ok: false, error: res.error } });
                        return;
                    }

                    const vault = res.value;

                    store.set(unlockedVaultMetadataAtom, metadata);
                    store.set(unlockedVaultAtom, vault);
                    onlineServicesStore.set(onlineServicesDataAtom, {
                        key: vault.LinkedDevices.APIKey ?? "",
                        remoteData: null,
                    });

                    sendResponse({ type: message.type, payload: { ok: true } });
                    return;
                }

                if (message.type === MessageType.Lock) {
                    store.set(unlockedVaultMetadataAtom, null);
                    store.set(unlockedVaultAtom, new Vault.Vault());

                    sendResponse({ type: message.type, payload: { ok: true } });
                    return;
                }

                if (message.type === MessageType.GetState) {
                    const meta = store.get(unlockedVaultMetadataAtom);

                    if (!meta) {
                        sendResponse({ type: message.type, payload: { unlocked: false, metadata: null } });
                        return;
                    }

                    sendResponse({
                        type: message.type,
                        payload: {
                            unlocked: true,
                            metadata: {
                                id: meta.DBIndex,
                                name: meta.Name,
                            },
                        },
                    });
                    return;
                }

                if (message.type === MessageType.GetCredentials) {
                    const vault = store.get(unlockedVaultAtom);

                    const list: LiteCredential[] = (vault?.Credentials ?? []).map((c) => ({
                        id: c.ID,
                        name: c.Name,
                        username: c.Username,
                        url: c.URL,
                    }));

                    sendResponse({ type: message.type, payload: { ok: true, credentials: list } });
                    return;
                }

                if (message.type === MessageType.GetCredential) {

                    const vault = store.get(unlockedVaultAtom);
                    const cred = (vault?.Credentials ?? []).find(
                        (c) => c.ID === message.payload.id,
                    );
                    if (!cred) {
                        sendResponse({ type: message.type, payload: { ok: false, credential: null, error: "NOT_FOUND" } });
                        return;
                    }
                    sendResponse({ type: message.type, payload: { ok: true, credential: cred } });
                    return;
                }

                if (message.type === MessageType.CreateCredential) {
                    try {
                        const vault = store.get(unlockedVaultAtom);
                        const metadata = store.get(unlockedVaultMetadataAtom);

                        if (!vault || !metadata) {
                            sendResponse({ type: message.type, payload: { ok: false, credential: null, error: "VAULT_NOT_UNLOCKED" } });
                            return;
                        }

                        const data = await Vault.createCredential(message.payload.form);
                        vault.Credentials.push(data.credential);

                        const listHash = await Vault.hashCredentials(vault.Credentials);
                        const diff: VaultUtilTypes.Diff = {
                            Hash: listHash,
                            Changes: data.changes,
                        };
                        vault.Diffs.push(diff);

                        // Save the vault
                        await metadata.save(vault);

                        sendResponse({ type: message.type, payload: { ok: true, credential: data.credential } });
                        return;
                    } catch (error) {
                        sendResponse({ type: message.type, payload: { ok: false, credential: null, error: error instanceof Error ? error.message : "UNKNOWN_ERROR" } });
                        return;
                    }
                }

                if (message.type === MessageType.UpdateCredential) {
                    try {
                        const vault = store.get(unlockedVaultAtom);
                        const metadata = store.get(unlockedVaultMetadataAtom);

                        if (!vault || !metadata) {
                            sendResponse({ type: message.type, payload: { ok: false, credential: null, error: "VAULT_NOT_UNLOCKED" } });
                            return;
                        }

                        const existingIndex = vault.Credentials.findIndex(
                            (c) => c.ID === message.payload.id,
                        );

                        if (existingIndex === -1) {
                            sendResponse({ type: message.type, payload: { ok: false, credential: null, error: "NOT_FOUND" } });
                            return;
                        }

                        const existing = vault.Credentials[existingIndex];
                        const data = await Vault.updateCredentialFromForm(existing, message.payload.form);
                        vault.Credentials[existingIndex] = data.credential;

                        const listHash = await Vault.hashCredentials(vault.Credentials);
                        const diff: VaultUtilTypes.Diff = {
                            Hash: listHash,
                            Changes: data.changes,
                        };
                        vault.Diffs.push(diff);

                        // Save the vault
                        await metadata.save(vault);

                        sendResponse({ type: message.type, payload: { ok: true, credential: data.credential } });
                        return;
                    } catch (error) {
                        sendResponse({ type: message.type, payload: { ok: false, credential: null, error: error instanceof Error ? error.message : "UNKNOWN_ERROR" } });
                        return;
                    }
                }

                if (message.type === MessageType.DeleteCredential) {
                    try {
                        const vault = store.get(unlockedVaultAtom);
                        const metadata = store.get(unlockedVaultMetadataAtom);

                        if (!vault || !metadata) {
                            sendResponse({ type: message.type, payload: { ok: false, error: "VAULT_NOT_UNLOCKED" } });
                            return;
                        }

                        const index = vault.Credentials.findIndex(
                            (c) => c.ID === message.payload.id,
                        );

                        if (index === -1) {
                            sendResponse({ type: message.type, payload: { ok: false, error: "NOT_FOUND" } });
                            return;
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

                        // Save the vault
                        await metadata.save(vault);

                        sendResponse({ type: message.type, payload: { ok: true } });
                        return;
                    } catch (error) {
                        sendResponse({ type: message.type, payload: { ok: false, error: error instanceof Error ? error.message : "UNKNOWN_ERROR" } });
                        return;
                    }
                }

                // if (message.type === MessageType.LinkComplete) {
                //     // no-op for now; popup handles saving into Dexie inside page context
                //     sendResponse({ ok: true });
                //     return;
                // }
            } catch (e) {
                sendResponse({ type: -1, payload: { error: "An unknown error occurred." } });
                console.error(e);
                return false;
            }
        })();

        return true; // keep channel open for async sendResponse
    },
);
