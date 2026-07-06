interface Uint8ArrayConstructor {
    fromBase64(
        string: string,
        options?: {
            alphabet?: "base64" | "base64url";
            lastChunkHandling?: "loose" | "strict" | "stop-before-partial";
        },
    ): Uint8Array<ArrayBuffer>;
}

interface Uint8Array<TArrayBuffer extends ArrayBufferLike = ArrayBufferLike> {
    toBase64(options?: {
        alphabet?: "base64" | "base64url";
        omitPadding?: boolean;
    }): string;
}
