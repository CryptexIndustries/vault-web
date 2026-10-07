export const ICE_CANDIDATE_DISCOVERY_GRACE_MS = 5_000;

export interface IceCandidateDiscovery {
    candidateReceived(): void;
    gatheringCompleted(): void;
    cancel(): void;
}

/** Native network discovery can publish candidates after an empty completion. */
export function createIceCandidateDiscovery(
    onNoCandidates: () => void,
): IceCandidateDiscovery {
    let hasCandidate = false;
    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const clearPending = () => {
        if (timeout !== undefined) {
            clearTimeout(timeout);
            timeout = undefined;
        }
    };
    return {
        candidateReceived() {
            if (cancelled) return;
            hasCandidate = true;
            clearPending();
        },
        gatheringCompleted() {
            if (cancelled || hasCandidate || timeout !== undefined) return;
            timeout = setTimeout(() => {
                timeout = undefined;
                if (cancelled || hasCandidate) return;
                cancelled = true;
                onNoCandidates();
            }, ICE_CANDIDATE_DISCOVERY_GRACE_MS);
        },
        cancel() {
            cancelled = true;
            clearPending();
        },
    };
}
