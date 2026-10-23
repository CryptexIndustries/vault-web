/**
 * Signs with stored SSH key items and checks the signatures with the real
 * ssh-keygen -Y verify. Skipped when ssh-keygen isn't installed.
 *
 * @jest-environment node
 */
import { describe, expect, it, jest } from "@jest/globals";
import { execFileSync, spawnSync } from "child_process";
import { webcrypto } from "crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    writable: true,
});

import { sha512 } from "@noble/hashes/sha2.js";
import { uint8ToBase64 } from "../encoding";
import { SSHReader, SSHWriter } from "../internal/ssh/wire";
import type { SSHKeyData } from "../proto/vault";
import {
    importSSHPrivateKey,
    parseSSHPublicKey,
    SSH_AGENT_RSA_SHA2_256,
    SSH_AGENT_RSA_SHA2_512,
} from "../vault-utils/ssh-key";
import {
    signSSH,
    SSHSignAbortedError,
    SSHSignError,
} from "../vault-utils/ssh-sign";

const hasSSHKeygen = spawnSync("ssh-keygen", ["-?"]).error === undefined;
const describeIfSSHKeygen = hasSSHKeygen ? describe : describe.skip;
const FIXTURES = join(__dirname, "fixtures", "ssh");

// Encrypted fixtures use the passphrase from fixtures/ssh/generate.sh.
const load = async (name: string): Promise<SSHKeyData> => {
    const result = await importSSHPrivateKey(
        readFileSync(join(FIXTURES, name), "utf8"),
        name.includes("-enc") ? { passphrase: "correct horse" } : {},
    );
    if (result.isErr()) throw result.error;
    return result.value;
};

const blobOf = (key: SSHKeyData) => parseSSHPublicKey(key.PublicKey)!.blob;

/** The data ssh-keygen -Y sign asks an agent to sign (PROTOCOL.sshsig). */
const sshsigData = (namespace: string, message: Uint8Array) =>
    new SSHWriter()
        .raw(new TextEncoder().encode("SSHSIG"))
        .string(namespace)
        .string("")
        .string("sha512")
        .string(sha512(message))
        .toBytes();

const armoredSSHSIG = (
    publicBlob: Uint8Array,
    namespace: string,
    signature: Uint8Array,
) => {
    const blob = new SSHWriter()
        .raw(new TextEncoder().encode("SSHSIG"))
        .uint32(1)
        .string(publicBlob)
        .string(namespace)
        .string("")
        .string("sha512")
        .string(signature)
        .toBytes();
    const b64 = uint8ToBase64(blob).replace(/(.{70})/g, "$1\n");
    return `-----BEGIN SSH SIGNATURE-----\n${b64}\n-----END SSH SIGNATURE-----\n`;
};

const signatureFormat = (wire: Uint8Array) => new SSHReader(wire).text();

describeIfSSHKeygen("SSH signing checked by ssh-keygen", () => {
    const cases: [string, number, string][] = [
        ["ed25519.key", 0, "ssh-ed25519"],
        ["ecdsa-p256.key", 0, "ecdsa-sha2-nistp256"],
        ["ecdsa-p521.key", 0, "ecdsa-sha2-nistp521"],
        ["ecdsa-p384-enc.key", 0, "ecdsa-sha2-nistp384"],
        ["rsa-3072.key", SSH_AGENT_RSA_SHA2_512, "rsa-sha2-512"],
        ["rsa-3072.key", SSH_AGENT_RSA_SHA2_256, "rsa-sha2-256"],
    ];

    it.each(cases)(
        "%s with flags %d signs as %s",
        async (file, flags, format) => {
            const key = await load(file);
            const message = new TextEncoder().encode(
                "tree 4b825dc6\n\nsigned commit\n",
            );
            const signature = await signSSH(
                key,
                blobOf(key),
                sshsigData("git", message),
                flags,
            );
            expect(signatureFormat(signature)).toBe(format);

            const dir = mkdtempSync(join(tmpdir(), "cryptex-sign-"));
            try {
                writeFileSync(join(dir, "msg"), message);
                writeFileSync(
                    join(dir, "msg.sig"),
                    armoredSSHSIG(blobOf(key), "git", signature),
                );
                writeFileSync(
                    join(dir, "allowed"),
                    `signer ${key.PublicKey}\n`,
                );
                const out = execFileSync(
                    "ssh-keygen",
                    [
                        "-Y",
                        "verify",
                        "-f",
                        join(dir, "allowed"),
                        "-I",
                        "signer",
                        "-n",
                        "git",
                        "-s",
                        join(dir, "msg.sig"),
                    ],
                    { input: message, encoding: "utf8" },
                );
                expect(out).toContain('Good "git" signature');
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        },
    );
});

describe("signSSH", () => {
    it("uses SHA-512 when both RSA flags are set, and SHA-1 without flags", async () => {
        const key = await load("rsa-3072.key");
        const both = await signSSH(
            key,
            blobOf(key),
            new Uint8Array([1]),
            SSH_AGENT_RSA_SHA2_256 | SSH_AGENT_RSA_SHA2_512,
        );
        expect(signatureFormat(both)).toBe("rsa-sha2-512");
        const none = await signSSH(key, blobOf(key), new Uint8Array([1]), 0);
        expect(signatureFormat(none)).toBe("ssh-rsa");
    });

    it("makes no signature once the lock cancelled it, also after the RSA key import", async () => {
        const ed = await load("ed25519.key");
        const cancelled = new AbortController();
        cancelled.abort();
        await expect(
            signSSH(ed, blobOf(ed), new Uint8Array([1]), 0, {
                signal: cancelled.signal,
            }),
        ).rejects.toBeInstanceOf(SSHSignAbortedError);

        const rsa = await load("rsa-3072.key");
        const controller = new AbortController();
        const subtle = globalThis.crypto.subtle;
        const importKey = subtle.importKey.bind(subtle);
        const sign = jest.spyOn(subtle, "sign");
        const spy = jest
            .spyOn(subtle, "importKey")
            .mockImplementation(async (...args: unknown[]) => {
                const key = await (
                    importKey as (...a: unknown[]) => Promise<CryptoKey>
                )(...args);
                // The vault starts locking while the key imports.
                controller.abort();
                return key;
            });
        try {
            await expect(
                signSSH(
                    rsa,
                    blobOf(rsa),
                    new Uint8Array([1]),
                    SSH_AGENT_RSA_SHA2_512,
                    {
                        signal: controller.signal,
                    },
                ),
            ).rejects.toBeInstanceOf(SSHSignAbortedError);
            expect(sign).not.toHaveBeenCalled();
        } finally {
            spy.mockRestore();
            sign.mockRestore();
        }
    });

    it("refuses when the request names another key", async () => {
        const key = await load("ed25519.key");
        const other = await load("ecdsa-p256.key");
        await expect(
            signSSH(key, blobOf(other), new Uint8Array([1]), 0),
        ).rejects.toThrow(SSHSignError);
    });
});
