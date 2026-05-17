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
    return bytes.toBase64();
};

/**
 * A wrapper around Uint8Array.fromBase64() - for backwards compatibility
 * TODO: Remove this
 * @param b64 The base64 string to convert to a Uint8Array
 * @returns The Uint8Array
 */
export const base64ToUint8 = (b64: string): Uint8Array => {
    return Uint8Array.fromBase64(b64);
};
