/**
 * React Native WebCrypto can export EC JWK coordinates using padded, standard
 * base64. JWK requires unpadded base64url, and browsers reject the former when
 * they import a linked device's private key.
 */
function toBase64Url(value: string): string {
    // Older react-native-quick-crypto releases used `.` for base64url padding,
    // while some WebCrypto implementations use standard base64 `=` padding.
    return value
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/[.=]+$/, "");
}

export function normalizeEcJwk(jwk: JsonWebKey): JsonWebKey {
    return {
        ...jwk,
        x: jwk.x ? toBase64Url(jwk.x) : jwk.x,
        y: jwk.y ? toBase64Url(jwk.y) : jwk.y,
        d: jwk.d ? toBase64Url(jwk.d) : jwk.d,
    };
}
