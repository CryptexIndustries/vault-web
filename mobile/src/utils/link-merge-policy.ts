/**
 * Adds missing received items while retaining existing item IDs.
 * Replaces the Online Services binding when explicitly supplied.
 */
import * as VaultUtilTypes from "@cryptex-industries/vault-core/proto";
import {
    Directory,
    LinkedDevices,
    OnlineServices,
    SignalingServerConfiguration,
    STUNServerConfiguration,
    TOTP,
    TURNServerConfiguration,
    Vault,
    VaultCredential,
} from "@cryptex-industries/vault-core/vault-utils/vault";

export type ReceiveMergeSummary = {
    credentialsAdded: number;
    credentialsSkipped: number;
    devicesAdded: number;
};

export type ReceiverSyncKeyMaterial = {
    signingPublicKey: string;
    signingPrivateKey: string;
    kemPublicKey: string;
    kemPrivateKey: string;
};

export function receiverSyncKeyMaterial(
    linkedDevices: LinkedDevices,
): ReceiverSyncKeyMaterial {
    return {
        signingPublicKey: linkedDevices.SyncSigningPublicKey,
        signingPrivateKey: linkedDevices.SyncSigningPrivateKey,
        kemPublicKey: linkedDevices.SyncKemPublicKey,
        kemPrivateKey: linkedDevices.SyncKemPrivateKey,
    };
}

const cloneCredential = (credential: VaultUtilTypes.Credential) => {
    const cloned = Object.assign(new VaultCredential(), credential);
    if (credential.TOTP) {
        cloned.TOTP = Object.assign(new TOTP(), credential.TOTP);
    }
    return cloned;
};

const cloneLinkedDevice = (device: VaultUtilTypes.LinkedDevice) =>
    LinkedDevices.fromGenericDevice(device);

const cloneSTUNServerConfig = (
    server: VaultUtilTypes.STUNServerConfiguration,
) => Object.assign(new STUNServerConfiguration(), server);

const cloneTURNServerConfig = (
    server: VaultUtilTypes.TURNServerConfiguration,
) => Object.assign(new TURNServerConfiguration(), server);

const cloneSignalingServerConfig = (
    server: VaultUtilTypes.SignalingServerConfiguration,
) => Object.assign(new SignalingServerConfiguration(), server);

/**
 * Pure merge policy: keep existing IDs, add missing credentials/dirs/servers/devices.
 * Does not persist or ensure sync keypairs.
 */
export function mergeReceivedVaultContents(params: {
    currentVault: Vault;
    receivedVault: Vault;
    onlineServicesOverwrite: OnlineServices | null;
    senderKeyBundle: VaultUtilTypes.SyncKeyBundle;
}): { vault: Vault; summary: ReceiveMergeSummary } {
    const {
        currentVault,
        receivedVault,
        onlineServicesOverwrite,
        senderKeyBundle,
    } = params;

    const mergedVault = Object.assign(new Vault(), currentVault);
    mergedVault.Credentials = currentVault.Credentials.map(cloneCredential);
    mergedVault.Directories = currentVault.Directories.map((directory) =>
        Object.assign(new Directory(), directory),
    );
    mergedVault.LinkedDevices = LinkedDevices.fromGeneric(
        currentVault.LinkedDevices,
    );
    if (onlineServicesOverwrite) {
        mergedVault.OnlineServices = onlineServicesOverwrite;
    }

    let credentialsAdded = 0;
    let credentialsSkipped = 0;
    const existingCredentialIDs = new Set(
        mergedVault.Credentials.map((credential) => credential.ID),
    );

    for (const credential of receivedVault.Credentials) {
        if (credential.Deleted || existingCredentialIDs.has(credential.ID)) {
            credentialsSkipped++;
            continue;
        }
        mergedVault.Credentials.push(cloneCredential(credential));
        existingCredentialIDs.add(credential.ID);
        credentialsAdded++;
    }

    const existingDirectoryIDs = new Set(
        mergedVault.Directories.map((directory) => directory.ID),
    );
    for (const directory of receivedVault.Directories) {
        if (existingDirectoryIDs.has(directory.ID)) continue;
        mergedVault.Directories.push(Object.assign(new Directory(), directory));
        existingDirectoryIDs.add(directory.ID);
    }

    const addMissingByID = <T extends { ID: string }>(
        current: T[],
        incoming: T[],
        clone: (item: T) => T,
    ) => {
        const ids = new Set(current.map((item) => item.ID));
        for (const item of incoming) {
            if (ids.has(item.ID)) continue;
            current.push(clone(item));
            ids.add(item.ID);
        }
    };

    addMissingByID(
        mergedVault.LinkedDevices.STUNServers,
        receivedVault.LinkedDevices.STUNServers,
        cloneSTUNServerConfig,
    );
    addMissingByID(
        mergedVault.LinkedDevices.TURNServers,
        receivedVault.LinkedDevices.TURNServers,
        cloneTURNServerConfig,
    );
    addMissingByID(
        mergedVault.LinkedDevices.SignalingServers,
        receivedVault.LinkedDevices.SignalingServers,
        cloneSignalingServerConfig,
    );

    let devicesAdded = 0;
    const existingDeviceIDs = new Set(
        mergedVault.LinkedDevices.Devices.map((device) => device.ID),
    );
    const existingSyncIDs = new Set(
        mergedVault.LinkedDevices.Devices.map((device) => device.SyncID),
    );

    for (const device of receivedVault.LinkedDevices.Devices) {
        if (
            existingDeviceIDs.has(device.ID) ||
            existingSyncIDs.has(device.SyncID)
        ) {
            continue;
        }
        const clonedDevice = cloneLinkedDevice(device);
        clonedDevice.RemoteSyncPublicKey = senderKeyBundle.SyncSigningPublicKey;
        clonedDevice.RemoteSyncKemPublicKey = senderKeyBundle.SyncKemPublicKey;
        mergedVault.LinkedDevices.Devices.push(clonedDevice);
        existingDeviceIDs.add(device.ID);
        existingSyncIDs.add(device.SyncID);
        devicesAdded++;
    }

    return {
        vault: mergedVault,
        summary: {
            credentialsAdded,
            credentialsSkipped,
            devicesAdded,
        },
    };
}
