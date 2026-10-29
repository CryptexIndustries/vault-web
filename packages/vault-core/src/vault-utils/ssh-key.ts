/**
 * SSH key items: generation, import, validation and export.
 *
 * Every key is stored as an unencrypted `openssh-key-v1` private key inside the
 * encrypted vault, whatever format it was imported from. Imports accept OpenSSH
 * keys (plain or passphrase-protected), PKCS#1 and SEC1 PEM (plain or with the
 * legacy OpenSSL encryption headers), and PKCS#8 (plain or PBES2-encrypted).
 */
import { cbc, ctr, gcm } from "@noble/ciphers/aes.js";
import { ed25519 } from "@noble/curves/ed25519.js";
import { p256, p384, p521 } from "@noble/curves/nist.js";
import { md5, sha1 } from "@noble/hashes/legacy.js";
import { pbkdf2 } from "@noble/hashes/pbkdf2.js";
import { sha256, sha384, sha512 } from "@noble/hashes/sha2.js";
import type { CHash } from "@noble/hashes/utils.js";
import { err, ok, type Result } from "neverthrow";

import { base64ToUint8, uint8ToBase64 } from "../encoding";
import { bcryptPbkdf } from "../internal/ssh/bcrypt-pbkdf";
import {
    bitString,
    children,
    contextTag,
    DERError,
    integer,
    objectIdentifier,
    octetString,
    parseDER,
    sequence,
} from "../internal/ssh/der";
import {
    bigIntToBytes,
    bitLength,
    bytesEqual,
    bytesToBigInt,
    concatBytes,
    SSHReader,
    SSHWireError,
    SSHWriter,
} from "../internal/ssh/wire";
import type { SSHKeyData } from "../proto/vault";
import {
    curveOf,
    describeSSHPublicKeyBlob,
    isECDSAAlgorithm,
    parseSSHPublicKey,
    SSH_EXPORT_RANDOM_BYTES,
    SSH_PUBLIC_KEY_INVALID_MESSAGE,
    sshPublicKeyText,
    type SSHKeyAlgorithm,
    type SSHKeyInfo,
} from "./ssh-key-info";

export * from "./ssh-key-info";

//#region Types
export type SSHKeyErrorCode =
    | "empty"
    | "invalid"
    | "public-key-only"
    | "public-key-invalid"
    | "public-key-mismatch"
    | "passphrase-required"
    | "wrong-passphrase"
    | "unsupported-cipher"
    | "unsupported-key-type"
    | "dsa"
    | "rsa-too-small"
    | "security-key"
    | "putty"
    | "multiple-keys"
    | "kdf-too-expensive";

/** The values a parameterized message names, for clients that word it themselves. */
export type SSHKeyErrorParams = {
    /** The cipher, key type or OID the file names. */
    name?: string;
    /** Set instead of `name` when the message describes the scheme in words. */
    scheme?:
        | "legacy-pkcs8"
        | "non-pbkdf2-kdf"
        | "pbkdf2-hash"
        | "pkcs8-cipher"
        | "unknown-cipher"
        | "elliptic-curve";
    count?: number;
    max?: number;
    unit?: "rounds" | "iterations";
};

export class SSHKeyError extends Error {
    constructor(
        public readonly code: SSHKeyErrorCode,
        message: string,
        public readonly params?: SSHKeyErrorParams,
    ) {
        super(message);
        this.name = "SSHKeyError";
    }
}

/** OpenSSH refuses RSA keys below this size. */
const MIN_RSA_BITS = 1024;
/** bcrypt_pbkdf rounds for passphrase-protected downloads, as ssh-keygen. */
const EXPORT_KDF_ROUNDS = 16;
/**
 * Limits on the work factor a key file may ask for. The file sets it, so
 * without a limit a crafted key could keep a device busy for hours.
 * ssh-keygen defaults to 16 rounds and guides suggest up to 100.
 */
export const MAX_IMPORT_BCRYPT_ROUNDS = 1000;
/** OWASP suggests 1.3 million for PBKDF2-SHA1, the slowest common choice. */
export const MAX_IMPORT_PBKDF2_ITERATIONS = 2_000_000;

type ECDSACurveName = "nistp256" | "nistp384" | "nistp521";

type PrivateKeyMaterial =
    | { algorithm: "ssh-ed25519"; seed: Uint8Array; publicKey: Uint8Array }
    | {
          algorithm: Extract<SSHKeyAlgorithm, `ecdsa-${string}`>;
          curve: ECDSACurveName;
          q: Uint8Array;
          d: bigint;
      }
    | {
          algorithm: "ssh-rsa";
          n: bigint;
          e: bigint;
          d: bigint;
          iqmp: bigint;
          p: bigint;
          q: bigint;
      };
//#endregion Types

//#region Errors
const fail = (
    code: SSHKeyErrorCode,
    message: string,
    params?: SSHKeyErrorParams,
): never => {
    throw new SSHKeyError(code, message, params);
};

const messages = {
    empty: "Paste a private key or choose a key file.",
    invalid: "This doesn't look like an SSH private key.",
    publicKeyOnly:
        "This is a public key. Use the private key file instead, for example id_ed25519 rather than id_ed25519.pub.",
    publicKeyInvalid: SSH_PUBLIC_KEY_INVALID_MESSAGE,
    publicKeyMismatch: "The public key doesn't belong to this private key.",
    passphraseRequired:
        "This key is protected with a passphrase. Enter it to import the key.",
    wrongPassphrase: "The passphrase is incorrect.",
    dsa: "DSA keys aren't supported because OpenSSH no longer accepts them. Generate a new Ed25519 key instead.",
    rsaTooSmall:
        "This RSA key is shorter than 1024 bits, which OpenSSH refuses to use. Generate a new Ed25519 key instead.",
    securityKey:
        "This key needs a hardware security key to sign, so it can't be stored in the vault.",
    putty: "PuTTY key files aren't supported. In PuTTYgen, choose Conversions > Export OpenSSH key and import that file.",
    multipleKeys:
        "This file holds more than one key. Split it into one file per key.",
    unsupportedCipher: (cipher: string) =>
        `This key is encrypted with ${cipher}, which isn't supported. Re-encrypt it with "ssh-keygen -p -f <file>" and import it again.`,
    kdfTooExpensive: (count: number, max: number, unit: string) =>
        `This key's passphrase protection uses ${count.toLocaleString("en-US")} ${unit}, more than the ${max.toLocaleString("en-US")} Cryptex Vault accepts. Re-encrypt it with "ssh-keygen -p -a 100 -f <file>" and import it again.`,
    unsupportedKeyType: (type: string) =>
        `${type} keys aren't supported. Supported types are Ed25519, ECDSA and RSA.`,
};

const describeAlgorithmError = (type: string): never => {
    if (type === "ssh-dss") fail("dsa", messages.dsa);
    if (type.startsWith("sk-")) fail("security-key", messages.securityKey);
    return fail("unsupported-key-type", messages.unsupportedKeyType(type), {
        name: type,
    });
};
//#endregion Errors

//#region Algorithms
const CURVES = {
    nistp256: { curve: p256, size: 32, bits: 256 },
    nistp384: { curve: p384, size: 48, bits: 384 },
    nistp521: { curve: p521, size: 66, bits: 521 },
} as const;

const CURVE_OIDS: Record<string, ECDSACurveName> = {
    "1.2.840.10045.3.1.7": "nistp256",
    "1.3.132.0.34": "nistp384",
    "1.3.132.0.35": "nistp521",
};

const ecdsaAlgorithm = (curve: ECDSACurveName) =>
    `ecdsa-sha2-${curve}` as Extract<SSHKeyAlgorithm, `ecdsa-${string}`>;

const ecdsaPublicPoint = (curve: ECDSACurveName, d: bigint): Uint8Array => {
    const { curve: impl, size } = CURVES[curve];
    return impl.getPublicKey(bigIntToBytes(d, size), false);
};

const rsaChecks = (
    key: Extract<PrivateKeyMaterial, { algorithm: "ssh-rsa" }>,
) => {
    const { n, e, d, p, q, iqmp } = key;
    if (p * q !== n) return false;
    const gcd = (a: bigint, b: bigint): bigint =>
        b === 0n ? a : gcd(b, a % b);
    const lambda = ((p - 1n) * (q - 1n)) / gcd(p - 1n, q - 1n);
    return (e * d) % lambda === 1n && (iqmp * q) % p === 1n;
};

/** Checks that the private half matches the public half. */
const validateMaterial = (key: PrivateKeyMaterial): void => {
    switch (key.algorithm) {
        case "ssh-ed25519":
            if (
                key.seed.length !== 32 ||
                !bytesEqual(ed25519.getPublicKey(key.seed), key.publicKey)
            ) {
                fail("invalid", messages.invalid);
            }
            return;
        case "ssh-rsa":
            if (!rsaChecks(key)) fail("invalid", messages.invalid);
            if (bitLength(key.n) < MIN_RSA_BITS) {
                fail("rsa-too-small", messages.rsaTooSmall);
            }
            return;
        default: {
            let point: Uint8Array;
            try {
                point = ecdsaPublicPoint(key.curve, key.d);
            } catch {
                return fail("invalid", messages.invalid);
            }
            if (!bytesEqual(point, key.q)) fail("invalid", messages.invalid);
        }
    }
};

const publicBlob = (key: PrivateKeyMaterial): Uint8Array => {
    const writer = new SSHWriter().string(key.algorithm);
    switch (key.algorithm) {
        case "ssh-ed25519":
            return writer.string(key.publicKey).toBytes();
        case "ssh-rsa":
            return writer.mpint(key.e).mpint(key.n).toBytes();
        default:
            return writer.string(key.curve).string(key.q).toBytes();
    }
};

const writePrivateFields = (writer: SSHWriter, key: PrivateKeyMaterial) => {
    writer.string(key.algorithm);
    switch (key.algorithm) {
        case "ssh-ed25519":
            writer
                .string(key.publicKey)
                .string(concatBytes(key.seed, key.publicKey));
            return;
        case "ssh-rsa":
            writer
                .mpint(key.n)
                .mpint(key.e)
                .mpint(key.d)
                .mpint(key.iqmp)
                .mpint(key.p)
                .mpint(key.q);
            return;
        default:
            writer.string(key.curve).string(key.q).mpint(key.d);
    }
};

const readPrivateFields = (reader: SSHReader): PrivateKeyMaterial => {
    const type = reader.text();
    if (type === "ssh-ed25519") {
        const publicKey = reader.string();
        const secret = reader.string();
        if (publicKey.length !== 32 || secret.length !== 64) {
            fail("invalid", messages.invalid);
        }
        if (!bytesEqual(secret.subarray(32), publicKey)) {
            fail("invalid", messages.invalid);
        }
        return {
            algorithm: type,
            seed: secret.slice(0, 32),
            publicKey: publicKey.slice(),
        };
    }
    if (type === "ssh-rsa") {
        const n = reader.mpint();
        const e = reader.mpint();
        const d = reader.mpint();
        const iqmp = reader.mpint();
        const p = reader.mpint();
        const q = reader.mpint();
        return { algorithm: type, n, e, d, iqmp, p, q };
    }
    if (isECDSAAlgorithm(type)) {
        const curve = reader.text();
        if (curve !== curveOf(type)) fail("invalid", messages.invalid);
        return {
            algorithm: type,
            curve: curve as ECDSACurveName,
            q: reader.string().slice(),
            d: reader.mpint(),
        };
    }
    return describeAlgorithmError(type);
};

//#endregion Algorithms

//#region Armor
type Armor = {
    label: string;
    headers: Record<string, string>;
    body: Uint8Array;
};

const parseArmor = (text: string): Armor | null => {
    const match = /-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----/.exec(
        text,
    );
    if (!match) return null;
    const label = match[1]!;
    const lines = match[2]!.split(/\r?\n/).map((line) => line.trim());
    const headers: Record<string, string> = {};
    const bodyLines: string[] = [];
    for (const line of lines) {
        const header = /^([A-Za-z-]+):\s*(.*)$/.exec(line);
        if (header && bodyLines.length === 0) {
            headers[header[1]!] = header[2]!;
        } else if (line) {
            bodyLines.push(line);
        }
    }
    const base64 = bodyLines.join("").replace(/\s+/g, "");
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) return null;
    try {
        return { label, headers, body: base64ToUint8(base64) };
    } catch {
        return null;
    }
};

const armor = (label: string, body: Uint8Array): string => {
    const base64 = uint8ToBase64(body);
    const lines = base64.match(/.{1,70}/g) ?? [];
    return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----\n`;
};
//#endregion Armor

//#region OpenSSH format
const OPENSSH_MAGIC = new TextEncoder().encode("openssh-key-v1\0");

type OpenSSHCipher = {
    keyLength: number;
    ivLength: number;
    blockSize: number;
    tagLength: number;
    decrypt: (key: Uint8Array, iv: Uint8Array, data: Uint8Array) => Uint8Array;
};

const OPENSSH_CIPHERS: Record<string, OpenSSHCipher> = (() => {
    const ctrCipher = (keyLength: number): OpenSSHCipher => ({
        keyLength,
        ivLength: 16,
        blockSize: 16,
        tagLength: 0,
        decrypt: (key, iv, data) => ctr(key, iv).decrypt(data),
    });
    const cbcCipher = (keyLength: number): OpenSSHCipher => ({
        keyLength,
        ivLength: 16,
        blockSize: 16,
        tagLength: 0,
        decrypt: (key, iv, data) =>
            cbc(key, iv, { disablePadding: true }).decrypt(data),
    });
    const gcmCipher = (keyLength: number): OpenSSHCipher => ({
        keyLength,
        ivLength: 12,
        blockSize: 16,
        tagLength: 16,
        decrypt: (key, iv, data) => gcm(key, iv).decrypt(data),
    });
    return {
        "aes128-ctr": ctrCipher(16),
        "aes192-ctr": ctrCipher(24),
        "aes256-ctr": ctrCipher(32),
        "aes128-cbc": cbcCipher(16),
        "aes192-cbc": cbcCipher(24),
        "aes256-cbc": cbcCipher(32),
        "aes128-gcm@openssh.com": gcmCipher(16),
        "aes256-gcm@openssh.com": gcmCipher(32),
    };
})();

const parseOpenSSH = (
    body: Uint8Array,
    passphrase: string | undefined,
): { key: PrivateKeyMaterial; comment: string } => {
    if (!bytesEqual(body.subarray(0, OPENSSH_MAGIC.length), OPENSSH_MAGIC)) {
        fail("invalid", messages.invalid);
    }
    const reader = new SSHReader(body.subarray(OPENSSH_MAGIC.length));
    const cipherName = reader.text();
    const kdfName = reader.text();
    const kdfOptions = reader.string();
    if (reader.uint32() !== 1) fail("multiple-keys", messages.multipleKeys);
    const declaredBlob = reader.string();
    // Report unusable key types before asking for a passphrase.
    describeAlgorithmIfUnsupported(declaredBlob);

    const encryptedLength = reader.uint32();
    let section: Uint8Array;
    const encrypted = cipherName !== "none";
    if (!encrypted) {
        section = reader.bytes(encryptedLength);
    } else {
        const cipher = OPENSSH_CIPHERS[cipherName];
        if (!cipher || kdfName !== "bcrypt") {
            return fail(
                "unsupported-cipher",
                messages.unsupportedCipher(cipherName),
                { name: cipherName },
            );
        }
        const ciphertext = reader.bytes(encryptedLength + cipher.tagLength);
        if (!passphrase) {
            return fail("passphrase-required", messages.passphraseRequired);
        }
        const options = new SSHReader(kdfOptions);
        const salt = options.string();
        const rounds = options.uint32();
        if (rounds > MAX_IMPORT_BCRYPT_ROUNDS) {
            fail(
                "kdf-too-expensive",
                messages.kdfTooExpensive(
                    rounds,
                    MAX_IMPORT_BCRYPT_ROUNDS,
                    "rounds",
                ),
                {
                    count: rounds,
                    max: MAX_IMPORT_BCRYPT_ROUNDS,
                    unit: "rounds",
                },
            );
        }
        const derived = bcryptPbkdf(
            new TextEncoder().encode(passphrase),
            salt,
            cipher.keyLength + cipher.ivLength,
            rounds,
        );
        try {
            section = cipher.decrypt(
                derived.subarray(0, cipher.keyLength),
                derived.subarray(cipher.keyLength),
                ciphertext,
            );
        } catch {
            return fail("wrong-passphrase", messages.wrongPassphrase);
        }
    }

    const inner = new SSHReader(section);
    if (inner.uint32() !== inner.uint32()) {
        fail(
            encrypted ? "wrong-passphrase" : "invalid",
            encrypted ? messages.wrongPassphrase : messages.invalid,
        );
    }
    const key = readPrivateFields(inner);
    const comment = inner.text();
    const padding = inner.rest();
    if (!padding.every((byte, index) => byte === index + 1)) {
        fail("invalid", messages.invalid);
    }
    if (!bytesEqual(publicBlob(key), declaredBlob)) {
        fail("invalid", messages.invalid);
    }
    return { key, comment };
};

const describeAlgorithmIfUnsupported = (blob: Uint8Array) => {
    const type = new SSHReader(blob).text();
    if (
        type !== "ssh-ed25519" &&
        type !== "ssh-rsa" &&
        !isECDSAAlgorithm(type)
    ) {
        describeAlgorithmError(type);
    }
};

const checkIntFor = (key: PrivateKeyMaterial): number => {
    // Check integers only detect a wrong passphrase. A value derived from the
    // public key keeps unencrypted output stable for the same key.
    const digest = sha256(publicBlob(key));
    return new DataView(digest.buffer, digest.byteOffset).getUint32(0);
};

const encodeOpenSSH = (
    key: PrivateKeyMaterial,
    comment: string,
    passphrase?: string,
    randomInput?: Uint8Array,
): string => {
    // Only encryption needs random bytes, so plain encoding (imports, stored
    // keys) works in runtimes without crypto.getRandomValues.
    const random = passphrase
        ? (randomInput ??
          crypto.getRandomValues(new Uint8Array(SSH_EXPORT_RANDOM_BYTES)))
        : undefined;
    if (random && random.length !== SSH_EXPORT_RANDOM_BYTES) {
        throw new Error(`Expected ${SSH_EXPORT_RANDOM_BYTES} random bytes`);
    }
    const blockSize = random ? 16 : 8;
    const check = random
        ? new DataView(random.buffer, random.byteOffset, 4).getUint32(0)
        : checkIntFor(key);
    const section = new SSHWriter().uint32(check).uint32(check);
    writePrivateFields(section, key);
    section.string(comment);
    let plain = section.toBytes();
    const padLength = (blockSize - (plain.length % blockSize)) % blockSize;
    plain = concatBytes(
        plain,
        Uint8Array.from({ length: padLength }, (_, i) => i + 1),
    );

    const out = new SSHWriter().raw(OPENSSH_MAGIC);
    if (passphrase && random) {
        const salt = random.slice(4);
        const derived = bcryptPbkdf(
            new TextEncoder().encode(passphrase),
            salt,
            48,
            EXPORT_KDF_ROUNDS,
        );
        const encrypted = ctr(
            derived.subarray(0, 32),
            derived.subarray(32),
        ).encrypt(plain);
        out.string("aes256-ctr")
            .string("bcrypt")
            .string(
                new SSHWriter()
                    .string(salt)
                    .uint32(EXPORT_KDF_ROUNDS)
                    .toBytes(),
            )
            .uint32(1)
            .string(publicBlob(key))
            .string(encrypted);
    } else {
        out.string("none")
            .string("none")
            .string("")
            .uint32(1)
            .string(publicBlob(key))
            .string(plain);
    }
    return armor("OPENSSH PRIVATE KEY", out.toBytes());
};
//#endregion OpenSSH format

//#region PEM formats
const OID = {
    rsaEncryption: "1.2.840.113549.1.1.1",
    ecPublicKey: "1.2.840.10045.2.1",
    ed25519: "1.3.101.112",
    dsa: "1.2.840.10040.4.1",
    pbes2: "1.2.840.113549.1.5.13",
    pbkdf2: "1.2.840.113549.1.5.12",
    hmacWithSHA1: "1.2.840.113549.2.7",
    hmacWithSHA256: "1.2.840.113549.2.9",
    hmacWithSHA384: "1.2.840.113549.2.10",
    hmacWithSHA512: "1.2.840.113549.2.11",
    aes128CBC: "2.16.840.1.101.3.4.1.2",
    aes192CBC: "2.16.840.1.101.3.4.1.22",
    aes256CBC: "2.16.840.1.101.3.4.1.42",
} as const;

const parsePKCS1 = (der: Uint8Array): PrivateKeyMaterial => {
    const fields = sequence(parseDER(der));
    const [, n, e, d, p, q, , , iqmp] = fields.map((node, index) =>
        index === 0 ? 0n : integer(node),
    );
    if (fields.length < 9 || integer(fields[0]) !== 0n) {
        return fail("invalid", messages.invalid);
    }
    return {
        algorithm: "ssh-rsa",
        n: n!,
        e: e!,
        d: d!,
        p: p!,
        q: q!,
        iqmp: iqmp!,
    };
};

const parseSEC1 = (
    der: Uint8Array,
    curveFromParams?: ECDSACurveName,
): PrivateKeyMaterial => {
    const fields = sequence(parseDER(der));
    if (integer(fields[0]) !== 1n) fail("invalid", messages.invalid);
    const d = octetString(fields[1]);
    let curve = curveFromParams;
    let q: Uint8Array | undefined;
    for (const field of fields.slice(2)) {
        if (field.tag === contextTag(0)) {
            curve = CURVE_OIDS[objectIdentifier(children(field)[0])];
        } else if (field.tag === contextTag(1)) {
            q = bitString(children(field)[0]).slice();
        }
    }
    if (!curve) {
        return fail(
            "unsupported-key-type",
            messages.unsupportedKeyType("This elliptic curve"),
            { scheme: "elliptic-curve" },
        );
    }
    const dValue = bytesToBigInt(d);
    return {
        algorithm: ecdsaAlgorithm(curve),
        curve,
        d: dValue,
        q: q ?? ecdsaPublicPoint(curve, dValue),
    };
};

const parsePKCS8 = (der: Uint8Array): PrivateKeyMaterial => {
    const fields = sequence(parseDER(der));
    const algorithm = sequence(fields[1]);
    const oid = objectIdentifier(algorithm[0]);
    const privateKey = octetString(fields[2]);
    if (oid === OID.rsaEncryption) return parsePKCS1(privateKey);
    if (oid === OID.ecPublicKey) {
        const curve = CURVE_OIDS[objectIdentifier(algorithm[1])];
        if (!curve) {
            return fail(
                "unsupported-key-type",
                messages.unsupportedKeyType("This elliptic curve"),
                { scheme: "elliptic-curve" },
            );
        }
        return parseSEC1(privateKey, curve);
    }
    if (oid === OID.ed25519) {
        const seed = octetString(parseDER(privateKey)).slice();
        if (seed.length !== 32) fail("invalid", messages.invalid);
        return {
            algorithm: "ssh-ed25519",
            seed,
            publicKey: ed25519.getPublicKey(seed),
        };
    }
    if (oid === OID.dsa) return fail("dsa", messages.dsa);
    return fail("unsupported-key-type", messages.unsupportedKeyType(oid), {
        name: oid,
    });
};

const PBKDF2_HASHES: Record<string, CHash> = {
    [OID.hmacWithSHA1]: sha1,
    [OID.hmacWithSHA256]: sha256,
    [OID.hmacWithSHA384]: sha384,
    [OID.hmacWithSHA512]: sha512,
};

const PBES2_CIPHERS: Record<string, number> = {
    [OID.aes128CBC]: 16,
    [OID.aes192CBC]: 24,
    [OID.aes256CBC]: 32,
};

const decryptPKCS8 = (der: Uint8Array, passphrase: string): Uint8Array => {
    const fields = sequence(parseDER(der));
    const scheme = sequence(fields[0]);
    if (objectIdentifier(scheme[0]) !== OID.pbes2) {
        return fail(
            "unsupported-cipher",
            messages.unsupportedCipher("a legacy PKCS#8 scheme"),
            { scheme: "legacy-pkcs8" },
        );
    }
    const [kdf, encryption] = sequence(scheme[1]);
    const kdfFields = sequence(kdf);
    if (objectIdentifier(kdfFields[0]) !== OID.pbkdf2) {
        return fail(
            "unsupported-cipher",
            messages.unsupportedCipher("a key derivation other than PBKDF2"),
            { scheme: "non-pbkdf2-kdf" },
        );
    }
    const params = sequence(kdfFields[1]);
    const salt = octetString(params[0]);
    const iterations = Number(integer(params[1]));
    if (iterations > MAX_IMPORT_PBKDF2_ITERATIONS) {
        fail(
            "kdf-too-expensive",
            messages.kdfTooExpensive(
                iterations,
                MAX_IMPORT_PBKDF2_ITERATIONS,
                "iterations",
            ),
            {
                count: iterations,
                max: MAX_IMPORT_PBKDF2_ITERATIONS,
                unit: "iterations",
            },
        );
    }
    let hash: CHash = sha1;
    for (const param of params.slice(2)) {
        if (param.tag === 0x30) {
            const prf = PBKDF2_HASHES[objectIdentifier(sequence(param)[0])];
            if (!prf) {
                return fail(
                    "unsupported-cipher",
                    messages.unsupportedCipher("this PBKDF2 hash"),
                    { scheme: "pbkdf2-hash" },
                );
            }
            hash = prf;
        }
    }
    const encryptionFields = sequence(encryption);
    const cipherOid = objectIdentifier(encryptionFields[0]);
    const keyLength = PBES2_CIPHERS[cipherOid];
    if (!keyLength) {
        return fail(
            "unsupported-cipher",
            messages.unsupportedCipher("this PKCS#8 cipher"),
            { scheme: "pkcs8-cipher" },
        );
    }
    const iv = octetString(encryptionFields[1]);
    const key = pbkdf2(hash, new TextEncoder().encode(passphrase), salt, {
        c: iterations,
        dkLen: keyLength,
    });
    return decryptCBCOrWrongPassphrase(key, iv, octetString(fields[1]));
};

const decryptCBCOrWrongPassphrase = (
    key: Uint8Array,
    iv: Uint8Array,
    data: Uint8Array,
): Uint8Array => {
    try {
        return cbc(key, iv).decrypt(data);
    } catch {
        return fail("wrong-passphrase", messages.wrongPassphrase);
    }
};

/** OpenSSL's EVP_BytesToKey with MD5 and one iteration. */
const legacyPemKey = (
    passphrase: string,
    salt: Uint8Array,
    length: number,
): Uint8Array => {
    const password = new TextEncoder().encode(passphrase);
    let out: Uint8Array = new Uint8Array(0);
    let previous: Uint8Array = new Uint8Array(0);
    while (out.length < length) {
        previous = md5(concatBytes(previous, password, salt));
        out = concatBytes(out, previous);
    }
    return out.slice(0, length);
};

const LEGACY_PEM_CIPHERS: Record<string, number> = {
    "AES-128-CBC": 16,
    "AES-192-CBC": 24,
    "AES-256-CBC": 32,
};

const decryptLegacyPem = (pem: Armor, passphrase: string): Uint8Array => {
    const [cipherName = "", ivHex = ""] = (pem.headers["DEK-Info"] ?? "").split(
        ",",
    );
    const keyLength = LEGACY_PEM_CIPHERS[cipherName.trim().toUpperCase()];
    if (!keyLength || !/^[0-9a-fA-F]{32}$/.test(ivHex.trim())) {
        return fail(
            "unsupported-cipher",
            messages.unsupportedCipher(
                cipherName.trim() || "an unknown cipher",
            ),
            cipherName.trim()
                ? { name: cipherName.trim() }
                : { scheme: "unknown-cipher" },
        );
    }
    const iv = Uint8Array.from(
        ivHex
            .trim()
            .match(/../g)!
            .map((hex) => parseInt(hex, 16)),
    );
    const key = legacyPemKey(passphrase, iv.subarray(0, 8), keyLength);
    return decryptCBCOrWrongPassphrase(key, iv, pem.body);
};

/** Runs a parser on decrypted bytes, where garbage means a wrong passphrase. */
const parseDecrypted = <T>(parse: () => T): T => {
    try {
        return parse();
    } catch (error) {
        if (error instanceof SSHKeyError && error.code !== "invalid") {
            throw error;
        }
        return fail("wrong-passphrase", messages.wrongPassphrase);
    }
};

const parsePem = (
    pem: Armor,
    passphrase: string | undefined,
): PrivateKeyMaterial => {
    const legacyEncrypted = /ENCRYPTED/i.test(pem.headers["Proc-Type"] ?? "");
    const needsPassphrase =
        legacyEncrypted || pem.label === "ENCRYPTED PRIVATE KEY";
    if (needsPassphrase && !passphrase) {
        return fail("passphrase-required", messages.passphraseRequired);
    }
    switch (pem.label) {
        case "RSA PRIVATE KEY":
            return legacyEncrypted
                ? parseDecrypted(() =>
                      parsePKCS1(decryptLegacyPem(pem, passphrase!)),
                  )
                : parsePKCS1(pem.body);
        case "EC PRIVATE KEY":
            return legacyEncrypted
                ? parseDecrypted(() =>
                      parseSEC1(decryptLegacyPem(pem, passphrase!)),
                  )
                : parseSEC1(pem.body);
        case "PRIVATE KEY":
            return parsePKCS8(pem.body);
        case "ENCRYPTED PRIVATE KEY": {
            const decrypted = decryptPKCS8(pem.body, passphrase!);
            return parseDecrypted(() => parsePKCS8(decrypted));
        }
        case "DSA PRIVATE KEY":
            return fail("dsa", messages.dsa);
        default:
            return fail("invalid", messages.invalid);
    }
};
//#endregion PEM formats

//#region Public API
export type ImportSSHKeyOptions = {
    /** Passphrase for an encrypted key. */
    passphrase?: string;
    /** Contents of the matching .pub file, used for its comment and checked. */
    publicKey?: string;
};

const toResult = <T>(run: () => T): Result<T, SSHKeyError> => {
    try {
        return ok(run());
    } catch (error) {
        if (error instanceof SSHKeyError) return err(error);
        if (error instanceof DERError || error instanceof SSHWireError) {
            return err(new SSHKeyError("invalid", messages.invalid));
        }
        throw error;
    }
};

const parsePrivateKey = (
    text: string,
    passphrase: string | undefined,
): { key: PrivateKeyMaterial; comment: string } => {
    const trimmed = text.trim();
    if (!trimmed) fail("empty", messages.empty);
    if (trimmed.startsWith("PuTTY-User-Key-File-")) {
        fail("putty", messages.putty);
    }
    if (parseSSHPublicKey(trimmed) || /BEGIN SSH2 PUBLIC KEY/.test(trimmed)) {
        fail("public-key-only", messages.publicKeyOnly);
    }
    const pem = parseArmor(trimmed);
    if (!pem) return fail("invalid", messages.invalid);
    if (pem.label === "PUBLIC KEY") {
        return fail("public-key-only", messages.publicKeyOnly);
    }
    if (pem.label === "OPENSSH PRIVATE KEY") {
        return parseOpenSSH(pem.body, passphrase);
    }
    return { key: parsePem(pem, passphrase), comment: "" };
};

/**
 * Imports a private key in any supported format and returns it in the stored
 * form. The comment comes from the key file, then the .pub file if given.
 */
export const importSSHPrivateKey = async (
    text: string,
    options: ImportSSHKeyOptions = {},
): Promise<Result<SSHKeyData, SSHKeyError>> =>
    importSSHPrivateKeySync(text, options);

/**
 * Synchronous form of {@link importSSHPrivateKey}. Encrypted keys run
 * bcrypt_pbkdf or PBKDF2 for seconds, so call it from a worker, see
 * `runSSHKeyTask`.
 */
export const importSSHPrivateKeySync = (
    text: string,
    options: ImportSSHKeyOptions = {},
): Result<SSHKeyData, SSHKeyError> =>
    toResult(() => {
        const { key, comment } = parsePrivateKey(text, options.passphrase);
        validateMaterial(key);
        let finalComment = comment;
        if (options.publicKey?.trim()) {
            const pub = parseSSHPublicKey(options.publicKey);
            if (!pub) fail("public-key-invalid", messages.publicKeyInvalid);
            if (!bytesEqual(pub!.blob, publicBlob(key))) {
                fail("public-key-mismatch", messages.publicKeyMismatch);
            }
            finalComment ||= pub!.comment;
        }
        return storedData(key, finalComment);
    });

const storedData = (key: PrivateKeyMaterial, comment: string): SSHKeyData => ({
    PrivateKey: encodeOpenSSH(key, comment),
    PublicKey: sshPublicKeyText(publicBlob(key)),
    Comment: comment,
});

/** Private key material, for signing in ssh-sign.ts. */
export type SSHPrivateKeyMaterial = PrivateKeyMaterial;

/**
 * Reads a stored key (an unencrypted OpenSSH file) for signing, with its
 * public key blob so callers can check it is the key a request names.
 */
export const readStoredSSHPrivateKey = (
    data: SSHKeyData,
): { key: SSHPrivateKeyMaterial; publicBlob: Uint8Array } => {
    const { key } = parsePrivateKey(data.PrivateKey, undefined);
    validateMaterial(key);
    return { key, publicBlob: publicBlob(key) };
};

/** Generates a new Ed25519 key. */
export const generateSSHKey = (comment: string): SSHKeyData => {
    const seed = ed25519.utils.randomSecretKey();
    return storedData(
        {
            algorithm: "ssh-ed25519",
            seed,
            publicKey: ed25519.getPublicKey(seed),
        },
        comment.trim(),
    );
};

/**
 * The private key as an OpenSSH file carrying the current comment. With a
 * passphrase it is encrypted like ssh-keygen does (aes256-ctr, bcrypt).
 */
export const exportSSHPrivateKey = (
    data: SSHKeyData,
    passphrase?: string,
    /**
     * {@link SSH_EXPORT_RANDOM_BYTES} bytes from a secure source, for runtimes
     * without crypto.getRandomValues. Defaults to crypto.getRandomValues.
     */
    random?: Uint8Array,
): string => {
    const { key } = parseOpenSSH(
        parseArmor(data.PrivateKey)?.body ?? new Uint8Array(),
        undefined,
    );
    return encodeOpenSSH(
        key,
        data.Comment.trim(),
        passphrase || undefined,
        random,
    );
};

/** Checks stored key data: a readable key whose public half matches. */
export const validateSSHKeyData = (
    data: SSHKeyData,
): Result<SSHKeyInfo, SSHKeyError> =>
    toResult(() => {
        const pem = parseArmor(data.PrivateKey);
        if (pem?.label !== "OPENSSH PRIVATE KEY") {
            fail("invalid", messages.invalid);
        }
        const { key } = parseOpenSSH(pem!.body, undefined);
        validateMaterial(key);
        const blob = publicBlob(key);
        if (sshPublicKeyText(blob) !== data.PublicKey.trim()) {
            fail("public-key-mismatch", messages.publicKeyMismatch);
        }
        return describeSSHPublicKeyBlob(blob);
    });

//#endregion Public API
