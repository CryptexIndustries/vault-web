import {
    handleChunkedQRCodeUpdate,
    type ChunkedQRCodeCollectorState,
    type ChunkedQRCodeProgress,
} from "../../../packages/shared-ui/src/lib/chunked-qr";

// One collector per camera session. Old camera events and asynchronous hash
// completions must not survive cancellation or populate a replacement session.
export function createQrScanSession(
    onProgress: (progress: ChunkedQRCodeProgress | null) => void,
    onComplete: (payload: string) => void,
) {
    let state: ChunkedQRCodeCollectorState | null = null;
    let cancelled = false;
    const cancel = () => {
        cancelled = true;
        state?.chunks.clear();
        state = null;
    };
    return {
        cancel,
        scan(data: string) {
            if (cancelled || (state && state.chunks.size === state.total)) return;
            const text = data.trim();
            if (!text) return;
            handleChunkedQRCodeUpdate({
                currentState: state,
                error: null,
                result: { getText: () => text },
                onStateChange(next) {
                    if (cancelled) return;
                    state = next;
                },
                onChunkProgress(progress) {
                    if (!cancelled) onProgress(progress);
                },
                onUpdate(_error, result) {
                    if (cancelled || !result) return;
                    const payload = result.getText();
                    cancel();
                    onProgress(null);
                    onComplete(payload);
                },
            });
        },
    };
}
