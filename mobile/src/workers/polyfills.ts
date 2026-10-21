// Globals that isolated Hermes runtimes don't inherit from React Native.
// Imported first by each worker program, before the shared code it bundles.
import "fast-text-encoding";

const BASE64 =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

// SSH key code decodes and encodes base64 key blobs.
function atob(input: string): string {
    let output = "";
    let buffer = 0;
    let bits = 0;
    for (const char of input.replace(/[\s=]+/g, "")) {
        const value = BASE64.indexOf(char);
        if (value < 0) throw new Error("Invalid base64");
        buffer = ((buffer << 6) | value) & 0xffffff;
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            output += String.fromCharCode((buffer >> bits) & 0xff);
        }
    }
    return output;
}

function btoa(input: string): string {
    let output = "";
    for (let index = 0; index < input.length; index += 3) {
        const chunk =
            (input.charCodeAt(index) << 16) |
            ((input.charCodeAt(index + 1) || 0) << 8) |
            (input.charCodeAt(index + 2) || 0);
        output += BASE64[(chunk >> 18) & 63]! + BASE64[(chunk >> 12) & 63]!;
        output += index + 1 < input.length ? BASE64[(chunk >> 6) & 63] : "=";
        output += index + 2 < input.length ? BASE64[chunk & 63] : "=";
    }
    return output;
}

Object.assign(globalThis, {
    ...(typeof globalThis.atob === "function" ? {} : { atob }),
    ...(typeof globalThis.btoa === "function" ? {} : { btoa }),
});
