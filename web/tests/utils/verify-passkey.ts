import { createPublicKey, createVerify } from "crypto";

function base64UrlToBuffer(b64url: string): Buffer {
    const padded = b64url.replace(/-/g, "+").replace(/_/g, "/");
    const pad = padded.length % 4;
    const b64 = pad ? padded + "=".repeat(4 - pad) : padded;
    return Buffer.from(b64, "base64");
}

/** Node-only verifier mirroring Cryptex Cloud `verifyPasskeySignature`. */
export function verifyPasskeySignature(
    publicKeyJwkJson: string,
    challengeBytes: Buffer,
    signatureBase64Url: string,
): boolean {
    try {
        const key = createPublicKey({
            key: JSON.parse(publicKeyJwkJson) as Record<string, unknown>,
            format: "jwk",
        });
        const sig = base64UrlToBuffer(signatureBase64Url);
        const verifier = createVerify("SHA256");
        verifier.update(challengeBytes);
        return verifier.verify({ key, dsaEncoding: "ieee-p1363" }, sig);
    } catch {
        return false;
    }
}
