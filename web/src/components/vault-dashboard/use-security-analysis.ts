import { useCallback, useEffect, useRef, useState } from "react";

import {
    iterateCredentialSecurityAnalysis,
    type SecurityAnalysisProgress,
    type SecurityAnalysisResult,
    type SecurityReportCredential,
} from "@/app_lib/vault-utils/security-report";
import { SecurityAnalysisCache } from "./security-analysis-cache";

const ANALYSIS_CHUNK_BUDGET_MS = 12;

export function useSecurityAnalysis(
    credentials: readonly SecurityReportCredential[],
    active: boolean,
) {
    const [analysis, setAnalysis] = useState<SecurityAnalysisResult | null>(
        null,
    );
    const [progress, setProgress] = useState<SecurityAnalysisProgress | null>(
        null,
    );
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [error, setError] = useState(false);
    const [analyzedAt, setAnalyzedAt] = useState<number | null>(null);
    const [refreshRequest, setRefreshRequest] = useState(0);
    const cacheRef = useRef<SecurityAnalysisCache | null>(null);
    if (!cacheRef.current) cacheRef.current = new SecurityAnalysisCache();
    const cache = cacheRef.current;

    useEffect(() => () => cache.clear(), [cache]);

    useEffect(() => {
        if (!active) {
            setIsAnalyzing(false);
            setProgress(null);
            setError(false);
            return;
        }

        const cachedAnalysis = cache.get(credentials);
        if (cachedAnalysis) {
            setAnalysis(cachedAnalysis.result);
            setAnalyzedAt(cachedAnalysis.analyzedAt);
            setIsAnalyzing(false);
            setProgress(null);
            setError(false);
            return;
        }

        const analysisIterator = iterateCredentialSecurityAnalysis(
            credentials,
            Date.now(),
        );
        let analysisTimer: number | null = null;
        let disposed = false;

        setError(false);
        setIsAnalyzing(true);
        setProgress(null);

        const processChunk = () => {
            try {
                const deadline = performance.now() + ANALYSIS_CHUNK_BUDGET_MS;
                let step = analysisIterator.next();

                while (!step.done && performance.now() < deadline) {
                    step = analysisIterator.next();
                }

                if (disposed) return;
                if (step.done) {
                    const completedAt = Date.now();
                    cache.set(credentials, step.value, completedAt);
                    setAnalysis(step.value);
                    setAnalyzedAt(completedAt);
                    setProgress({
                        processed: step.value.analyzedCount,
                        total: step.value.analyzedCount,
                    });
                    setIsAnalyzing(false);
                    return;
                }

                setProgress(step.value);
                analysisTimer = window.setTimeout(processChunk, 0);
            } catch {
                if (disposed) return;
                setError(true);
                setIsAnalyzing(false);
            }
        };

        analysisTimer = window.setTimeout(processChunk, 0);

        return () => {
            disposed = true;
            if (analysisTimer !== null) window.clearTimeout(analysisTimer);
        };
    }, [active, cache, credentials, refreshRequest]);

    const refresh = useCallback(() => {
        cache.invalidate(credentials);
        setRefreshRequest((request) => request + 1);
    }, [cache, credentials]);

    return { analysis, progress, isAnalyzing, error, analyzedAt, refresh };
}
