/**
 * Read-only SSH key helpers that only need the public key: descriptions,
 * fingerprints and public key lines. Kept apart from ./ssh-key so lists,
 * search and the security report don't load the elliptic-curve code.
 */
import { sha256 } from "@noble/hashes/sha2.js";

import { base64ToUint8, uint8ToBase64 } from "../encoding";
import { bitLength, SSHReader, SSHWireError } from "../internal/ssh/wire";
import type { SSHKeyData } from "../proto/vault";

export type SSHKeyAlgorithm =
    | "ssh-ed25519"
    | "ecdsa-sha2-nistp256"
    | "ecdsa-sha2-nistp384"
    | "ecdsa-sha2-nistp521"
    | "ssh-rsa";

export type SSHKeyInfo = {
    algorithm: SSHKeyAlgorithm;
    /** Key size in bits: 256 for Ed25519, the curve size for ECDSA. */
    bits: number;
    /** "Ed25519", "ECDSA P-256", "RSA 4096" and so on. */
    label: string;
    /** "SHA256:..." as printed by `ssh-keygen -l`. */
    fingerprint: string;
};

/** RSA keys below this size are flagged in the security report. */
export const WEAK_RSA_BITS = 3072;

// Shared with ./ssh-key and ./ssh-key-task. They live here so app code can use
// them without loading the key code.

/** Random bytes an encrypted export uses: a 4-byte check value and the salt. */
export const SSH_EXPORT_RANDOM_BYTES = 20;

/** Message for a key task that failed for a reason other than the key itself. */
export const SSH_KEY_TASK_INTERNAL_ERROR =
    "Something went wrong while reading this key. Try again.";

export const SSH_PUBLIC_KEY_INVALID_MESSAGE =
    "The public key isn't a valid SSH public key.";

const ECDSA_BITS = { nistp256: 256, nistp384: 384, nistp521: 521 } as const;

export const isECDSAAlgorithm = (
    type: string,
): type is Extract<SSHKeyAlgorithm, `ecdsa-${string}`> =>
    type === "ecdsa-sha2-nistp256" ||
    type === "ecdsa-sha2-nistp384" ||
    type === "ecdsa-sha2-nistp521";

export const curveOf = (algorithm: string) =>
    algorithm.slice("ecdsa-sha2-".length) as keyof typeof ECDSA_BITS;

/** "SHA256:..." as `ssh-keygen -l` prints it. */
export const sshFingerprint = (blob: Uint8Array): string =>
    `SHA256:${uint8ToBase64(sha256(blob)).replace(/=+$/, "")}`;

/** ssh-agent sign flags (draft-miller-ssh-agent, section 4.5.1). */
export const SSH_AGENT_RSA_SHA2_256 = 2;
export const SSH_AGENT_RSA_SHA2_512 = 4;

/** Describes an SSH wire-format public key blob; throws if unsupported. */
export const describeSSHPublicKeyBlob = (blob: Uint8Array): SSHKeyInfo => {
    const reader = new SSHReader(blob);
    const algorithm = reader.text();
    let bits: number;
    let label: string;
    if (algorithm === "ssh-ed25519") {
        if (reader.string().length !== 32) throw new SSHWireError("Bad key");
        bits = 256;
        label = "Ed25519";
    } else if (algorithm === "ssh-rsa") {
        reader.mpint();
        bits = bitLength(reader.mpint());
        label = `RSA ${bits}`;
    } else if (isECDSAAlgorithm(algorithm)) {
        const curve = reader.text();
        if (curve !== curveOf(algorithm)) throw new SSHWireError("Bad key");
        reader.string();
        bits = ECDSA_BITS[curveOf(algorithm)];
        label = `ECDSA P-${bits}`;
    } else {
        throw new SSHWireError("Unsupported key type");
    }
    if (reader.remaining !== 0) throw new SSHWireError("Trailing key data");
    return {
        algorithm: algorithm as SSHKeyAlgorithm,
        bits,
        label,
        fingerprint: sshFingerprint(blob),
    };
};

/** "<algorithm> <base64>" for a public key blob. */
export const sshPublicKeyText = (blob: Uint8Array): string =>
    `${new SSHReader(blob).text()} ${uint8ToBase64(blob)}`;

/** Algorithm, size and fingerprint of a stored key, or null if unreadable. */
export const describeSSHKey = (
    data: Pick<SSHKeyData, "PublicKey">,
): SSHKeyInfo | null => {
    const [, base64] = data.PublicKey.trim().split(/\s+/);
    if (!base64) return null;
    try {
        return describeSSHPublicKeyBlob(base64ToUint8(base64));
    } catch {
        return null;
    }
};

/**
 * A cheap structural check for stored key data. Full validation (that the
 * private half matches) lives in ./ssh-key and runs when keys are imported.
 */
export const hasSSHKeyShape = (data: SSHKeyData): boolean =>
    data.PrivateKey.includes("-----BEGIN OPENSSH PRIVATE KEY-----") &&
    describeSSHKey(data) !== null;

/** The authorized_keys line: "<algorithm> <base64> <comment>". */
export const sshPublicKeyLine = (
    data: Pick<SSHKeyData, "PublicKey" | "Comment">,
): string => `${data.PublicKey.trim()} ${data.Comment.trim()}`.trim();

export const isWeakSSHKey = (info: SSHKeyInfo): boolean =>
    info.algorithm === "ssh-rsa" && info.bits < WEAK_RSA_BITS;

/** A safe base file name for downloads, from the item name. */
export const sshKeyFileName = (name: string): string =>
    name
        .trim()
        .replace(/[^A-Za-z0-9._-]+/g, "_")
        .replace(/^[._]+|_+$/g, "") || "id_ssh_key";

const PUBLIC_KEY_PATTERN =
    /(^|\s)((?:ssh|ecdsa|sk)-[A-Za-z0-9@.-]+)\s+([A-Za-z0-9+/]+={0,2})(?:\s+(.*))?$/;

export type ParsedSSHPublicKey = {
    algorithm: string;
    blob: Uint8Array;
    comment: string;
};

/**
 * Reads an OpenSSH public key line such as the contents of id_ed25519.pub.
 * authorized_keys options before the key are ignored.
 */
export const parseSSHPublicKey = (text: string): ParsedSSHPublicKey | null => {
    const line = text
        .split(/\r?\n/)
        .map((entry) => entry.trim())
        .find((entry) => entry && !entry.startsWith("#"));
    const match = line ? PUBLIC_KEY_PATTERN.exec(line) : null;
    if (!match) return null;
    try {
        const blob = base64ToUint8(match[3]!);
        if (new SSHReader(blob).text() !== match[2]) return null;
        return {
            algorithm: match[2]!,
            blob,
            comment: (match[4] ?? "").trim(),
        };
    } catch {
        return null;
    }
};
