/**
 * Packaged ZXing reader Wasm for the device-link QR scanner.
 *
 * barcode-detector/zxing-wasm defaults to jsDelivr. Chrome Web Store forbids
 * that remote code, so locateFile must always resolve inside the extension.
 */
export const ZXING_READER_WASM_PATH = "wasm-libs/zxing_reader.wasm";

export function locateZXingWasmFile(filePath: string, prefix: string): string {
    if (filePath.endsWith(".wasm")) {
        return chrome.runtime.getURL(ZXING_READER_WASM_PATH);
    }
    return `${prefix}${filePath}`;
}
