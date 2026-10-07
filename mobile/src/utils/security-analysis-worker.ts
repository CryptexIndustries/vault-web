import {
    createSynchronizable,
    createWorkletRuntime,
    scheduleOnRN,
    scheduleOnRuntime,
    type WorkletRuntime,
} from "react-native-worklets";
import type {
    iterateCredentialSecurityAnalysis,
    SecurityAnalysisProgress,
    SecurityAnalysisResult,
    SecurityReportCredential,
} from "@cryptex-industries/vault-core/vault-utils/security-report";
import workerSource from "../workers/security-analysis.generated.json";

let runtime: WorkletRuntime | undefined;

/** Passwords stay in memory; only progress and password-free findings return. */
export function startSecurityAnalysis(
    credentials: readonly SecurityReportCredential[],
    onProgress: (progress: SecurityAnalysisProgress) => void,
    onComplete: (result: SecurityAnalysisResult) => void,
    onError: () => void,
): () => void {
    runtime ??= createWorkletRuntime({ name: "vault-security-analysis" });
    const cancelled = createSynchronizable(false);
    let active = true;
    const reportProgress = (value: SecurityAnalysisProgress) => {
        if (active) onProgress(value);
    };
    const complete = (value: SecurityAnalysisResult) => {
        if (active) onComplete(value);
    };
    const fail = () => {
        if (active) onError();
    };
    // Copy only the fields the analyzer needs, never attachments or other secrets.
    const input = credentials.map(
        ({
            ID,
            Type,
            Name,
            Username,
            Password,
            URL,
            DatePasswordChangedTimestamp,
            Deleted,
        }) => ({
            ID,
            Type,
            Name,
            Username,
            Password,
            URL,
            DatePasswordChangedTimestamp,
            Deleted,
        }),
    );
    scheduleOnRuntime(runtime, () => {
        "worklet";
        if (cancelled.getBlocking()) return;
        try {
            const worker = globalThis as typeof globalThis & {
                iterateCredentialSecurityAnalysis?: typeof iterateCredentialSecurityAnalysis;
            };
            // Trusted, build-time bundled source. Initialization also stays off RN.
            if (!worker.iterateCredentialSecurityAnalysis)
                (0, eval)(workerSource);
            const iterator = worker.iterateCredentialSecurityAnalysis!(
                input,
                Date.now(),
            );
            let step = iterator.next();
            let lastUpdate = 0;
            while (!step.done) {
                if (cancelled.getBlocking()) return;
                const now = Date.now();
                if (now - lastUpdate >= 100) {
                    scheduleOnRN(reportProgress, step.value);
                    lastUpdate = now;
                }
                step = iterator.next();
            }
            if (!cancelled.getBlocking()) scheduleOnRN(complete, step.value);
        } catch {
            // Never forward exception text that could contain credential data.
            if (!cancelled.getBlocking()) scheduleOnRN(fail);
        }
    });
    return () => {
        active = false;
        cancelled.setBlocking(true);
    };
}
