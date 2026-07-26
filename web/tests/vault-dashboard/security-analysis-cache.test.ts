import { describe, expect, it } from "@jest/globals";

import type {
    SecurityAnalysisResult,
    SecurityReportCredential,
} from "@cryptex-industries/vault-core/vault-utils/security-report";
import { SecurityAnalysisCache } from "../../src/components/vault-dashboard/security-analysis-cache";

const result: SecurityAnalysisResult = {
    healthBand: "good",
    analyzedCount: 0,
    weakFindings: [],
    reuseGroups: [],
    ageFindings: [],
};

describe("SecurityAnalysisCache", () => {
    it("returns a result until its TTL expires", () => {
        const cache = new SecurityAnalysisCache(100);
        const credentials: readonly SecurityReportCredential[] = [];

        cache.set(credentials, result, 1_000);

        expect(cache.get(credentials, 1_099)).toEqual({
            result,
            analyzedAt: 1_000,
        });
        expect(cache.get(credentials, 1_100)).toBeNull();
    });

    it("invalidates when the credential collection changes", () => {
        const cache = new SecurityAnalysisCache();
        const credentials: readonly SecurityReportCredential[] = [];
        const updatedCredentials: readonly SecurityReportCredential[] = [];

        cache.set(credentials, result);

        expect(cache.get(updatedCredentials)).toBeNull();
    });

    it("clears all cached results", () => {
        const cache = new SecurityAnalysisCache();
        const credentials: readonly SecurityReportCredential[] = [];

        cache.set(credentials, result);
        cache.clear();

        expect(cache.get(credentials)).toBeNull();
    });

    it("invalidates one credential collection", () => {
        const cache = new SecurityAnalysisCache();
        const credentials: readonly SecurityReportCredential[] = [];

        cache.set(credentials, result);
        cache.invalidate(credentials);

        expect(cache.get(credentials)).toBeNull();
    });
});
