/**
 * Copies a buffer or view into a Uint8Array of the calling realm. Firefox
 * content scripts see page data and WebCrypto results from the page's realm,
 * where `instanceof ArrayBuffer` is false and views throw on subarray() and
 * slice().
 */
export function copyBytes(value: BufferSource): Uint8Array {
    const view = ArrayBuffer.isView(value)
        ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
        : new Uint8Array(value);
    const bytes = new Uint8Array(view.length);
    bytes.set(view);
    return bytes;
}
