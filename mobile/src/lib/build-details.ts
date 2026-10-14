type AppMetadata = { version?: string; android?: { versionCode?: number }; extra?: { buildDetails?: { profile?: string; distribution?: string; sourceRevision?: string | { commit: string; dirty?: boolean }; revision?: string | { commit: string; dirty?: boolean } | null } } };
type UpdateMetadata = { isEnabled?: boolean; runtimeVersion?: string | null; updateId?: string | null; channel?: string | null; isEmbeddedLaunch?: boolean };
export function getBuildDetails(config: AppMetadata | null | undefined, updates: UpdateMetadata = {}) {
    const details = config?.extra?.buildDetails;
    const revision = details?.sourceRevision ?? details?.revision;
    return {
        profile: details?.profile ?? 'development',
        distribution: details?.distribution ?? 'standard',
        version: config?.version ?? 'development',
        build: config?.android?.versionCode,
        revision: typeof revision === 'string' ? revision : revision?.commit ? `${revision.commit.slice(0, 12)}${revision.dirty ? ' (modified)' : ''}` : 'unknown',
        runtime: updates.runtimeVersion ?? 'unavailable',
        update: updates.updateId ?? 'embedded',
        channel: updates.channel ?? details?.profile ?? 'development',
        ota: updates.isEnabled === true ? 'enabled' : 'disabled',
    };
}
