import type { VaultOperations } from "@/app_lib/synchronization";
import * as VaultUtilTypes from "@/app_lib/proto/vault";

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

const getCredentials = async (
    serverPublicKey: ServerPublicKey,
    itemIDs: string[],
): Promise<VaultUtilTypes.Credential[]> => {
    const envelope = await createEncryptedEnvelope(
        MessageType.SyncGetItemCredentials,
        { itemIDs },
        serverPublicKey.publicKeyJwk,
        serverPublicKey.keyId,
        "popup",
    );

    const res: EncryptedEnvelope | PlaintextEnvelope =
        await chrome.runtime.sendMessage(envelope);
    if (isEncryptedEnvelope(res)) {
        const decryptedPayload = await decryptResponseEnvelope<
            | { ok: false; error: string }
            | { ok: true; credentials: VaultUtilTypes.Credential[] }
        >(res);
        if (!decryptedPayload.ok) {
            console.error(
                "[SYNCHRONIZATION-POPUP] Failed to decrypt encrypted response (SyncGetItemCredentials):",
                decryptedPayload.error,
            );
            return [];
        }

        if (!decryptedPayload.payload.ok) {
            console.error(
                "[SYNCHRONIZATION-POPUP] Failed to get credentials (SyncGetItemCredentials):",
                decryptedPayload.payload.error,
            );
            return [];
        }

        return decryptedPayload.payload.credentials;
    }

    console.error(
        "[SYNCHRONIZATION-POPUP] Received a plaintext, but expected an encrypted envelope (SyncGetItemCredentials):",
        res.payload,
    );
    return [];
};

const getItemVersionVectors = async (
    serverPublicKey: ServerPublicKey,
): Promise<VaultUtilTypes.VersionVector[]> => {
    const envelope = await createEncryptedEnvelope(
        MessageType.SyncGetItemVersionVectors,
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
            | { ok: true; versionVectors: VaultUtilTypes.VersionVector[] }
        >(res);
        if (!decryptedPayload.ok) {
            console.error(
                "[SYNCHRONIZATION-POPUP] Failed to decrypt encrypted response (SyncGetItemVersionVectors):",
                decryptedPayload.error,
            );
            return [];
        }

        if (!decryptedPayload.payload.ok) {
            console.error(
                "[SYNCHRONIZATION-POPUP] Failed to get item version vectors (SyncGetItemVersionVectors):",
                decryptedPayload.payload.error,
            );
            return [];
        }

        return decryptedPayload.payload.versionVectors;
    }

    console.error(
        "[SYNCHRONIZATION-POPUP] Received a plaintext, but expected an encrypted envelope (SyncGetItemVersionVectors):",
        res.payload,
    );
    return [];
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

const updateCredentials = async (
    serverPublicKey: ServerPublicKey,
    credentials: VaultUtilTypes.Credential[],
) => {
    const envelope = await createEncryptedEnvelope(
        MessageType.SyncUpdateCredentials,
        { credentials },
        serverPublicKey.publicKeyJwk,
        serverPublicKey.keyId,
        "popup",
    );

    const res: EncryptedEnvelope | PlaintextEnvelope =
        await chrome.runtime.sendMessage(envelope);

    if (isEncryptedEnvelope(res)) {
        const decryptedPayload = await decryptResponseEnvelope<{ ok: boolean }>(
            res,
        );
        if (!decryptedPayload?.ok) {
            console.error(
                "[SYNCHRONIZATION-POPUP] Failed to update credentials and diffs:",
                decryptedPayload?.error,
            );
            return;
        }
    } else {
        console.error(
            "[SYNCHRONIZATION-POPUP] Failed to update credentials and diffs:",
            res.payload,
        );
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
        getItemVersionVectors: async () => {
            return await getItemVersionVectors(serverPublicKey);
        },
        getItemCredentials: async (itemIDs: string[]) => {
            return await getCredentials(serverPublicKey, itemIDs);
        },
        updateCredentials: async (credentials: VaultUtilTypes.Credential[]) => {
            await updateCredentials(serverPublicKey, credentials);
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
