import type { VaultOperations } from "@cryptex-industries/vault-core/synchronization";
import * as VaultUtilTypes from "@cryptex-industries/vault-core/proto";

import {
    EncryptedEnvelope,
    MessageType,
    PlaintextEnvelope,
} from "./types/sw-messaging";
import {
    createEncryptedEnvelope,
    decryptResponseEnvelope,
    isEncryptedEnvelope,
} from "./utils/session-utils";

export type ServerPublicKey = {
    keyId: string;
    publicKeyJwk: JsonWebKey;
};

/** Coalesce sync-config reads into one SW round-trip per loader lifetime. */
export function createCachedSyncConfigLoader(
    loader: () => Promise<VaultUtilTypes.LinkedDevices>,
): () => Promise<VaultUtilTypes.LinkedDevices> {
    let pending: Promise<VaultUtilTypes.LinkedDevices> | null = null;
    let cached: VaultUtilTypes.LinkedDevices | null = null;

    return () => {
        if (cached) {
            return Promise.resolve(cached);
        }

        pending ??= loader().then((config) => {
            cached = config;
            pending = null;
            return config;
        });

        return pending;
    };
}

const getItems = async (
    serverPublicKey: ServerPublicKey,
    items: VaultUtilTypes.SyncItemReference[],
): Promise<VaultUtilTypes.SyncDataResponseMessage> => {
    const envelope = await createEncryptedEnvelope(
        MessageType.SyncGetItems,
        { items },
        serverPublicKey.publicKeyJwk,
        serverPublicKey.keyId,
        "popup",
    );

    const res: EncryptedEnvelope | PlaintextEnvelope =
        await chrome.runtime.sendMessage(envelope);
    if (isEncryptedEnvelope(res)) {
        const decryptedPayload = await decryptResponseEnvelope<
            | { ok: false; error: string }
            | {
                  ok: true;
                  credentials: VaultUtilTypes.Credential[];
                  directories: VaultUtilTypes.Directory[];
              }
        >(res);
        if (!decryptedPayload.ok) {
            console.error(
                "[SYNCHRONIZATION-POPUP] Failed to decrypt encrypted response (SyncGetItemCredentials):",
                decryptedPayload.error,
            );
            return { Credentials: [], Directories: [] };
        }

        if (!decryptedPayload.payload.ok) {
            console.error(
                "[SYNCHRONIZATION-POPUP] Failed to get credentials (SyncGetItemCredentials):",
                decryptedPayload.payload.error,
            );
            return { Credentials: [], Directories: [] };
        }

        return {
            Credentials: decryptedPayload.payload.credentials,
            Directories: decryptedPayload.payload.directories,
        };
    }

    console.error(
        "[SYNCHRONIZATION-POPUP] Received a plaintext, but expected an encrypted envelope (SyncGetItemCredentials):",
        res.payload,
    );
    return { Credentials: [], Directories: [] };
};

const getVersionVectors = async (
    serverPublicKey: ServerPublicKey,
): Promise<{
    credentialVersionVectors: VaultUtilTypes.VersionVector[];
    directoryVersionVectors: VaultUtilTypes.VersionVector[];
}> => {
    const envelope = await createEncryptedEnvelope(
        MessageType.SyncGetVersionVectors,
        null,
        serverPublicKey.publicKeyJwk,
        serverPublicKey.keyId,
        "popup",
    );

    const res: EncryptedEnvelope | PlaintextEnvelope =
        await chrome.runtime.sendMessage(envelope);
    if (isEncryptedEnvelope(res)) {
        const decryptedPayload = await decryptResponseEnvelope<
            | { ok: false; error: string }
            | {
                  ok: true;
                  credentialVersionVectors: VaultUtilTypes.VersionVector[];
                  directoryVersionVectors: VaultUtilTypes.VersionVector[];
              }
        >(res);
        if (!decryptedPayload.ok) {
            console.error(
                "[SYNCHRONIZATION-POPUP] Failed to decrypt encrypted response (SyncGetItemVersionVectors):",
                decryptedPayload.error,
            );
            return {
                credentialVersionVectors: [],
                directoryVersionVectors: [],
            };
        }

        if (!decryptedPayload.payload.ok) {
            console.error(
                "[SYNCHRONIZATION-POPUP] Failed to get item version vectors (SyncGetItemVersionVectors):",
                decryptedPayload.payload.error,
            );
            return {
                credentialVersionVectors: [],
                directoryVersionVectors: [],
            };
        }

        return decryptedPayload.payload;
    }

    console.error(
        "[SYNCHRONIZATION-POPUP] Received a plaintext, but expected an encrypted envelope (SyncGetItemVersionVectors):",
        res.payload,
    );
    return { credentialVersionVectors: [], directoryVersionVectors: [] };
};

export const getSynchronizationConfig = async (
    serverPublicKey: ServerPublicKey,
): Promise<VaultUtilTypes.LinkedDevices> => {
    const envelope = await createEncryptedEnvelope(
        MessageType.SyncGetConfiguration,
        null,
        serverPublicKey.publicKeyJwk,
        serverPublicKey.keyId,
        "popup",
    );

    const res: EncryptedEnvelope | PlaintextEnvelope =
        await chrome.runtime.sendMessage(envelope);
    if (isEncryptedEnvelope(res)) {
        const decryptedPayload = await decryptResponseEnvelope<
            | { ok: false; error: string }
            | { ok: true; config: VaultUtilTypes.LinkedDevices }
        >(res);
        if (!decryptedPayload.ok) {
            console.error(
                "[SYNCHRONIZATION-POPUP] Failed to decrypt encrypted response (SyncGetConfiguration):",
                decryptedPayload.error,
            );
            return null as unknown as VaultUtilTypes.LinkedDevices;
        }

        if (!decryptedPayload.payload.ok) {
            console.error(
                "[SYNCHRONIZATION-POPUP] Failed to get synchronization configuration (SyncGetConfiguration):",
                decryptedPayload.payload.error,
            );
            return null as unknown as VaultUtilTypes.LinkedDevices;
        }

        return decryptedPayload.payload.config;
    }

    console.error(
        "[SYNCHRONIZATION-POPUP] Received a plaintext, but expected an encrypted envelope (SyncGetConfiguration):",
        res.payload,
    );
    return null as unknown as VaultUtilTypes.LinkedDevices;
};

const updateItems = async (
    serverPublicKey: ServerPublicKey,
    directories: VaultUtilTypes.Directory[],
    credentials: VaultUtilTypes.Credential[],
) => {
    const envelope = await createEncryptedEnvelope(
        MessageType.SyncUpdateItems,
        { directories, credentials },
        serverPublicKey.publicKeyJwk,
        serverPublicKey.keyId,
        "popup",
    );

    const res: EncryptedEnvelope | PlaintextEnvelope =
        await chrome.runtime.sendMessage(envelope);

    if (isEncryptedEnvelope(res)) {
        const decryptedPayload = await decryptResponseEnvelope<
            { ok: true } | { ok: false; error: string }
        >(res);
        if (!decryptedPayload?.ok) {
            console.error(
                "[SYNCHRONIZATION-POPUP] Failed to update credentials and diffs:",
                decryptedPayload?.error,
            );
            throw new Error("Failed to authenticate the sync save response.");
        }
        if (!decryptedPayload.payload.ok) {
            throw new Error(decryptedPayload.payload.error);
        }
    } else {
        console.error(
            "[SYNCHRONIZATION-POPUP] Failed to update credentials and diffs:",
            res.payload,
        );
        throw new Error("Expected an encrypted sync save response.");
    }
};

export const createVaultOperations = (
    serverPublicKey: ServerPublicKey,
    onCredentialsUpdated?: () => void | Promise<void>,
    options?: {
        loadConfig?: () => Promise<VaultUtilTypes.LinkedDevices>;
    },
): VaultOperations => {
    const loadConfig = createCachedSyncConfigLoader(
        options?.loadConfig ??
            (() => getSynchronizationConfig(serverPublicKey)),
    );

    return {
        getCredentialVersionVectors: async () => {
            return (await getVersionVectors(serverPublicKey))
                .credentialVersionVectors;
        },
        getDirectoryVersionVectors: async () => {
            return (await getVersionVectors(serverPublicKey))
                .directoryVersionVectors;
        },
        getItems: async (items: VaultUtilTypes.SyncItemReference[]) => {
            return await getItems(serverPublicKey, items);
        },
        updateItems: async (directories, credentials) => {
            await updateItems(serverPublicKey, directories, credentials);
            await onCredentialsUpdated?.();
        },
        getSynchronizationConfig: loadConfig,
        getSyncSigningPublicKey: async () => {
            const config = await loadConfig();
            return config.SyncSigningPublicKey || null;
        },
        getSyncSigningPrivateKey: async () => {
            const config = await loadConfig();
            return config.SyncSigningPrivateKey || null;
        },
        getSyncKemPublicKey: async () => {
            const config = await loadConfig();
            return config.SyncKemPublicKey || null;
        },
        getSyncKemPrivateKey: async () => {
            const config = await loadConfig();
            return config.SyncKemPrivateKey || null;
        },
        getRemoteSyncPublicKey: async (linkedDeviceId: string) => {
            const config = await loadConfig();
            const device = config.Devices.find(
                (entry) => entry.ID === linkedDeviceId,
            );
            return device?.RemoteSyncPublicKey || null;
        },
        getRemoteSyncKemPublicKey: async (linkedDeviceId: string) => {
            const config = await loadConfig();
            const device = config.Devices.find(
                (entry) => entry.ID === linkedDeviceId,
            );
            return device?.RemoteSyncKemPublicKey || null;
        },
    };
};
