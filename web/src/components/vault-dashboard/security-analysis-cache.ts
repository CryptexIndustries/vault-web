import type {
    SecurityAnalysisResult,
    SecurityReportCredential,
} from "@cryptex-industries/vault-core/vault-utils/security-report";

export const SECURITY_ANALYSIS_CACHE_TTL_MS = 10 * 60 * 1000;

type CredentialCollection = readonly SecurityReportCredential[];

export type CachedSecurityAnalysis = {
    result: SecurityAnalysisResult;
    analyzedAt: number;
};

type CacheEntry = CachedSecurityAnalysis & {
    expiresAt: number;
};

/**
 * Stores only sanitized analysis results in memory. Credential collections are
 * weak keys used for change detection and are never copied or retained.
 */
export class SecurityAnalysisCache {
    private entries = new WeakMap<CredentialCollection, CacheEntry>();

    constructor(
        private readonly ttlMs: number = SECURITY_ANALYSIS_CACHE_TTL_MS,
    ) {}

    get(
        credentials: CredentialCollection,
        now = Date.now(),
    ): CachedSecurityAnalysis | null {
        const entry = this.entries.get(credentials);
        if (!entry) return null;

        if (now >= entry.expiresAt) {
            this.entries.delete(credentials);
            return null;
        }

        return {
            result: entry.result,
            analyzedAt: entry.analyzedAt,
        };
    }

    set(
        credentials: CredentialCollection,
        result: SecurityAnalysisResult,
        now = Date.now(),
    ): void {
        this.entries.set(credentials, {
            result,
            analyzedAt: now,
            expiresAt: now + this.ttlMs,
        });
    }

    invalidate(credentials: CredentialCollection): void {
        this.entries.delete(credentials);
    }

    clear(): void {
        this.entries = new WeakMap();
    }
}
