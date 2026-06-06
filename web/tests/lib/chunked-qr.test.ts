import { describe, expect, it } from "@jest/globals";
import { webcrypto } from "crypto";
import { TextEncoder } from "util";
import {
    collectChunkedQRCodeFrame,
    createChunkedQRCodeFrames,
    parseChunkedQRCodeFrame,
} from "../../src/lib/chunked-qr";

Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    writable: true,
});

Object.defineProperty(globalThis, "TextEncoder", {
    value: TextEncoder,
    writable: true,
});

Object.defineProperty(globalThis, "btoa", {
    value: (value: string) => Buffer.from(value, "binary").toString("base64"),
    writable: true,
});

describe("chunked QR helpers", () => {
    it("returns original payload when it fits one QR", async () => {
        await expect(createChunkedQRCodeFrames("small", 100)).resolves.toEqual([
            "small",
        ]);
    });

    it("splits and reassembles chunked payloads out of order", async () => {
        const payload = "abcdefghijklmnopqrstuvwxyz";
        const frames = await createChunkedQRCodeFrames(payload, 7);

        expect(frames.length).toBeGreaterThan(1);
        expect(frames.every((frame) => frame.startsWith("CVQ1:"))).toBe(true);

        let state = null;
        let assembled: string | null = null;
        for (const frameText of [...frames].reverse()) {
            const frame = parseChunkedQRCodeFrame(frameText);
            expect(frame).not.toBeNull();
            const result = await collectChunkedQRCodeFrame(state, frame!);
            state = result.state;
            assembled = result.payload;
        }

        expect(assembled).toBe(payload);
    });
});
