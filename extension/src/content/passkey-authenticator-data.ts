/**
 * WebAuthn/CTAP protocol encoding for Cryptex's software authenticator.
 *
 * These byte layouts are required by WebAuthn; they are not an extension-side
 * wire format we control. Keep them isolated from UI and vault orchestration.
 *
 * @see https://www.w3.org/TR/webauthn-3/#sctn-authenticator-data
 * @see https://www.w3.org/TR/webauthn-3/#attested-credential-data
 * @see https://www.rfc-editor.org/rfc/rfc9053.html#name-double-coordinate-curves
 */

export const ES256_ALGORITHM_IDENTIFIER = -7;

const MAX_CREDENTIAL_ID_LENGTH = 1023;

/**
 * Authenticator model: Cryptex Vault synchronized software authenticator.
 * Stable across users, devices, and credentials.
 */
export const CRYPTEX_VAULT_SYNCED_SOFTWARE_AUTHENTICATOR_AAGUID = Uint8Array.of(
    0xbe,
    0xc1,
    0x41,
    0x8f,
    0xa8,
    0xc4,
    0x4c,
    0x38,
    0xac,
    0x6f,
    0x3e,
    0x3e,
    0x1f,
    0x9a,
    0xd0,
    0xc0,
);

const AUTHENTICATOR_DATA_FLAG = {
    USER_PRESENT: 1 << 0,
    USER_VERIFIED: 1 << 2,
    BACKUP_ELIGIBLE: 1 << 3,
    BACKED_UP: 1 << 4,
    ATTESTED_CREDENTIAL_DATA: 1 << 6,
} as const;

const COSE_KEY_LABEL = {
    KEY_TYPE: 1,
    ALGORITHM: 3,
    CURVE: -1,
    X_COORDINATE: -2,
    Y_COORDINATE: -3,
} as const;

const COSE_KEY_TYPE_EC2 = 2;
const COSE_CURVE_P256 = 1;

type CborValue =
    | number
    | string
    | Uint8Array
    | ReadonlyMap<CborValue, CborValue>;

function concatBytes(...parts: Uint8Array[]): Uint8Array {
    const output = new Uint8Array(
        parts.reduce((length, part) => length + part.length, 0),
    );
    let offset = 0;
    for (const part of parts) {
        output.set(part, offset);
        offset += part.length;
    }
    return output;
}

function unsignedBigEndian(value: number, byteLength: 1 | 2 | 4): Uint8Array {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new RangeError("Expected a non-negative safe integer");
    }

    const output = new Uint8Array(byteLength);
    const view = new DataView(output.buffer);
    if (byteLength === 1) view.setUint8(0, value);
    else if (byteLength === 2) view.setUint16(0, value, false);
    else view.setUint32(0, value, false);
    return output;
}

/** Encodes a CBOR major type and its unsigned argument (RFC 8949 section 3). */
function encodeCborHead(majorType: number, argument: number): Uint8Array {
    if (argument < 24) return Uint8Array.of((majorType << 5) | argument);
    if (argument <= 0xff) {
        return concatBytes(
            Uint8Array.of((majorType << 5) | 24),
            unsignedBigEndian(argument, 1),
        );
    }
    if (argument <= 0xffff) {
        return concatBytes(
            Uint8Array.of((majorType << 5) | 25),
            unsignedBigEndian(argument, 2),
        );
    }
    return concatBytes(
        Uint8Array.of((majorType << 5) | 26),
        unsignedBigEndian(argument, 4),
    );
}

function compareCanonicalCborKeys(left: Uint8Array, right: Uint8Array): number {
    if (left.length !== right.length) return left.length - right.length;
    for (let index = 0; index < left.length; index += 1) {
        const difference = left[index]! - right[index]!;
        if (difference !== 0) return difference;
    }
    return 0;
}

/** Minimal CTAP2-canonical CBOR encoder for the value types used below. */
function encodeCbor(value: CborValue): Uint8Array {
    if (typeof value === "number" && Number.isInteger(value)) {
        return value >= 0
            ? encodeCborHead(0, value)
            : encodeCborHead(1, -1 - value);
    }
    if (typeof value === "number") {
        throw new TypeError("Only integer CBOR numbers are supported");
    }
    if (typeof value === "string") {
        const encoded = new TextEncoder().encode(value);
        return concatBytes(encodeCborHead(3, encoded.length), encoded);
    }
    if (value instanceof Uint8Array) {
        return concatBytes(encodeCborHead(2, value.length), value);
    }

    const entries = [...value.entries()]
        .map(([key, item]) => ({
            key: encodeCbor(key),
            value: encodeCbor(item),
        }))
        .sort((left, right) => compareCanonicalCborKeys(left.key, right.key));
    return concatBytes(
        encodeCborHead(5, entries.length),
        ...entries.flatMap(({ key, value: item }) => [key, item]),
    );
}

function decodeBase64Url(value: string): Uint8Array {
    const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
    const padded = base64.padEnd(
        base64.length + ((4 - (base64.length % 4)) % 4),
        "=",
    );
    return Uint8Array.from(atob(padded), (character) =>
        character.charCodeAt(0),
    );
}

function encodeEs256CosePublicKey(publicKey: JsonWebKey): Uint8Array {
    if (!publicKey.x || !publicKey.y) {
        throw new Error("Generated ES256 public key is missing coordinates");
    }

    return encodeCbor(
        new Map<CborValue, CborValue>([
            [COSE_KEY_LABEL.KEY_TYPE, COSE_KEY_TYPE_EC2],
            [COSE_KEY_LABEL.ALGORITHM, ES256_ALGORITHM_IDENTIFIER],
            [COSE_KEY_LABEL.CURVE, COSE_CURVE_P256],
            [COSE_KEY_LABEL.X_COORDINATE, decodeBase64Url(publicKey.x)],
            [COSE_KEY_LABEL.Y_COORDINATE, decodeBase64Url(publicKey.y)],
        ]),
    );
}

type AuthenticatorFlags = {
    userPresent: boolean;
    userVerified: boolean;
    backupEligible: boolean;
    backedUp: boolean;
    includesAttestedCredentialData: boolean;
};

export function encodeAuthenticatorFlags(options: AuthenticatorFlags): number {
    if (options.backedUp && !options.backupEligible) {
        throw new Error("A backed-up passkey must be backup eligible");
    }

    return (
        (options.userPresent ? AUTHENTICATOR_DATA_FLAG.USER_PRESENT : 0) |
        (options.userVerified ? AUTHENTICATOR_DATA_FLAG.USER_VERIFIED : 0) |
        (options.backupEligible ? AUTHENTICATOR_DATA_FLAG.BACKUP_ELIGIBLE : 0) |
        (options.backedUp ? AUTHENTICATOR_DATA_FLAG.BACKED_UP : 0) |
        (options.includesAttestedCredentialData
            ? AUTHENTICATOR_DATA_FLAG.ATTESTED_CREDENTIAL_DATA
            : 0)
    );
}

type RegistrationAuthenticatorDataOptions = {
    rpId: string;
    credentialId: Uint8Array;
    publicKey: JsonWebKey;
    userVerified: boolean;
};

/**
 * Builds registration authenticator data in the exact order mandated by
 * WebAuthn: rpIdHash | flags | signCount | attestedCredentialData.
 */
export async function buildRegistrationAuthenticatorData({
    rpId,
    credentialId,
    publicKey,
    userVerified,
}: RegistrationAuthenticatorDataOptions): Promise<Uint8Array> {
    if (
        credentialId.length === 0 ||
        credentialId.length > MAX_CREDENTIAL_ID_LENGTH
    ) {
        throw new RangeError(
            `Credential ID length must be between 1 and ${MAX_CREDENTIAL_ID_LENGTH} bytes`,
        );
    }

    const rpIdHash = new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rpId)),
    );
    const flags = encodeAuthenticatorFlags({
        userPresent: true,
        userVerified,
        // Cryptex passkeys live in the encrypted vault saved on the user's device.
        backupEligible: true,
        backedUp: true,
        includesAttestedCredentialData: true,
    });

    const signCount = unsignedBigEndian(0, 4);
    const attestedCredentialData = concatBytes(
        CRYPTEX_VAULT_SYNCED_SOFTWARE_AUTHENTICATOR_AAGUID,
        unsignedBigEndian(credentialId.length, 2),
        credentialId,
        encodeEs256CosePublicKey(publicKey),
    );

    return concatBytes(
        rpIdHash,
        Uint8Array.of(flags),
        signCount,
        attestedCredentialData,
    );
}

/** Wraps authenticator data in the privacy-preserving `none` attestation. */
export function buildNoneAttestationObject(
    authenticatorData: Uint8Array,
): Uint8Array {
    return encodeCbor(
        new Map<CborValue, CborValue>([
            ["fmt", "none"],
            ["attStmt", new Map<CborValue, CborValue>()],
            ["authData", authenticatorData],
        ]),
    );
}
