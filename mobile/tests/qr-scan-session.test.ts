import { afterEach, expect, it, jest } from "@jest/globals";
import { createChunkedQRCodeFrames } from "../../packages/shared-ui/src/lib/chunked-qr";
import { createQrScanSession } from "../src/utils/qr-scan-session";

afterEach(() => { jest.restoreAllMocks(); });
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
const payload = "test-invitation-data/".repeat(100);

it("starts with no old parts after cancellation and rejects late camera events", async () => {
    const frames = await createChunkedQRCodeFrames(payload);
    const progress = jest.fn();
    const complete = jest.fn();
    const old = createQrScanSession(progress, complete);
    old.scan(frames[0]);
    expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({ received: 1 }));
    old.cancel();
    progress.mockClear();
    const next = createQrScanSession(progress, complete);
    old.scan(frames[1]);
    expect(progress).not.toHaveBeenCalled();
    next.scan(frames[1]);
    expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({ received: 1 }));
    expect(complete).not.toHaveBeenCalled();
});

it.each(["valid", "invalid", "rejected"])(
    "ignores a %s hash completion after leaving and reopening the scanner",
    async (outcome) => {
        const frames = await createChunkedQRCodeFrames(payload);
        const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
        let resolve!: (value: ArrayBuffer) => void;
        let reject!: (error: Error) => void;
        jest.spyOn(crypto.subtle, "digest").mockImplementationOnce(() =>
            new Promise<ArrayBuffer>((yes, no) => { resolve = yes; reject = no; }),
        );
        const progress = jest.fn();
        const complete = jest.fn();
        const old = createQrScanSession(progress, complete);
        frames.forEach(old.scan);
        old.cancel();
        const next = createQrScanSession(progress, complete);
        next.scan(frames[1]);
        progress.mockClear();
        if (outcome === "rejected") reject(new Error("Synthetic hash failure"));
        else resolve(outcome === "valid" ? hash : new ArrayBuffer(32));
        await flush();
        expect(progress).not.toHaveBeenCalled();
        expect(complete).not.toHaveBeenCalled();
        next.scan(frames[0]);
        expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({ received: 2 }));
    },
);

it("verifies a complete collection once despite repeated camera frames", async () => {
    const frames = await createChunkedQRCodeFrames(payload);
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
    let resolve!: (value: ArrayBuffer) => void;
    const digest = jest.spyOn(crypto.subtle, "digest").mockImplementation(() =>
        new Promise<ArrayBuffer>((yes) => { resolve = yes; }),
    );
    const complete = jest.fn();
    const session = createQrScanSession(jest.fn(), complete);
    frames.forEach(session.scan);
    frames.forEach(session.scan);
    expect(digest).toHaveBeenCalledTimes(1);
    resolve(hash);
    await flush();
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledWith(payload);
    frames.forEach(session.scan);
    expect(complete).toHaveBeenCalledTimes(1);
});

it("accepts an unchunked invitation only once per session", () => {
    const complete = jest.fn();
    const session = createQrScanSession(jest.fn(), complete);
    session.scan("single-qr-invitation");
    session.scan("single-qr-invitation");
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledWith("single-qr-invitation");
});

it.each(["invalid", "rejected"])("can retry after a %s hash result", async (outcome) => {
    const frames = await createChunkedQRCodeFrames(payload);
    const digest = jest.spyOn(crypto.subtle, "digest");
    if (outcome === "invalid") digest.mockResolvedValueOnce(new ArrayBuffer(32));
    else digest.mockRejectedValueOnce(new Error("Synthetic hash failure"));
    let finish!: (value: string) => void;
    const completed = new Promise<string>((resolve) => { finish = resolve; });
    const onComplete = jest.fn(finish);
    const session = createQrScanSession(jest.fn(), onComplete);
    frames.forEach(session.scan);
    await flush();
    expect(onComplete).not.toHaveBeenCalled();
    frames.forEach(session.scan);
    expect(await completed).toBe(payload);
    expect(onComplete).toHaveBeenCalledTimes(1);
});
