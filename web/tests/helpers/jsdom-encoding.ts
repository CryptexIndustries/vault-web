/**
 * jsdom lacks TextEncoder and full Web Crypto, which @noble modules need when
 * they load. Import this before anything that pulls them in.
 */
import { webcrypto } from "node:crypto";
import { TextDecoder, TextEncoder } from "node:util";

if (typeof globalThis.TextEncoder === "undefined") {
    Object.defineProperty(globalThis, "TextEncoder", { value: TextEncoder });
}
if (typeof globalThis.TextDecoder === "undefined") {
    Object.defineProperty(globalThis, "TextDecoder", { value: TextDecoder });
}
if (typeof globalThis.crypto?.getRandomValues !== "function") {
    Object.defineProperty(globalThis, "crypto", { value: webcrypto });
}
