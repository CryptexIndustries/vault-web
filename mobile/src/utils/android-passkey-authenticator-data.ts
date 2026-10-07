import { sha256 } from "@noble/hashes/sha2.js";
import { Buffer } from "@craftzdog/react-native-buffer";

export const ES256_ALGORITHM_IDENTIFIER = -7;

const MAX_CREDENTIAL_ID_LENGTH = 1023;
const AAGUID = Uint8Array.of(
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

const FLAG = {
    USER_PRESENT: 1 << 0,
    USER_VERIFIED: 1 << 2,
    BACKUP_ELIGIBLE: 1 << 3,
    BACKED_UP: 1 << 4,
    ATTESTED_CREDENTIAL_DATA: 1 << 6,
} as const;

type CborValue =
    | number
    | string
    | Uint8Array
    | ReadonlyMap<CborValue, CborValue>;

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
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

function compareCborKeys(left: Uint8Array, right: Uint8Array): number {
    if (left.length !== right.length) return left.length - right.length;
    for (let index = 0; index < left.length; index += 1) {
        const difference = left[index]! - right[index]!;
        if (difference !== 0) return difference;
    }
    return 0;
}

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
        .map(([key, item]) => ({ key: encodeCbor(key), value: encodeCbor(item) }))
        .sort((left, right) => compareCborKeys(left.key, right.key));
    return concatBytes(
        encodeCborHead(5, entries.length),
        ...entries.flatMap(({ key, value: item }) => [key, item]),
    );
}

function decodeBase64Url(value: string): Uint8Array {
    const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
    return new Uint8Array(Buffer.from(base64, "base64"));
}

function encodePublicKey(publicKey: JsonWebKey): Uint8Array {
    if (!publicKey.x || !publicKey.y) {
        throw new Error("PASSKEY_PUBLIC_KEY_COORDINATES_MISSING");
    }

    const x = decodeBase64Url(publicKey.x);
    const y = decodeBase64Url(publicKey.y);
    if (x.length !== 32 || y.length !== 32) {
        throw new Error("PASSKEY_PUBLIC_KEY_COORDINATES_INVALID");
    }

    // Canonical COSE EC2 key: {1: 2, 3: -7, -1: 1, -2: x, -3: y}.
    return concatBytes(
        Uint8Array.of(
            0xa5,
            0x01,
            0x02,
            0x03,
            0x26,
            0x20,
            0x01,
            0x21,
            0x58,
            0x20,
        ),
        x,
        Uint8Array.of(0x22, 0x58, 0x20),
        y,
    );
}

function flags(userVerified: boolean, includesCredential: boolean): number {
    return (
        FLAG.USER_PRESENT |
        (userVerified ? FLAG.USER_VERIFIED : 0) |
        FLAG.BACKUP_ELIGIBLE |
        FLAG.BACKED_UP |
        (includesCredential ? FLAG.ATTESTED_CREDENTIAL_DATA : 0)
    );
}

async function rpIdHash(rpId: string): Promise<Uint8Array> {
    if (!rpId.trim()) throw new Error("PASSKEY_RP_ID_MISSING");
    return sha256(new TextEncoder().encode(rpId));
}

export async function buildAssertionAuthenticatorData(
    rpId: string,
    userVerified: boolean,
): Promise<Uint8Array> {
    return concatBytes(
        await rpIdHash(rpId),
        Uint8Array.of(flags(userVerified, false)),
        unsignedBigEndian(0, 4),
    );
}

export async function buildRegistrationAuthenticatorData(
    rpId: string,
    credentialId: Uint8Array,
    publicKey: JsonWebKey,
    userVerified: boolean,
): Promise<Uint8Array> {
    if (
        credentialId.length === 0 ||
        credentialId.length > MAX_CREDENTIAL_ID_LENGTH
    ) {
        throw new RangeError(
            `Credential ID length must be between 1 and ${MAX_CREDENTIAL_ID_LENGTH} bytes`,
        );
    }

    let hash: Uint8Array;
    try {
        hash = await rpIdHash(rpId);
    } catch {
        throw new Error("PASSKEY_RP_ID_HASH_FAILED");
    }

    let encodedPublicKey: Uint8Array;
    try {
        encodedPublicKey = encodePublicKey(publicKey);
    } catch (error) {
        if (
            error instanceof Error &&
            /^PASSKEY_[A-Z0-9_]+$/u.test(error.message)
        ) {
            throw error;
        }
        throw new Error("PASSKEY_PUBLIC_KEY_ENCODING_FAILED");
    }

    return concatBytes(
        hash,
        Uint8Array.of(flags(userVerified, true)),
        unsignedBigEndian(0, 4),
        AAGUID,
        unsignedBigEndian(credentialId.length, 2),
        credentialId,
        encodedPublicKey,
    );
}

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
