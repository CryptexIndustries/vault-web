import {
    SyncItemType,
    type Directory as DirectoryRecord,
    type SyncDataResponseMessage,
    type SyncItemReference,
    type Vault,
    type VersionVector,
} from "./proto/vault";
import {
    type Directory,
    resolveDirectoryNameCollisions,
    shouldAcceptVersionedRecord,
} from "./vault-utils/vault";

export function getSyncVersionVectors(
    records: readonly VersionVector[],
): VersionVector[] {
    return records.map((record) => ({
        ID: record.ID,
        Hash: record.Hash,
        Version: record.Version,
        DateModifiedTimestamp: record.DateModifiedTimestamp,
        Deleted: record.Deleted,
    }));
}

export function selectSyncItems(
    vault: Pick<Vault, "Credentials" | "Directories">,
    items: readonly SyncItemReference[],
): SyncDataResponseMessage {
    const credentialIDs = new Set<string>();
    const directoryIDs = new Set<string>();
    for (const item of items) {
        if (item.Type === SyncItemType.CredentialItem) {
            credentialIDs.add(item.ID);
        } else if (item.Type === SyncItemType.DirectoryItem) {
            directoryIDs.add(item.ID);
        }
    }
    return {
        Credentials: vault.Credentials.filter((credential) =>
            credentialIDs.has(credential.ID),
        ),
        Directories: vault.Directories.filter((directory) =>
            directoryIDs.has(directory.ID),
        ),
    };
}

/** Clone before resolving collisions so the current vault and received records stay unchanged. */
export async function applyReceivedSyncDirectories(
    current: readonly DirectoryRecord[],
    incoming: readonly DirectoryRecord[],
    cloneDirectory: (directory: DirectoryRecord) => Directory,
): Promise<Directory[]> {
    const directories = new Map(
        current.map((directory) => [directory.ID, cloneDirectory(directory)]),
    );
    for (const directory of incoming) {
        if (
            shouldAcceptVersionedRecord(
                directories.get(directory.ID),
                directory,
            )
        ) {
            directories.set(directory.ID, cloneDirectory(directory));
        }
    }
    const updated = [...directories.values()];
    await resolveDirectoryNameCollisions(updated);
    return updated;
}
