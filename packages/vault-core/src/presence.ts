/** Presence channel name helpers (sync + link). */

export function constructSyncPresenceChannelName(syncID: string): string {
    return `presence-sync-${syncID}`;
}

export function constructLinkPresenceChannelName(id: string): string {
    return `presence-link-${id}`;
}
