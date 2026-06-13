export const CHUNKED_QR_PREFIX = "CVQ1";
export const DEFAULT_CHUNKED_QR_CHARS = 1_500;
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

    const payload = Array.from({ length: state.total }, (_, index) =>
        state.chunks.get(index),
    ).join("");
    if (await hasSha256Base64Url(payload, state.hash)) {
        return { state, progress, payload };
    }

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
