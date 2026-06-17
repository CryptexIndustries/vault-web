export const CHUNKED_QR_PREFIX = "CVQ1";
export const DEFAULT_CHUNKED_QR_CHARS = 750;
export const DEFAULT_CHUNKED_QR_CYCLE_MS = 250;

export type ChunkedQRCodeFrame = {
    transferId: string;
    index: number;
    total: number;
    hash: string;
    chunk: string;
};

export type ChunkedQRCodeProgress = {
    transferId: string;
    received: number;
    total: number;
};

export type ChunkedQRCodeCollectorState = {
    transferId: string;
    hash: string;
    total: number;
    chunks: Map<number, string>;
};

export type ChunkedQRCodeScanResult = {
    getText: () => string;
};

export type ChunkedQRCodeUpdateCallback<T extends ChunkedQRCodeScanResult> = (
    error: unknown,
    result?: T | null,
) => void;

export async function createChunkedQRCodeFrames(
    payload: string,
    chunkChars = DEFAULT_CHUNKED_QR_CHARS,
): Promise<string[]> {
    if (payload.length <= chunkChars) {
        return [payload];
    }

    const hash = await sha256Base64Url(payload);
    const transferId = hash.slice(0, 12);
    const total = Math.ceil(payload.length / chunkChars);

    return Array.from({ length: total }, (_, index) => {
        const start = index * chunkChars;
        const chunk = payload.slice(start, start + chunkChars);
        return [
            CHUNKED_QR_PREFIX,
            transferId,
            String(index),
            String(total),
            hash,
            chunk,
        ].join(":");
    });
}

export function parseChunkedQRCodeFrame(
    payload: string,
): ChunkedQRCodeFrame | null {
    const [prefix, transferId, indexRaw, totalRaw, hash, ...chunkParts] =
        payload.split(":");
    if (prefix !== CHUNKED_QR_PREFIX) {
        return null;
    }

    const index = Number(indexRaw);
    const total = Number(totalRaw);
    const chunk = chunkParts.join(":");
    if (
        !transferId ||
        !hash ||
        !chunk ||
        !Number.isInteger(index) ||
        !Number.isInteger(total) ||
        index < 0 ||
        total < 2 ||
        index >= total
    ) {
        return null;
    }

    return {
        transferId,
        index,
        total,
        hash,
        chunk,
    };
}

export async function collectChunkedQRCodeFrame(
    currentState: ChunkedQRCodeCollectorState | null,
    frame: ChunkedQRCodeFrame,
): Promise<{
    state: ChunkedQRCodeCollectorState;
    progress: ChunkedQRCodeProgress;
    payload: string | null;
}> {
    const collection = collectChunkedQRCodeFrameCandidate(currentState, frame);
    if (!collection.payload) {
        return collection;
    }

    if (await hasSha256Base64Url(collection.payload, collection.state.hash)) {
        return collection;
    }

    return resetChunkedQRCodeCollection(frame);
}

export function handleChunkedQRCodeUpdate<T extends ChunkedQRCodeScanResult>({
    currentState,
    error,
    result,
    onUpdate,
    onChunkProgress,
    onStateChange,
}: {
    currentState: ChunkedQRCodeCollectorState | null;
    error: unknown;
    result?: T | null;
    onUpdate?: ChunkedQRCodeUpdateCallback<T>;
    onChunkProgress?: (progress: ChunkedQRCodeProgress | null) => void;
    onStateChange: (state: ChunkedQRCodeCollectorState | null) => void;
}) {
    if (!result) {
        onUpdate?.(error, result);
        return;
    }

    const text = result.getText();
    const frame = parseChunkedQRCodeFrame(text);
    if (!frame) {
        if (text.startsWith(`${CHUNKED_QR_PREFIX}:`)) {
            onUpdate?.(error, null);
            return;
        }

        onStateChange(null);
        onChunkProgress?.(null);
        onUpdate?.(error, result);
        return;
    }

    const collection = collectChunkedQRCodeFrameCandidate(currentState, frame);
    onStateChange(collection.state);
    onChunkProgress?.(collection.progress);
    if (!collection.payload) {
        onUpdate?.(error, null);
        return;
    }

    void hasSha256Base64Url(collection.payload, collection.state.hash)
        .then((isValid) => {
            if (!isValid) {
                const reset = resetChunkedQRCodeCollection(frame);
                onStateChange(reset.state);
                onChunkProgress?.(reset.progress);
                onUpdate?.(error, null);
                return;
            }

            onStateChange(null);
            onUpdate?.(error, {
                ...result,
                getText: () => collection.payload!,
            });
        })
        .catch((chunkError) => {
            onStateChange(null);
            onChunkProgress?.(null);
            onUpdate?.(chunkError, null);
        });
}

function collectChunkedQRCodeFrameCandidate(
    currentState: ChunkedQRCodeCollectorState | null,
    frame: ChunkedQRCodeFrame,
): {
    state: ChunkedQRCodeCollectorState;
    progress: ChunkedQRCodeProgress;
    payload: string | null;
} {
    const state =
        currentState &&
        currentState.transferId === frame.transferId &&
        currentState.hash === frame.hash &&
        currentState.total === frame.total
            ? currentState
            : {
                  transferId: frame.transferId,
                  hash: frame.hash,
                  total: frame.total,
                  chunks: new Map<number, string>(),
              };

    state.chunks.set(frame.index, frame.chunk);

    const progress = {
        transferId: state.transferId,
        received: state.chunks.size,
        total: state.total,
    };
    if (state.chunks.size !== state.total) {
        return { state, progress, payload: null };
    }

    return {
        state,
        progress,
        payload: Array.from({ length: state.total }, (_, index) =>
            state.chunks.get(index),
        ).join(""),
    };
}

function resetChunkedQRCodeCollection(frame: ChunkedQRCodeFrame): {
    state: ChunkedQRCodeCollectorState;
    progress: ChunkedQRCodeProgress;
    payload: null;
} {
    return {
        state: {
            transferId: frame.transferId,
            hash: frame.hash,
            total: frame.total,
            chunks: new Map([[frame.index, frame.chunk]]),
        },
        progress: {
            transferId: frame.transferId,
            received: 1,
            total: frame.total,
        },
        payload: null,
    };
}

async function hasSha256Base64Url(payload: string, expectedHash: string) {
    return (await sha256Base64Url(payload)) === expectedHash;
}

async function sha256Base64Url(payload: string): Promise<string> {
    const bytes = new TextEncoder().encode(payload);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return bytesToBase64Url(new Uint8Array(digest));
}

function bytesToBase64Url(bytes: Uint8Array): string {
    let binary = "";
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary)
        .replaceAll("+", "-")
        .replaceAll("/", "_")
        .replace(/=+$/u, "");
}
