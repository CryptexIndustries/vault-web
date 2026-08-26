/**
 * @jest-environment node
 */
import { beforeEach, describe, expect, it, jest } from "@jest/globals";

import {
    ZXING_READER_WASM_PATH,
    locateZXingWasmFile,
} from "../src/utils/zxing-wasm";

const getURL = jest.fn<(path: string) => string>();

beforeEach(() => {
    jest.clearAllMocks();
    getURL.mockImplementation(
        (filePath) => `chrome-extension://test-id/${filePath}`,
    );
    globalThis.chrome = {
        runtime: { getURL },
    } as unknown as typeof chrome;
});

describe("locateZXingWasmFile", () => {
    it("resolves Wasm files to the packaged reader binary", () => {
        expect(locateZXingWasmFile("zxing_reader.wasm", "/unused/")).toBe(
            `chrome-extension://test-id/${ZXING_READER_WASM_PATH}`,
        );
        expect(getURL).toHaveBeenCalledWith(ZXING_READER_WASM_PATH);
    });

    it("leaves non-Wasm files on the provided prefix", () => {
        expect(locateZXingWasmFile("helper.js", "https://example.test/")).toBe(
            "https://example.test/helper.js",
        );
        expect(getURL).not.toHaveBeenCalled();
    });
});
