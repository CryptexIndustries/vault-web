import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

/**
 * A wrapper around Uint8Array.toBase64() - for backwards compatibility
 * TODO: Remove this
 * @param bytes The Uint8Array to convert to a base64 string
 * @returns The base64 string
 */
export const uint8ToBase64 = (bytes: Uint8Array): string => {
    if (typeof bytes.toBase64 === "function") {
        return bytes.toBase64();
    }
    if (typeof btoa === "function") {
        let binary = "";
        for (const byte of bytes) binary += String.fromCharCode(byte);
        return btoa(binary);
    }
    return Buffer.from(bytes).toString("base64");
};

/**
 * A wrapper around Uint8Array.fromBase64() - for backwards compatibility
 * TODO: Remove this
 * @param b64 The base64 string to convert to a Uint8Array
 * @returns The Uint8Array
 */
export const base64ToUint8 = (b64: string): Uint8Array => {
    if (typeof Uint8Array.fromBase64 === "function") {
        return Uint8Array.fromBase64(b64);
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
