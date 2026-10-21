import { ed25519 } from "@noble/curves/ed25519.js";
import { p256, p384, p521 } from "@noble/curves/nist.js";
import { sha1 } from "@noble/hashes/legacy.js";
import { sha256, sha384, sha512 } from "@noble/hashes/sha2.js";
import {
    bigIntToBytes,
    bitLength,
    bytesEqual,
    bytesToBigInt,
    SSHReader,
    SSHWriter,
} from "../internal/ssh/wire";
import type { SessionBind, SignRequest } from "../proto/agent";
import {
    SSH_AGENT_RSA_SHA2_256,
    SSH_AGENT_RSA_SHA2_512,
    sshFingerprint,
} from "../vault-utils/ssh-key-info";
import type { RequestCheck } from "./approver-types";

/**
 * The checks an approver makes before it shows a sign request. A port of
 * classify in services/internal/agent/approvertest/signdata.go and
 * VerifySessionBind in services/internal/agentproto/sessionbind.go; the
 * vectors in services/internal/agent/approvertest/testdata keep them in step.
 */

/** The request lies about itself; answer REFUSAL_REASON_INVALID. */
export class InvalidRequestError extends Error {}

// Caps for strings the agent machine controls. NAME_LENGTH matches termsafe.
export const NAME_LENGTH = 64;
export const HOST_NAME_LENGTH = 255;
/** known_hosts names kept per host key; a flood of them helps nobody. */
export const MAX_HOST_NAMES = 16;

const MSG_USERAUTH_REQUEST = 50;
const SSHSIG_MAGIC = new TextEncoder().encode("SSHSIG");
const HOSTBOUND_METHOD = "publickey-hostbound-v00@openssh.com";

/**
 * Makes a string from the agent machine safe to show in the apps: C0 and
 * C1 controls, DEL, bidi controls, line separators, lone surrogates and
 * invisible characters (format characters such as zero-width spaces, the
 * tag block, soft hyphens, variation selectors) become U+FFFD, and long
 * text is cut to limit characters ending in "...". termsafe.String in the
 * Go agent does the first part, which is enough for terminals; a GUI shows
 * the invisible ones as nothing at all.
 */
export function sanitizeDisplayText(text: string, limit = NAME_LENGTH): string {
    const out: string[] = [];
    for (const ch of text) {
        if (out.length === limit) {
            return out.slice(0, Math.max(0, limit - 3)).join("") + "...";
        }
        const c = ch.codePointAt(0)!;
        out.push(unsafeCodePoint(c) || invisibleCodePoint(c) ? "\uFFFD" : ch);
    }
    return out.join("");
}

/**
 * The text had characters sanitizeDisplayText replaces (or already shows
 * U+FFFD for them), so screens can say "contains hidden characters". Works
 * on raw and on sanitized text.
 */
export function hasHiddenCharacters(text: string): boolean {
    for (const ch of text) {
        const c = ch.codePointAt(0)!;
        if (c === 0xfffd || unsafeCodePoint(c) || invisibleCodePoint(c))
            return true;
    }
    return false;
}

function unsafeCodePoint(c: number): boolean {
    return (
        c < 0x20 ||
        c === 0x7f ||
        (c >= 0x80 && c <= 0x9f) ||
        (c >= 0x202a && c <= 0x202e) ||
        (c >= 0x2066 && c <= 0x2069) ||
        c === 0x200e ||
        c === 0x200f ||
        c === 0x061c ||
        c === 0x2028 ||
        c === 0x2029 ||
        // Lone surrogates, the UTF-16 form of invalid UTF-8.
        (c >= 0xd800 && c <= 0xdfff)
    );
}

/**
 * Unicode category Cf (format), the tag block, interlinear annotation
 * marks and variation selectors: characters a GUI draws as nothing. Listed
 * out rather than matched with \p{Cf}, which not every JS engine the apps
 * run on supports.
 */
const INVISIBLE_RANGES: readonly (readonly [number, number])[] = [
    [0x00ad, 0x00ad],
    [0x0600, 0x0605],
    [0x061c, 0x061c],
    [0x06dd, 0x06dd],
    [0x070f, 0x070f],
    [0x0890, 0x0891],
    [0x08e2, 0x08e2],
    [0x180b, 0x180f],
    [0x200b, 0x200f],
    [0x202a, 0x202e],
    [0x2060, 0x2064],
    [0x2066, 0x206f],
    [0xfe00, 0xfe0f],
    [0xfeff, 0xfeff],
    [0xfff9, 0xfffb],
    [0x110bd, 0x110bd],
    [0x110cd, 0x110cd],
    [0x13430, 0x1343f],
    [0x1bca0, 0x1bca3],
    [0x1d173, 0x1d17a],
    [0xe0000, 0xe007f],
    [0xe0100, 0xe01ef],
];

function invisibleCodePoint(c: number): boolean {
    if (c < 0xad) return false;
    return INVISIBLE_RANGES.some(([low, high]) => c >= low && c <= high);
}

// ignoreBOM: the default decoder drops a leading U+FEFF, so "\uFEFFgit"
// would read as "git" while the signed bytes say otherwise. Go keeps it.
const decoder = new TextDecoder("utf-8", { ignoreBOM: true });
const text = (bytes: Uint8Array) => decoder.decode(bytes);
const GIT_NAMESPACE = new TextEncoder().encode("git");

/**
 * Verifies the session-binds and works out what the request signs. Throws
 * InvalidRequestError exactly where the Go approver refuses INVALID, except
 * that data that is neither a login nor SSHSIG comes back as kind "other"
 * for the caller to refuse or warn about.
 */
export function checkSignRequest(request: SignRequest): RequestCheck {
    const binds = request.sessionBinds;
    const hosts = binds.map((bind) => verifySessionBind(bind));
    const data = request.data;

    if (startsWith(data, SSHSIG_MAGIC)) {
        const namespace = parseSSHSig(data.subarray(SSHSIG_MAGIC.length));
        // Policy (titles, remembered git approvals) reads namespace "git"
        // only when the signed bytes are exactly ASCII "git"; anything else
        // is shown sanitized, so a lookalike can't pass for it.
        const display = sanitizeDisplayText(text(namespace));
        return {
            kind: "signature",
            namespace:
                display === "git" && !bytesEqual(namespace, GIT_NAMESPACE)
                    ? "\uFFFDgit"
                    : display,
            forwardedVia: hosts,
            destinationUnknown: false,
        };
    }

    const login = parseUserauth(data);
    if (!login) {
        return {
            kind: "other",
            forwardedVia: hosts,
            destinationUnknown: false,
        };
    }
    if (!bytesEqual(login.key, request.publicKey)) {
        throw new InvalidRequestError(
            "The signed data names a different key than the request",
        );
    }
    const user = sanitizeDisplayText(login.user);
    const algorithm = sanitizeDisplayText(login.algorithm);
    const last = binds[binds.length - 1];
    if (!last || last.forwarding) {
        // No bind (OpenSSH before 8.9, Paramiko, libssh2, Go clients), or
        // the last hop forwarded the agent without binding its own login:
        // nothing says where this login goes.
        return {
            kind: "login",
            user,
            forwardedVia: hosts,
            destinationUnknown: true,
            algorithm,
        };
    }
    if (!bytesEqual(login.sessionId, last.sessionId)) {
        throw new InvalidRequestError(
            "The login is for another session than the one ssh bound",
        );
    }
    if (login.hostKey && !bytesEqual(login.hostKey, last.hostKey)) {
        throw new InvalidRequestError(
            "The login names another server key than the one ssh bound",
        );
    }
    const host = hosts[hosts.length - 1]!;
    return {
        kind: "login",
        user,
        verifiedHost: {
            hostKey: last.hostKey,
            fingerprint: host.fingerprint,
            names: host.names,
        },
        forwardedVia: hosts.slice(0, -1),
        destinationUnknown: false,
        algorithm,
    };
}

/**
 * An RSA request that would come out as an ssh-rsa (SHA-1) signature, or as
 * another hash than the login names. OpenSSH refuses SHA-1 for SSHSIG and
 * modern servers refuse it for logins, so such a signature only helps a
 * chosen-prefix collision. Not in the Go reference, which signs whatever
 * the flags say.
 */
export function weakRsaRequest(
    request: Pick<SignRequest, "publicKey" | "flags">,
    check: Pick<RequestCheck, "kind" | "algorithm">,
): boolean {
    const keyType = tryRead(() =>
        text(new SSHReader(request.publicKey).string()),
    );
    if (keyType !== "ssh-rsa" && keyType !== `ssh-rsa${CERT_SUFFIX}`)
        return false;
    const flag256 = (request.flags & SSH_AGENT_RSA_SHA2_256) !== 0;
    const flag512 = (request.flags & SSH_AGENT_RSA_SHA2_512) !== 0;
    if (check.kind === "signature") return !flag256 && !flag512;
    if (check.kind === "login") {
        const algorithm = check.algorithm ?? "";
        if (algorithm.startsWith("rsa-sha2-256")) return !flag256 || flag512;
        if (algorithm.startsWith("rsa-sha2-512")) return !flag512;
    }
    return false;
}

type VerifiedHost = { fingerprint: string; names: string[] };

function startsWith(data: Uint8Array, prefix: Uint8Array): boolean {
    return (
        data.length >= prefix.length &&
        bytesEqual(data.subarray(0, prefix.length), prefix)
    );
}

/** Reads SSH wire data, returning null instead of throwing at the end. */
function tryRead<T>(read: () => T): T | null {
    try {
        return read();
    } catch {
        return null;
    }
}

/** The namespace bytes, as signed. */
function parseSSHSig(rest: Uint8Array): Uint8Array {
    const parsed = tryRead(() => {
        const r = new SSHReader(rest);
        const namespace = r.string();
        r.string(); // reserved
        const hash = text(r.string());
        r.string(); // H(message)
        return { namespace, hash, done: r.remaining === 0 };
    });
    if (
        !parsed ||
        !parsed.done ||
        parsed.namespace.length === 0 ||
        (parsed.hash !== "sha256" && parsed.hash !== "sha512")
    ) {
        throw new InvalidRequestError("Malformed SSHSIG data");
    }
    return parsed.namespace;
}

type Userauth = {
    sessionId: Uint8Array;
    user: string;
    algorithm: string;
    key: Uint8Array;
    hostKey?: Uint8Array;
};

/** null when the data isn't a userauth request at all. */
function parseUserauth(data: Uint8Array): Userauth | null {
    const r = new SSHReader(data);
    const head = tryRead(() => ({
        sessionId: r.string(),
        type: r.bytes(1)[0],
    }));
    if (!head || head.type !== MSG_USERAUTH_REQUEST) return null;
    const body = tryRead(() => {
        const user = r.string();
        r.string(); // service
        const method = text(r.string());
        const hasSig = r.bytes(1)[0];
        const algorithm = text(r.string());
        const key = r.string();
        const hostKey = method === HOSTBOUND_METHOD ? r.string() : undefined;
        return { user, method, hasSig, algorithm, key, hostKey };
    });
    if (
        !body ||
        r.remaining !== 0 ||
        (body.method !== "publickey" && body.method !== HOSTBOUND_METHOD) ||
        body.hasSig !== 1
    ) {
        throw new InvalidRequestError("Malformed userauth data");
    }
    return {
        sessionId: head.sessionId,
        user: text(body.user),
        algorithm: body.algorithm,
        key: body.key,
        hostKey: body.hostKey,
    };
}

// ---------------------------------------------------------------------------
// Session-bind verification

/**
 * Checks that the bind's host key signed its session ID, and returns the
 * key's fingerprint and the names the machine reported for it.
 */
export function verifySessionBind(bind: SessionBind): VerifiedHost {
    let key: HostKey;
    try {
        key = parsePublicKey(bind.hostKey);
    } catch {
        throw new InvalidRequestError("Unreadable session-bind host key");
    }
    const sig = tryRead(() => {
        const r = new SSHReader(bind.signature);
        // Anything after the blob is ignored, as ssh.Unmarshal does into
        // ssh.Signature (its Rest field).
        return { format: text(r.string()), blob: r.string() };
    });
    if (!sig || !verifySignature(key, bind.sessionId, sig.format, sig.blob)) {
        throw new InvalidRequestError("A session-bind doesn't verify");
    }
    return {
        fingerprint: sshFingerprint(marshalPlainKey(key)),
        names: (bind.hostNames ?? [])
            .slice(0, MAX_HOST_NAMES)
            .map((name) => sanitizeDisplayText(name, HOST_NAME_LENGTH)),
    };
}

const ECDSA_CURVES = {
    nistp256: { curve: p256, size: 32, hash: sha256 },
    nistp384: { curve: p384, size: 48, hash: sha384 },
    nistp521: { curve: p521, size: 66, hash: sha512 },
} as const;
type CurveName = keyof typeof ECDSA_CURVES;

type HostKey =
    | { type: "ssh-ed25519"; key: Uint8Array }
    | { type: "ecdsa"; curve: CurveName; point: Uint8Array }
    | { type: "ssh-rsa"; e: bigint; n: bigint };

const CERT_SUFFIX = "-cert-v01@openssh.com";
const PLAIN_TYPES = new Set([
    "ssh-ed25519",
    "ssh-rsa",
    "ecdsa-sha2-nistp256",
    "ecdsa-sha2-nistp384",
    "ecdsa-sha2-nistp521",
]);

/**
 * Parses a host key like ssh.ParsePublicKey. Certificates verify with the
 * key they certify, as in Go; the CA signature is not checked there either.
 * DSA, security-key and ML-DSA host keys are refused (Go would accept them;
 * OpenSSH servers don't offer them as host keys in practice).
 */
function parsePublicKey(blob: Uint8Array): HostKey {
    const r = new SSHReader(blob);
    const type = text(r.string());
    let key: HostKey;
    if (PLAIN_TYPES.has(type)) {
        key = readPlainKey(r, type);
    } else if (
        type.endsWith(CERT_SUFFIX) &&
        PLAIN_TYPES.has(type.slice(0, -CERT_SUFFIX.length))
    ) {
        r.string(); // nonce
        key = readPlainKey(r, type.slice(0, -CERT_SUFFIX.length));
        readCertificateTail(r);
    } else {
        throw new Error("Unsupported host key type");
    }
    if (r.remaining !== 0) throw new Error("Trailing host key data");
    return key;
}

function readPlainKey(r: SSHReader, type: string): HostKey {
    if (type === "ssh-ed25519") {
        const key = r.string();
        if (key.length !== 32) throw new Error("Bad Ed25519 key");
        return { type, key };
    }
    if (type === "ssh-rsa") {
        const e = positiveMpint(r);
        const n = positiveMpint(r);
        // Go's limits: modulus 1024 to 16384 bits and odd, exponent odd,
        // at least 3 and under 2^24.
        const bits = n === 0n ? 0 : bitLength(n);
        if (bits > 16384 || bits < 1024 || (n & 1n) === 0n) {
            throw new Error("Unsupported RSA modulus");
        }
        if (e < 3n || e >= 1n << 24n || (e & 1n) === 0n) {
            throw new Error("Unsupported RSA exponent");
        }
        return { type, e, n };
    }
    const curve = text(r.string());
    if (`ecdsa-sha2-${curve}` !== type || !(curve in ECDSA_CURVES)) {
        throw new Error("ECDSA curve mismatch");
    }
    const point = r.string();
    const { size } = ECDSA_CURVES[curve as CurveName];
    // Uncompressed points only, like elliptic.Unmarshal; noble checks that
    // the point is on the curve.
    if (point.length !== 1 + 2 * size || point[0] !== 4) {
        throw new Error("Bad ECDSA point");
    }
    ECDSA_CURVES[curve as CurveName].curve.Point.fromBytes(point);
    return { type: "ecdsa", curve: curve as CurveName, point };
}

/** The certificate fields after the key, checked as ssh.parseCert does. */
function readCertificateTail(r: SSHReader): void {
    r.bytes(8); // serial
    r.uint32(); // type
    r.string(); // key id
    const principals = new SSHReader(r.string());
    while (principals.remaining > 0) principals.string();
    r.bytes(16); // valid after, valid before
    readTuples(r.string()); // critical options
    readTuples(r.string()); // extensions
    r.string(); // reserved
    const signatureKey = r.string();
    if (text(new SSHReader(signatureKey).string()).endsWith(CERT_SUFFIX)) {
        throw new Error("Certificate signed by a certificate");
    }
    parsePublicKey(signatureKey);
    const signature = new SSHReader(r.string());
    signature.string(); // format
    signature.string(); // blob
    if (signature.remaining !== 0) throw new Error("Bad certificate signature");
}

function readTuples(data: Uint8Array): void {
    const r = new SSHReader(data);
    let last: Uint8Array | null = null;
    while (r.remaining > 0) {
        const name = r.string();
        if (last && compareBytes(name, last) <= 0) {
            throw new Error("Certificate options out of order");
        }
        last = name;
        const value = r.string();
        if (value.length > 0) {
            const inner = new SSHReader(value);
            inner.string();
            if (inner.remaining !== 0)
                throw new Error("Bad certificate option");
        }
    }
}

function compareBytes(a: Uint8Array, b: Uint8Array): number {
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
        if (a[i] !== b[i]) return a[i]! - b[i]!;
    }
    return a.length - b.length;
}

/** mpint that must be positive: a set high bit means negative in SSH. */
function positiveMpint(r: SSHReader): bigint {
    const bytes = r.string();
    if (bytes.length > 0 && bytes[0]! & 0x80) {
        throw new Error("Negative integer");
    }
    return bytesToBigInt(bytes);
}

/** The canonical plain key blob, which fingerprints are taken over. */
function marshalPlainKey(key: HostKey): Uint8Array {
    const w = new SSHWriter();
    switch (key.type) {
        case "ssh-ed25519":
            return w.string(key.type).string(key.key).toBytes();
        case "ecdsa":
            return w
                .string(`ecdsa-sha2-${key.curve}`)
                .string(key.curve)
                .string(key.point)
                .toBytes();
        case "ssh-rsa":
            return w.string(key.type).mpint(key.e).mpint(key.n).toBytes();
    }
}

function verifySignature(
    key: HostKey,
    data: Uint8Array,
    format: string,
    blob: Uint8Array,
): boolean {
    try {
        switch (key.type) {
            case "ssh-ed25519":
                return (
                    format === "ssh-ed25519" &&
                    blob.length === 64 &&
                    ed25519.verify(blob, data, key.key, { zip215: false })
                );
            case "ecdsa":
                return (
                    format === `ecdsa-sha2-${key.curve}` &&
                    verifyECDSA(key.curve, key.point, data, blob)
                );
            case "ssh-rsa":
                return verifyRSA(key, data, format, blob);
        }
    } catch {
        return false;
    }
}

function verifyECDSA(
    name: CurveName,
    point: Uint8Array,
    data: Uint8Array,
    blob: Uint8Array,
): boolean {
    const { curve, size, hash } = ECDSA_CURVES[name];
    const r = new SSHReader(blob);
    const rs = positiveMpint(r);
    const s = positiveMpint(r);
    if (r.remaining !== 0) return false;
    const n = curve.Point.CURVE().n;
    if (rs <= 0n || rs >= n || s <= 0n || s >= n) return false;
    const compact = new Uint8Array(2 * size);
    compact.set(bigIntToBytes(rs, size), 0);
    compact.set(bigIntToBytes(s, size), size);
    // Go accepts high-S signatures, so noble must too.
    return curve.verify(compact, hash(data), point, {
        prehash: false,
        lowS: false,
    });
}

// DER DigestInfo prefixes for EMSA-PKCS1-v1_5 (RFC 8017 section 9.2).
const DIGEST_INFO = {
    "ssh-rsa": {
        hash: sha1,
        prefix: "3021300906052b0e03021a05000414",
    },
    "rsa-sha2-256": {
        hash: sha256,
        prefix: "3031300d060960864801650304020105000420",
    },
    "rsa-sha2-512": {
        hash: sha512,
        prefix: "3051300d060960864801650304020305000440",
    },
} as const;

/**
 * RSASSA-PKCS1-v1_5 verification with BigInt. Host key exponents are small,
 * so this is a handful of multiplications and stays synchronous on every
 * platform. Short signatures are padded as x/crypto/ssh does.
 */
function verifyRSA(
    key: { e: bigint; n: bigint },
    data: Uint8Array,
    format: string,
    blob: Uint8Array,
): boolean {
    if (!(format in DIGEST_INFO)) return false;
    const { hash, prefix } = DIGEST_INFO[format as keyof typeof DIGEST_INFO];
    const k = Math.ceil(bitLength(key.n) / 8);
    if (blob.length > k) return false;
    const s = bytesToBigInt(blob);
    if (s >= key.n) return false;
    const digestInfo = new Uint8Array([...hexBytes(prefix), ...hash(data)]);
    if (k < digestInfo.length + 11) return false;
    const expected = new Uint8Array(k);
    expected[1] = 1;
    expected.fill(0xff, 2, k - digestInfo.length - 1);
    expected.set(digestInfo, k - digestInfo.length);
    return bytesEqual(bigIntToBytes(modPow(s, key.e, key.n), k), expected);
}

function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
    let result = 1n;
    let b = base % modulus;
    let e = exponent;
    while (e > 0n) {
        if (e & 1n) result = (result * b) % modulus;
        b = (b * b) % modulus;
        e >>= 1n;
    }
    return result;
}

function hexBytes(hex: string): Uint8Array {
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) {
        out[i] = parseInt(hex.slice(2 * i, 2 * i + 2), 16);
    }
    return out;
}
