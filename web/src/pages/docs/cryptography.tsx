import Link from "next/link";
import type { ReactNode } from "react";
import {
    DocArticle,
    DocCallout,
    DocSection,
} from "@/components/marketing/doc-article";
import t from "@/styles/TechnicalDocs.module.css";
import c from "@/styles/Cryptography.module.css";

const sourceRoot =
    "https://github.com/CryptexIndustries/vault-web/blob/a01ac684cea1491814f2ede553c32dffc82b64bd/packages/vault-core/src/";
const standards = {
    argon: "https://www.rfc-editor.org/info/rfc9106/",
    hkdf: "https://www.rfc-editor.org/info/rfc5869/",
    wrap: "https://www.rfc-editor.org/info/rfc3394/",
    gcm: "https://csrc.nist.gov/pubs/sp/800/38/d/final",
    prf: "https://www.w3.org/TR/webauthn-3/#prf-extension",
};

function KeyNode({ title, detail }: { title: string; detail: ReactNode }) {
    return (
        <div className={c.node}>
            <strong>{title}</strong>
            <span>{detail}</span>
        </div>
    );
}

function KeyFlow() {
    return (
        <figure
            className={c.flow}
            aria-label="Two ways to recover the same vault data key"
        >
            <div className={c.branches}>
                <div className={c.branch}>
                    <span className={c.label}>PRIMARY UNLOCK</span>
                    <KeyNode
                        title="Master password + password salt"
                        detail="Argon2id uses a random 16-byte salt to derive 32 bytes of password material."
                    />
                    <div className={c.arrow}>
                        <span aria-hidden="true">↓</span> HKDF-SHA-256
                    </div>
                    <KeyNode
                        title="Primary key-encryption key"
                        detail={
                            <>
                                <span className={c.inputCase}>
                                    <b>Without additional protection</b>
                                    Input: password-derived material. Salt: a
                                    separate random 16-byte HKDF salt.
                                </span>
                                <span className={c.inputCase}>
                                    <b>With additional protection</b>
                                    Input: factor key material. Salt: the
                                    32-byte password-derived material above.
                                </span>
                                <span>
                                    Both use the vault ID in the HKDF context.
                                </span>
                            </>
                        }
                    />
                    <div className={c.arrow}>
                        <span aria-hidden="true">↓</span> AES Key Wrap
                    </div>
                    <KeyNode
                        title="Primary slot"
                        detail="A wrapped copy of the data key"
                    />
                </div>
                <div className={c.branch}>
                    <span className={c.label}>RECOVERY UNLOCK</span>
                    <KeyNode
                        title="Recovery code + recovery salt"
                        detail="The recovery code has its own random 16-byte salt, separate from the password salt."
                    />
                    <div className={c.arrow}>
                        <span aria-hidden="true">↓</span> Argon2id
                    </div>
                    <KeyNode
                        title="Recovery key-encryption key"
                        detail="Argon2id derives the 256-bit recovery wrapping key directly from the recovery code and its separate salt."
                    />
                    <div className={c.arrow}>
                        <span aria-hidden="true">↓</span> AES Key Wrap
                    </div>
                    <KeyNode
                        title="Recovery slot"
                        detail="Another wrapped copy of the same data key"
                    />
                </div>
            </div>
            <div className={c.merge}>
                Either slot unwraps the same key{" "}
                <span aria-hidden="true">↓</span>
            </div>
            <KeyNode
                title="Data-encryption key, or DEK"
                detail="Random 256-bit key"
            />
            <div className={c.arrow}>
                <span aria-hidden="true">↓</span> AES-256-GCM
            </div>
            <KeyNode
                title="Encrypted vault payload"
                detail="Serialized vault records"
            />
            <figcaption>
                Unlocking needs one complete path, not both. Each slot stores an
                encrypted copy of the data key, not the password or recovery
                code. Random salts are stored with the envelope. With additional
                protection, the HKDF salt is instead secret password-derived
                material, recomputed during unlocking.
            </figcaption>
        </figure>
    );
}

export default function Cryptography() {
    return (
        <DocArticle
            title="Cryptography"
            description="What encrypts the vault, how passwords and recovery codes unlock its key, and what changes when you replace a secret."
            eyebrow="TECHNICAL GUIDE"
            toc={[
                { href: "#vault", label: "Vault encryption" },
                { href: "#unlock", label: "Unlock factors and recovery" },
                { href: "#changes", label: "Changing keys and secrets" },
                { href: "#parameters", label: "Format and parameters" },
                { href: "#sync", label: "Session cryptography" },
                { href: "#files", label: "Backups and exports" },
                { href: "#references", label: "Implementation references" },
            ]}
            related={[
                {
                    href: "/docs/architecture",
                    title: "Architecture",
                    description: "Where vault operations and storage run.",
                },
                {
                    href: "/docs/threat-model",
                    title: "Threat model",
                    description:
                        "Security assumptions and protection boundaries.",
                },
                {
                    href: "/docs/synchronization",
                    title: "Synchronization",
                    description: "Handshake and record-exchange protocol.",
                },
                {
                    href: "/docs/recovery",
                    title: "Recovery user guide",
                    description:
                        "Using vault recovery codes and the Online Services Recovery Kit.",
                },
            ]}
        >
            <DocSection id="vault" title="What encrypts the vault">
                <p>
                    Cryptex Vault encrypts the serialized vault with a randomly
                    generated 256-bit data-encryption key, or DEK.{" "}
                    <a href={standards.gcm}>AES-256-GCM</a> encrypts the data
                    and checks its integrity during decryption.
                </p>
                <p>
                    The password protects access to this key. A key-encryption
                    key, or KEK, wraps the DEK using{" "}
                    <a href={standards.wrap}>AES Key Wrap</a>. The vault
                    envelope stores two wrapped copies in separate key slots:
                    one for normal unlocking and one for recovery.
                </p>
                <KeyFlow />
            </DocSection>

            <DocSection id="unlock" title="Unlock factors and recovery">
                <p>
                    <a href={standards.argon}>Argon2id</a> derives 256 bits of
                    key material from the master password and a stored random
                    salt. Without additional protection,{" "}
                    <a href={standards.hkdf}>HKDF-SHA-256</a> uses that material
                    and a separate stored salt to derive the primary KEK.
                </p>
                <p>
                    With additional protection, HKDF instead uses the factor's
                    key material as its input and the password-derived value as
                    its salt. Both are needed to derive the primary KEK. In
                    either case, HKDF includes the vault ID in its context
                    string.
                </p>
                <dl>
                    <div className={t.definition}>
                        <dt>Protection phrase</dt>
                        <dd>
                            A generated phrase contains 128 or 256 bits of
                            entropy. Argon2id derives its key material with a
                            separate salt. The client can retain that derived
                            material locally, so the phrase need not be entered
                            on every unlock. Restoring on a fresh device
                            requires the phrase unless the vault recovery code
                            is used.
                        </dd>
                    </div>
                    <div className={t.definition}>
                        <dt>WebAuthn PRF</dt>
                        <dd>
                            A compatible authenticator supplies a reproducible
                            32-byte output through the{" "}
                            <a href={standards.prf}>WebAuthn PRF extension</a>.
                            This output supplies the additional key material
                            directly, without a second Argon2id step. The
                            password is still required for primary unlocking,
                            along with access to the enrolled credential through
                            a compatible browser and authenticator.
                        </dd>
                    </div>
                    <div className={t.definition}>
                        <dt>Vault recovery code</dt>
                        <dd>
                            Creation generates a 24-word BIP39 mnemonic from 256
                            bits of entropy. Argon2id derives a separate
                            recovery KEK that unwraps the same DEK. This path
                            does not require the master password or additional
                            factor.
                        </dd>
                    </div>
                </dl>
                <DocCallout title="Vault recovery and account recovery are separate">
                    <p>
                        The vault recovery code can decrypt a matching encrypted
                        vault. The Online Services Recovery Kit authorizes
                        account recovery and access to eligible backups; it does
                        not supply the vault's decryption key. See the{" "}
                        <Link href="/docs/recovery">recovery guide</Link> for
                        the two recovery processes.
                    </p>
                </DocCallout>
            </DocSection>

            <DocSection id="changes" title="Changing keys and secrets">
                <p>
                    Rewrapping changes how an existing data key is unlocked.
                    Data-key rotation replaces that key and encrypts the vault
                    again. These operations first require access to the existing
                    DEK through the primary or recovery slot.
                </p>
                <div
                    className={t.tableWrap}
                    tabIndex={0}
                    role="region"
                    aria-label="Effects of changing vault secrets"
                >
                    <table className={t.table}>
                        <thead>
                            <tr>
                                <th scope="col">Operation</th>
                                <th scope="col">Key slots</th>
                                <th scope="col">Vault data key and payload</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td>Change master password</td>
                                <td>
                                    Rebuilds the primary slot. Recovery slot is
                                    unchanged.
                                </td>
                                <td>Same DEK and ciphertext.</td>
                            </tr>
                            <tr>
                                <td>
                                    Add, change, or remove additional protection
                                </td>
                                <td>
                                    Rebuilds the primary slot using the new
                                    factor settings. Recovery slot is unchanged.
                                </td>
                                <td>Same DEK and ciphertext.</td>
                            </tr>
                            <tr>
                                <td>Replace recovery code</td>
                                <td>
                                    Rebuilds the recovery slot. Primary slot is
                                    unchanged.
                                </td>
                                <td>Same DEK and ciphertext.</td>
                            </tr>
                            <tr>
                                <td>Rotate data-encryption key</td>
                                <td>
                                    Rebuilds both slots and generates a new
                                    recovery code.
                                </td>
                                <td>
                                    New DEK, fresh IV, and re-encrypted payload.
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                <p>
                    The first three rows describe changes without optional
                    data-key rotation. All changes apply to this local vault.
                    Linked devices keep their own keys, and existing backups
                    keep their original envelopes and unlock secrets. Adding
                    protection or rotating a key does not retroactively secure
                    an older backup.
                </p>
            </DocSection>

            <DocSection id="parameters" title="Format and parameters">
                <p>
                    These values describe the current version <code>3</code>{" "}
                    vault envelope. Argon2id defaults apply when creating new
                    key slots; unlocking an existing vault uses the parameters
                    recorded in its slot.
                </p>
                <dl>
                    <div className={t.definition}>
                        <dt>Vault payload</dt>
                        <dd>
                            AES-256-GCM with a random 256-bit DEK. Each payload
                            encryption generates a fresh random 12-byte IV using{" "}
                            <code>crypto.getRandomValues</code>. Web Crypto uses
                            its default 128-bit authentication tag.
                        </dd>
                    </div>
                    <div className={t.definition}>
                        <dt>Password derivation</dt>
                        <dd>
                            Argon2id v1.3 through libsodium, producing 32 bytes.
                            Defaults are <code>256 MiB</code> of memory and{" "}
                            <code>3</code> passes. Password and recovery
                            derivation use separate random 16-byte salts.
                        </dd>
                    </div>
                    <div className={t.definition}>
                        <dt>Primary KEK</dt>
                        <dd>
                            HKDF-SHA-256 produces a 256-bit AES-KW key. Its
                            context is <code>cryptex/kek/v1|</code> followed by
                            the vault ID. Without additional protection, the
                            HKDF salt is a separate random 16-byte value.
                        </dd>
                    </div>
                    <div className={t.definition}>
                        <dt>Recovery KEK</dt>
                        <dd>
                            The 32-byte Argon2id output from the recovery code
                            is imported directly as a 256-bit AES-KW key.
                        </dd>
                    </div>
                    <div className={t.definition}>
                        <dt>Wrapped keys</dt>
                        <dd>
                            Each slot contains a 40-byte AES-KW wrapped DEK,
                            plus the derivation parameters needed to open it.
                            Random salts and IVs are stored alongside the
                            encrypted vault. They do not need to be kept
                            confidential and cannot decrypt the vault on their
                            own.
                        </dd>
                    </div>
                </dl>
                <p>
                    Vault payload encryption does not supply additional
                    authenticated data to AES-GCM. The vault-ID context above
                    belongs to primary-key derivation; it should not be confused
                    with the transcript-bound associated data used in
                    synchronization.
                </p>
                <p>
                    Older blob readers support migration from the earlier
                    AES/PBKDF2 and XChaCha20-Poly1305 formats. Those formats are
                    separate from the current envelope described here.
                </p>
            </DocSection>

            <DocSection id="sync" title="Session cryptography">
                <p>
                    Linked devices use separate synchronization keys to
                    establish an encrypted session. These keys are distinct from
                    the DEK that encrypts each local vault.
                </p>
                <div className={t.tableWrap}>
                    <table className={t.table}>
                        <thead>
                            <tr>
                                <th scope="col">Primitive</th>
                                <th scope="col">Purpose</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td>
                                    <a href="https://csrc.nist.gov/pubs/fips/203/final">
                                        ML-KEM-768
                                    </a>
                                </td>
                                <td>
                                    Establishes shared secret material for the
                                    session.
                                </td>
                            </tr>
                            <tr>
                                <td>
                                    <a href="https://csrc.nist.gov/pubs/fips/204/final">
                                        ML-DSA-65
                                    </a>
                                </td>
                                <td>
                                    Authenticates the handshake using signing
                                    keys exchanged during linking.
                                </td>
                            </tr>
                            <tr>
                                <td>
                                    <a href={standards.hkdf}>HKDF-SHA-256</a>
                                </td>
                                <td>
                                    Derives the AES session key from the shared
                                    secret and handshake context.
                                </td>
                            </tr>
                            <tr>
                                <td>
                                    <a href={standards.gcm}>AES-256-GCM</a>
                                </td>
                                <td>
                                    Encrypts messages with fresh random nonces.
                                    Associated data binds messages to the
                                    handshake and sequence; the receiver checks
                                    sequence numbers.
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                <p>
                    Initial linking uses a mnemonic-protected invitation. The
                    sender signs the transfer's key-encapsulation context with
                    ML-DSA, and the receiver verifies it using the sender key in
                    the invitation. See{" "}
                    <Link href="/docs/synchronization#session">
                        session establishment
                    </Link>{" "}
                    for the protocol sequence and message checks.
                </p>
            </DocSection>

            <DocSection id="files" title="Backups and exports">
                <p>
                    A manual <code>.cryx</code> backup contains the encrypted
                    vault envelope. Managed backups use the same restore format
                    and are encrypted locally before upload. They retain the key
                    slots needed for decryption.
                </p>
                <p>
                    The backup service receives ciphertext, its byte size, and a
                    SHA-256 checksum. The checksum checks transfer integrity;
                    AES-GCM authenticates the encrypted payload when the client
                    decrypts it.
                </p>
                <p>
                    A JSON migration export is not encrypted. It contains
                    readable credential data and has no protection from the
                    vault password or recovery code. See{" "}
                    <Link href="/docs/backups">Backups</Link> for backup and
                    restore instructions.
                </p>
            </DocSection>

            <DocSection id="references" title="Implementation references">
                <dl>
                    <div className={t.definition}>
                        <dt>Vault format and keys</dt>
                        <dd>
                            <a href={sourceRoot + "proto/vault.proto"}>
                                Envelope schema
                            </a>
                            ,{" "}
                            <a
                                href={
                                    sourceRoot +
                                    "vault-utils/envelope-encryption.ts"
                                }
                            >
                                key derivation and payload encryption
                            </a>
                            , and{" "}
                            <a
                                href={
                                    sourceRoot + "internal/envelope-crypto.ts"
                                }
                            >
                                Web Crypto key wrapping
                            </a>
                            .
                        </dd>
                    </div>
                    <div className={t.definition}>
                        <dt>Factors and changes</dt>
                        <dd>
                            <a
                                href={
                                    sourceRoot +
                                    "vault-utils/additional-key-protection.ts"
                                }
                            >
                                Protection phrases and WebAuthn PRF
                            </a>
                            ,{" "}
                            <a
                                href={
                                    sourceRoot +
                                    "vault-utils/vault-envelope-ops.ts"
                                }
                            >
                                slot replacement and data-key rotation
                            </a>
                            , and{" "}
                            <a href={sourceRoot + "vault-utils/encryption.ts"}>
                                Argon2id defaults
                            </a>
                            .
                        </dd>
                    </div>
                    <div className={t.definition}>
                        <dt>Session encryption</dt>
                        <dd>
                            <a href={sourceRoot + "vault-utils/sync-crypto.ts"}>
                                Session derivation and authenticated messages
                            </a>
                            , and{" "}
                            <a href={sourceRoot + "synchronization.ts"}>
                                handshake and sequence validation
                            </a>
                            .
                        </dd>
                    </div>
                </dl>
                <p id="assurance">
                    For security assumptions and limits, see the{" "}
                    <Link href="/docs/threat-model">Threat model</Link>. Audit
                    status is listed on the{" "}
                    <Link href="/security#source-release">Security page</Link>.
                </p>
            </DocSection>
        </DocArticle>
    );
}
