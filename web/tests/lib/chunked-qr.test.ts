import { describe, expect, it } from "@jest/globals";
import { webcrypto } from "crypto";
import { TextEncoder } from "util";
import {
    collectChunkedQRCodeFrame,
    createChunkedQRCodeFrames,
    handleChunkedQRCodeUpdate,
    parseChunkedQRCodeFrame,
    type ChunkedQRCodeCollectorState,
    type ChunkedQRCodeProgress,
} from "@ui/lib/chunked-qr";

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

    it("scan update helper waits for every chunk before emitting payload", async () => {
        const payload = "abcdefghijklmnopqrstuvwxyz";
        const frames = await createChunkedQRCodeFrames(payload, 7);
        let state: ChunkedQRCodeCollectorState | null = null;
        const progress: ChunkedQRCodeProgress[] = [];
        const emitted: Array<string | null> = [];

        for (const frameText of frames.slice(0, -1)) {
            handleChunkedQRCodeUpdate({
                currentState: state,
                error: null,
                result: { getText: () => frameText },
                onUpdate: (_, result) =>
                    emitted.push(result?.getText() ?? null),
                onChunkProgress: (nextProgress) => {
                    if (nextProgress) progress.push(nextProgress);
                },
                onStateChange: (nextState) => {
                    state = nextState;
                },
            });
        }

        expect((state as ChunkedQRCodeCollectorState | null)?.chunks.size).toBe(
            frames.length - 1,
        );
        expect(progress.at(-1)).toMatchObject({
            received: frames.length - 1,
            total: frames.length,
        });
        expect(emitted).toEqual(Array(frames.length - 1).fill(null));

        await new Promise<void>((resolve) => {
            handleChunkedQRCodeUpdate({
                currentState: state,
                error: null,
                result: { getText: () => frames.at(-1)! },
                onUpdate: (_, result) => {
                    if (!result) return;
                    emitted.push(result.getText());
                    resolve();
                },
                onChunkProgress: (nextProgress) => {
                    if (nextProgress) progress.push(nextProgress);
                },
                onStateChange: (nextState) => {
                    state = nextState;
                },
            });
        });

        expect(emitted.at(-1)).toBe(payload);
        expect(state).toBeNull();
    });
});
