interface Uint8Array<TArrayBuffer extends ArrayBufferLike = ArrayBufferLike> {
    toBase64(): string;
}

interface Uint8ArrayConstructor {
    fromBase64(base64: string): Uint8Array<ArrayBuffer>;
}
