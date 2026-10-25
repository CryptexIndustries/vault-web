import type { VaultOperations } from "@cryptex-industries/vault-core/synchronization";
import * as VaultUtilTypes from "@cryptex-industries/vault-core/proto";
import {
    connectedAgentsFromTransport,
    connectedAgentsToTransport,
} from "@cryptex-industries/vault-core/vault-utils/connected-agents";

import {
    EncryptedEnvelope,
    MessageType,
    PlaintextEnvelope,
} from "./types/sw-messaging";
import {
    decryptResponseEnvelope,
    isEncryptedEnvelope,
} from "./utils/session-utils";
import { createPopupEnvelope } from "./utils/sw-envelope-client";

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

const emptySyncItems = (): VaultUtilTypes.SyncDataResponseMessage => ({
    Credentials: [],
    Directories: [],
    ShareLinks: [],
    ConnectedAgents: [],
});

const getItems = async (
    serverPublicKey: ServerPublicKey,
    items: VaultUtilTypes.SyncItemReference[],
): Promise<VaultUtilTypes.SyncDataResponseMessage> => {
    const envelope = await createPopupEnvelope(
        MessageType.SyncGetItems,
        { items },
        serverPublicKey,
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
                  shareLinks?: VaultUtilTypes.ShareLink[];
                  /** Base64 protobuf, see connectedAgentsToTransport. */
                  connectedAgents?: string[];
              }
        >(res);
        if (!decryptedPayload.ok) {
            console.error(
                "[SYNCHRONIZATION-POPUP] Failed to decrypt encrypted response (SyncGetItemCredentials):",
                decryptedPayload.error,
            );
            return emptySyncItems();
        }

        if (!decryptedPayload.payload.ok) {
            console.error(
                "[SYNCHRONIZATION-POPUP] Failed to get credentials (SyncGetItemCredentials):",
                decryptedPayload.payload.error,
            );
            return emptySyncItems();
        }

        return {
            Credentials: decryptedPayload.payload.credentials,
            Directories: decryptedPayload.payload.directories,
            ShareLinks: decryptedPayload.payload.shareLinks ?? [],
            ConnectedAgents: connectedAgentsFromTransport(
                decryptedPayload.payload.connectedAgents,
            ),
        };
    }

    console.error(
        "[SYNCHRONIZATION-POPUP] Received a plaintext, but expected an encrypted envelope (SyncGetItemCredentials):",
        res.payload,
    );
    return emptySyncItems();
};

const getVersionVectors = async (
    serverPublicKey: ServerPublicKey,
): Promise<{
    credentialVersionVectors: VaultUtilTypes.VersionVector[];
    directoryVersionVectors: VaultUtilTypes.VersionVector[];
    shareLinkVersionVectors: VaultUtilTypes.VersionVector[];
    connectedAgentVersionVectors: VaultUtilTypes.VersionVector[];
}> => {
    const envelope = await createPopupEnvelope(
        MessageType.SyncGetVersionVectors,
        null,
        serverPublicKey,
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
                  shareLinkVersionVectors?: VaultUtilTypes.VersionVector[];
                  connectedAgentVersionVectors?: VaultUtilTypes.VersionVector[];
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
                shareLinkVersionVectors: [],
                connectedAgentVersionVectors: [],
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
                shareLinkVersionVectors: [],
                connectedAgentVersionVectors: [],
            };
        }

        return {
            ...decryptedPayload.payload,
            shareLinkVersionVectors:
                decryptedPayload.payload.shareLinkVersionVectors ?? [],
            connectedAgentVersionVectors:
                decryptedPayload.payload.connectedAgentVersionVectors ?? [],
        };
    }

    console.error(
        "[SYNCHRONIZATION-POPUP] Received a plaintext, but expected an encrypted envelope (SyncGetItemVersionVectors):",
        res.payload,
    );
    return {
        credentialVersionVectors: [],
        directoryVersionVectors: [],
        shareLinkVersionVectors: [],
        connectedAgentVersionVectors: [],
    };
};

export const getSynchronizationConfig = async (
    serverPublicKey: ServerPublicKey,
): Promise<VaultUtilTypes.LinkedDevices> => {
    const envelope = await createPopupEnvelope(
        MessageType.SyncGetConfiguration,
        null,
        serverPublicKey,
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
    shareLinks: VaultUtilTypes.ShareLink[],
    connectedAgents: VaultUtilTypes.ConnectedAgent[],
) => {
    const envelope = await createPopupEnvelope(
        MessageType.SyncUpdateItems,
        {
            directories,
            credentials,
            shareLinks,
            connectedAgents: connectedAgentsToTransport(connectedAgents),
        },
        serverPublicKey,
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
        getShareLinkVersionVectors: async () => {
            return (await getVersionVectors(serverPublicKey))
                .shareLinkVersionVectors;
        },
        getConnectedAgentVersionVectors: async () => {
            return (await getVersionVectors(serverPublicKey))
                .connectedAgentVersionVectors;
        },
        getItems: async (items: VaultUtilTypes.SyncItemReference[]) => {
            return await getItems(serverPublicKey, items);
        },
        updateItems: async (
            directories,
            credentials,
            shareLinks,
            connectedAgents,
        ) => {
            await updateItems(
                serverPublicKey,
                directories,
                credentials,
                shareLinks,
                connectedAgents,
            );
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
