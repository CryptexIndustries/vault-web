/**
 * Must be imported first from app entry / root layout.
 */
import "react-native-get-random-values";
import { install } from "react-native-quick-crypto";
import { Buffer } from "@craftzdog/react-native-buffer";
import { installWebRTCGlobals } from "@/lib/webrtc";

install();
// Eager: link/sync must not race layout useEffect.
installWebRTCGlobals();

const g = globalThis as typeof globalThis & {
    btoa?: (data: string) => string;
    atob?: (data: string) => string;
    Buffer?: typeof Buffer;
};

if (typeof g.Buffer === "undefined") {
    g.Buffer = Buffer as typeof g.Buffer;
}

if (typeof g.btoa !== "function") {
    g.btoa = (data: string) => Buffer.from(data, "binary").toString("base64");
}

if (typeof g.atob !== "function") {
    g.atob = (data: string) => Buffer.from(data, "base64").toString("binary");
}

// Base64 helpers used by shared vault code.
type Uint8ArrayBase64Ctor = {
    prototype: { toBase64?: () => string };
    fromBase64?: (b64: string) => Uint8Array;
};
const UA = Uint8Array as unknown as Uint8ArrayBase64Ctor;
if (typeof UA.prototype.toBase64 !== "function") {
    UA.prototype.toBase64 = function toBase64(this: Uint8Array) {
        return Buffer.from(this).toString("base64");
    };
}
if (typeof UA.fromBase64 !== "function") {
    UA.fromBase64 = (b64: string) => new Uint8Array(Buffer.from(b64, "base64"));
}
