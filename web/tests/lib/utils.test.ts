import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";

type Uint8ArrayCtorWithPolyfill = {
    fromBase64?: (b64: string) => Uint8Array;
};

const polyfillState: {
    originalFromBase64?: ((b64: string) => Uint8Array) | undefined;
    originalToBase64?: (() => string) | undefined;
} = {};

beforeAll(() => {
    const ctor = Uint8Array as unknown as Uint8ArrayCtorWithPolyfill;
    polyfillState.originalFromBase64 = ctor.fromBase64;
    polyfillState.originalToBase64 = (
        Uint8Array.prototype as unknown as { toBase64?: () => string }
    ).toBase64;

    if (typeof ctor.fromBase64 !== "function") {
        ctor.fromBase64 = (b64: string) =>
            new Uint8Array(Buffer.from(b64, "base64"));
    }
    if (
        typeof (Uint8Array.prototype as unknown as { toBase64?: () => string })
            .toBase64 !== "function"
    ) {
        (
            Uint8Array.prototype as unknown as { toBase64: () => string }
        ).toBase64 = function () {
            return Buffer.from(this as unknown as Uint8Array).toString(
                "base64",
            );
        };
    }
});

afterAll(() => {
    const ctor = Uint8Array as unknown as Uint8ArrayCtorWithPolyfill;
    if (polyfillState.originalFromBase64 === undefined) {
        delete ctor.fromBase64;
    } else {
        ctor.fromBase64 = polyfillState.originalFromBase64;
    }
    const proto = Uint8Array.prototype as unknown as {
        toBase64?: () => string;
    };
    if (polyfillState.originalToBase64 === undefined) {
        delete proto.toBase64;
    } else {
        proto.toBase64 = polyfillState.originalToBase64;
    }
});

import { base64ToUint8, cn, uint8ToBase64 } from "../../src/lib/utils";

describe("uint8ToBase64 / base64ToUint8 round-trips", () => {
    it("round-trips empty bytes", () => {
        const empty = new Uint8Array();
        const encoded = uint8ToBase64(empty);
        expect(encoded).toBe("");
        const decoded = base64ToUint8(encoded);
        expect(Array.from(decoded)).toEqual([]);
    });

    it("round-trips a single byte 0x00", () => {
        const bytes = new Uint8Array([0x00]);
        const encoded = uint8ToBase64(bytes);
        const decoded = base64ToUint8(encoded);
        expect(Array.from(decoded)).toEqual([0x00]);
    });

    it("round-trips a single byte 0xFF", () => {
        const bytes = new Uint8Array([0xff]);
        const encoded = uint8ToBase64(bytes);
        const decoded = base64ToUint8(encoded);
        expect(Array.from(decoded)).toEqual([0xff]);
    });

    it("round-trips all byte values 0x00..0xFF", () => {
        const bytes = new Uint8Array(256);
        for (let i = 0; i < 256; i++) bytes[i] = i;
        const encoded = uint8ToBase64(bytes);
        const decoded = base64ToUint8(encoded);
        expect(Array.from(decoded)).toEqual(Array.from(bytes));
    });

    it("round-trips a 1KB random payload", () => {
        const bytes = new Uint8Array(1024);
        for (let i = 0; i < bytes.length; i++) {
            bytes[i] = Math.floor(Math.random() * 256);
        }
        const encoded = uint8ToBase64(bytes);
        const decoded = base64ToUint8(encoded);
        expect(Array.from(decoded)).toEqual(Array.from(bytes));
    });

    it("uint8ToBase64 produces the standard base64 alphabet (no URL-safe substitution)", () => {
        const bytes = new Uint8Array([0xfb, 0xff]);
        const encoded = uint8ToBase64(bytes);
        expect(encoded).toBe("+/8=");
    });

    it("base64ToUint8 returns an empty array for empty input", () => {
        expect(Array.from(base64ToUint8(""))).toEqual([]);
    });

    it("base64ToUint8 delegates to Uint8Array.fromBase64 without input validation", () => {
        // Source `base64ToUint8` is a single-line delegate to `Uint8Array.fromBase64`.
        // The polyfill installed in this test file uses `Buffer.from(_, 'base64')`,
        // which is lenient: it silently ignores characters outside the base64
        // alphabet rather than throwing. Pin that contract so callers know they
        // cannot rely on `base64ToUint8` to validate input.
        const result = base64ToUint8("!!!not-base64!!!");
        expect(result).toBeInstanceOf(Uint8Array);
    });

    it("base64ToUint8 propagates strict Uint8Array.fromBase64 errors", () => {
        // The ESM spec for `Uint8Array.fromBase64` is strict and throws SyntaxError
        // on invalid input. Source does not try/catch, so the error must surface.
        const ctor = Uint8Array as Uint8ArrayCtorWithPolyfill;
        const originalFromBase64 = ctor.fromBase64;
        ctor.fromBase64 = (b64: string) => {
            if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) {
                throw new SyntaxError("invalid base64");
            }
            return new Uint8Array(Buffer.from(b64, "base64"));
        };
        try {
            expect(() => base64ToUint8("!!!not-base64!!!")).toThrow(
                /invalid base64/,
            );
        } finally {
            ctor.fromBase64 = originalFromBase64;
        }
    });
});

describe("cn (Tailwind class merge)", () => {
    it("concatenates plain class names", () => {
        expect(cn("a", "b")).toBe("a b");
    });

    it("filters out falsy values", () => {
        expect(cn("a", false, null, undefined, "b")).toBe("a b");
    });

    it("dedupes/merges conflicting tailwind utilities", () => {
        const merged = cn("p-2", "p-4");
        expect(merged).toBe("p-4");
    });

    it("returns empty string for no inputs", () => {
        expect(cn()).toBe("");
    });
});
