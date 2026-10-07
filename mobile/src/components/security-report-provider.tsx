import {
    createContext,
    useContext,
    useEffect,
    useMemo,
    useState,
    type ReactNode,
} from "react";
import { useAtomValue } from "jotai";

import type { SecurityAnalysisResult } from "@cryptex-industries/vault-core/vault-utils/security-report";
import { vaultCredentialsAtom } from "@/utils/atoms";
import { startSecurityAnalysis } from "@/utils/security-analysis-worker";

type SecurityReportState = {
    analysis: SecurityAnalysisResult | null;
    progress: { processed: number; total: number };
    running: boolean;
    error: boolean;
    refresh: () => void;
};

const SecurityReportContext = createContext<SecurityReportState | null>(null);

export function SecurityReportProvider({ children }: { children: ReactNode }) {
    const credentials = useAtomValue(vaultCredentialsAtom);
    const activeCredentials = useMemo(
        () => credentials.filter((credential) => !credential.Deleted),
        [credentials],
    );
    const [revision, setRevision] = useState(0);
    const [analysis, setAnalysis] = useState<SecurityAnalysisResult | null>(
        null,
    );
    const [progress, setProgress] = useState({ processed: 0, total: 0 });
    const [running, setRunning] = useState(true);
    const [error, setError] = useState(false);

    useEffect(() => {
        setRunning(true);
        setProgress({ processed: 0, total: 0 });
        setError(false);
        try {
            return startSecurityAnalysis(
                activeCredentials,
                setProgress,
                (result) => {
                    setAnalysis(result);
                    setRunning(false);
                    setProgress({
                        processed: result.analyzedCount,
                        total: result.analyzedCount,
                    });
                },
                () => {
                    setError(true);
                    setRunning(false);
                },
            );
        } catch {
            setError(true);
            setRunning(false);
        }
    }, [activeCredentials, revision]);

    return (
        <SecurityReportContext.Provider
            value={{
                analysis,
                progress,
                running,
                error,
                refresh: () => setRevision((value) => value + 1),
            }}
        >
            {children}
        </SecurityReportContext.Provider>
    );
}

export function useSecurityReport() {
    const value = useContext(SecurityReportContext);
    if (!value) {
        throw new Error(
            "useSecurityReport must be used inside SecurityReportProvider",
        );
    }
    return value;
}
