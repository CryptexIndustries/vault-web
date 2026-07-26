/**
 * Base64 / Base64URL helpers shared by vault crypto (browser, Node, RN).
 */

type Uint8ArrayBase64 = Uint8Array & {
    toBase64?: () => string;
};

type Uint8ArrayBase64Ctor = {
    fromBase64?: (b64: string) => Uint8Array;
};

export const uint8ToBase64 = (bytes: Uint8Array): string => {
    const withHelper = bytes as Uint8ArrayBase64;
    if (typeof withHelper.toBase64 === "function") {
        return withHelper.toBase64();
    }
    if (typeof btoa === "function") {
        let binary = "";
        for (const byte of bytes) binary += String.fromCharCode(byte);
        return btoa(binary);
    }
    return Buffer.from(bytes).toString("base64");
};

export const base64ToUint8 = (b64: string): Uint8Array => {
    const ctor = Uint8Array as unknown as Uint8ArrayBase64Ctor;
    if (typeof ctor.fromBase64 === "function") {
        return ctor.fromBase64(b64);
    }
    if (typeof atob === "function") {
        const binary = atob(b64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes;
    }
    return new Uint8Array(Buffer.from(b64, "base64"));
};

export const uint8ToBase64Url = (bytes: Uint8Array): string => {
    return uint8ToBase64(bytes)
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
};

export const base64UrlToUint8 = (b64: string): Uint8Array => {
    const padded = b64.replace(/-/g, "+").replace(/_/g, "/");
    const pad = padded.length % 4;
    return base64ToUint8(pad ? padded + "=".repeat(4 - pad) : padded);
};
