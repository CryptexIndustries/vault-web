import { webcrypto } from "node:crypto";
import { TextDecoder, TextEncoder } from "node:util";

Object.defineProperty(globalThis, "TextEncoder", {
    value: TextEncoder,
    writable: true,
});

Object.defineProperty(globalThis, "TextDecoder", {
    value: TextDecoder,
    writable: true,
});

Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    writable: true,
});

(globalThis as { __DEV__?: boolean }).__DEV__ = true;
