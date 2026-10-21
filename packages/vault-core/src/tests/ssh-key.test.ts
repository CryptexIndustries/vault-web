/**
 * @jest-environment node
 */
import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";

import { uint8ToBase64 } from "../encoding";
import { SSHWriter } from "../internal/ssh/wire";
import {
    describeSSHKey,
    exportSSHPrivateKey,
    generateSSHKey,
    importSSHPrivateKey,
    isWeakSSHKey,
    parseSSHPublicKey,
    sshKeyFileName,
    sshPublicKeyLine,
    validateSSHKeyData,
    type SSHKeyErrorCode,
} from "../vault-utils/ssh-key";

const FIXTURES = join(__dirname, "fixtures", "ssh");
const PASSPHRASE = "correct horse";

const fixture = (name: string) => readFileSync(join(FIXTURES, name), "utf8");
const publicKeyOf = (name: string) =>
    fixture(`${name}.pub`).trim().split(/\s+/).slice(0, 2).join(" ");

const expectImported = async (
    text: string,
    options?: Parameters<typeof importSSHPrivateKey>[1],
) => {
    const result = await importSSHPrivateKey(text, options);
    if (result.isErr()) throw result.error;
    return result.value;
};

const expectError = async (
    text: string,
    code: SSHKeyErrorCode,
    options?: Parameters<typeof importSSHPrivateKey>[1],
) => {
    const result = await importSSHPrivateKey(text, options);
    expect(result.isErr() && result.error.code).toBe(code);
};

describe("importing SSH private keys", () => {
    const supported: Array<{
        file: string;
        label: string;
        encrypted?: boolean;
        comment?: string;
    }> = [
        { file: "ed25519.key", label: "Ed25519", comment: "ed25519@fixtures" },
        {
            file: "ed25519-aes256-ctr.key",
            label: "Ed25519",
            encrypted: true,
            comment: "ed25519-enc@fixtures",
        },
        {
            file: "ed25519-aes256-gcm.key",
            label: "Ed25519",
            encrypted: true,
            comment: "gcm@fixtures",
        },
        {
            file: "ed25519-aes256-cbc.key",
            label: "Ed25519",
            encrypted: true,
            comment: "cbc@fixtures",
        },
        {
            file: "ecdsa-p256.key",
            label: "ECDSA P-256",
            comment: "p256@fixtures",
        },
        {
            file: "ecdsa-p384-enc.key",
            label: "ECDSA P-384",
            encrypted: true,
            comment: "p384@fixtures",
        },
        {
            file: "ecdsa-p521.key",
            label: "ECDSA P-521",
            comment: "p521@fixtures",
        },
        {
            file: "rsa-3072.key",
            label: "RSA 3072",
            comment: "rsa3072@fixtures",
        },
        {
            file: "rsa-2048-enc.key",
            label: "RSA 2048",
            encrypted: true,
            comment: "rsa2048@fixtures",
        },
        { file: "rsa-pkcs1.key", label: "RSA 2048" },
        { file: "rsa-pkcs1-enc.key", label: "RSA 2048", encrypted: true },
        { file: "ecdsa-sec1.key", label: "ECDSA P-256" },
        { file: "ecdsa-sec1-enc.key", label: "ECDSA P-384", encrypted: true },
        { file: "ecdsa-sec1-nopub.key", label: "ECDSA P-256" },
        { file: "rsa-pkcs8.key", label: "RSA 2048" },
        { file: "ecdsa-pkcs8-enc.key", label: "ECDSA P-521", encrypted: true },
        { file: "ed25519-pkcs8.key", label: "Ed25519" },
        { file: "ed25519-pkcs8-enc.key", label: "Ed25519", encrypted: true },
    ];

    it.each(supported)(
        "imports $file",
        async ({ file, label, encrypted, comment }) => {
            const data = await expectImported(fixture(file), {
                passphrase: encrypted ? PASSPHRASE : undefined,
            });
            expect(data.PublicKey).toBe(publicKeyOf(file));
            expect(data.PrivateKey).toMatch(
                /^-----BEGIN OPENSSH PRIVATE KEY-----\n/,
            );
            expect(describeSSHKey(data)?.label).toBe(label);
            expect(validateSSHKeyData(data).isOk()).toBe(true);
            if (comment !== undefined) expect(data.Comment).toBe(comment);
        },
    );

    it.each(supported.filter((entry) => entry.encrypted))(
        "asks for the passphrase of $file",
        async ({ file }) => {
            await expectError(fixture(file), "passphrase-required");
            await expectError(fixture(file), "wrong-passphrase", {
                passphrase: "wrong",
            });
        },
    );

    it("stores the same key the same way every time", async () => {
        const first = await expectImported(fixture("ed25519.key"));
        const second = await expectImported(fixture("ed25519.key"));
        expect(second.PrivateKey).toBe(first.PrivateKey);
    });

    it("tolerates Windows line endings and surrounding whitespace", async () => {
        const text = `\n  ${fixture("ecdsa-p256.key").replace(/\n/g, "\r\n")}  \n`;
        const data = await expectImported(text);
        expect(data.PublicKey).toBe(publicKeyOf("ecdsa-p256.key"));
    });

    it("takes the comment from the .pub file for PEM keys", async () => {
        const pub = fixture("rsa-pkcs1.key.pub");
        const data = await expectImported(fixture("rsa-pkcs1.key"), {
            publicKey: pub,
        });
        expect(data.Comment).toBe(parseSSHPublicKey(pub)?.comment);
    });

    it("rejects a .pub file that belongs to another key", async () => {
        await expectError(fixture("ed25519.key"), "public-key-mismatch", {
            publicKey: fixture("ecdsa-p256.key.pub"),
        });
        await expectError(fixture("ed25519.key"), "public-key-invalid", {
            publicKey: "not a key",
        });
    });

    it.each<[string, SSHKeyErrorCode]>([
        ["ed25519-chacha.key", "unsupported-cipher"],
        ["rsa-pkcs1-3des.key", "unsupported-cipher"],
        ["rsa-512.key", "rsa-too-small"],
        ["dsa.key", "dsa"],
        ["dsa-pkcs8.key", "dsa"],
        ["ed25519.key.pub", "public-key-only"],
    ])("refuses %s with %s", async (file, code) => {
        await expectError(fixture(file), code, { passphrase: PASSPHRASE });
    });

    it("refuses empty input, garbage and PuTTY files", async () => {
        await expectError("   ", "empty");
        await expectError("hello", "invalid");
        await expectError(
            "-----BEGIN OPENSSH PRIVATE KEY-----\nAAAA\n-----END OPENSSH PRIVATE KEY-----",
            "invalid",
        );
        await expectError(
            "PuTTY-User-Key-File-3: ssh-ed25519\nEncryption: none\n",
            "putty",
        );
    });

    const openSSHWithType = (type: string) => {
        const blob = new SSHWriter().string(type).string("x").toBytes();
        const body = new SSHWriter()
            .raw(new TextEncoder().encode("openssh-key-v1\0"))
            .string("none")
            .string("none")
            .string("")
            .uint32(1)
            .string(blob)
            .string(new Uint8Array(8))
            .toBytes();
        return `-----BEGIN OPENSSH PRIVATE KEY-----\n${uint8ToBase64(body)}\n-----END OPENSSH PRIVATE KEY-----\n`;
    };

    it("explains security-key and DSA keys in OpenSSH format", async () => {
        await expectError(
            openSSHWithType("sk-ssh-ed25519@openssh.com"),
            "security-key",
        );
        await expectError(openSSHWithType("ssh-dss"), "dsa");
    });
});

describe("generating and exporting SSH keys", () => {
    it("generates a valid Ed25519 key", () => {
        const data = generateSSHKey("  laptop  ");
        expect(data.Comment).toBe("laptop");
        expect(describeSSHKey(data)).toMatchObject({
            algorithm: "ssh-ed25519",
            bits: 256,
            label: "Ed25519",
        });
        expect(validateSSHKeyData(data).isOk()).toBe(true);
        expect(sshPublicKeyLine(data)).toMatch(
            /^ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI[A-Za-z0-9+/]+ laptop$/,
        );
    });

    it("exports with the current comment and imports back", async () => {
        const data = { ...generateSSHKey("old"), Comment: "new comment" };
        const exported = exportSSHPrivateKey(data);
        const reimported = await expectImported(exported);
        expect(reimported.PublicKey).toBe(data.PublicKey);
        expect(reimported.Comment).toBe("new comment");
    });

    it("exports with a passphrase", async () => {
        const data = generateSSHKey("protected");
        const exported = exportSSHPrivateKey(data, PASSPHRASE);
        expect(exported).not.toBe(exportSSHPrivateKey(data));
        await expectError(exported, "passphrase-required");
        await expectError(exported, "wrong-passphrase", { passphrase: "nope" });
        const reimported = await expectImported(exported, {
            passphrase: PASSPHRASE,
        });
        expect(reimported.PublicKey).toBe(data.PublicKey);
    });

    it("detects stored data whose halves don't match", () => {
        const one = generateSSHKey("one");
        const two = generateSSHKey("two");
        const result = validateSSHKeyData({ ...one, PublicKey: two.PublicKey });
        expect(result.isErr() && result.error.code).toBe("public-key-mismatch");
    });
});

describe("SSH key helpers", () => {
    it("flags RSA keys under 3072 bits as weak", async () => {
        const weak = await expectImported(fixture("rsa-pkcs8.key"));
        const strong = await expectImported(fixture("rsa-3072.key"));
        expect(isWeakSSHKey(describeSSHKey(weak)!)).toBe(true);
        expect(isWeakSSHKey(describeSSHKey(strong)!)).toBe(false);
        expect(isWeakSSHKey(describeSSHKey(generateSSHKey(""))!)).toBe(false);
    });

    it("reads public keys with authorized_keys options", () => {
        const line = fixture("ed25519.key.pub").trim();
        const parsed = parseSSHPublicKey(`no-pty,from="10.0.0.1" ${line}`);
        expect(parsed?.algorithm).toBe("ssh-ed25519");
        expect(parsed?.comment).toBe("ed25519@fixtures");
        expect(parseSSHPublicKey("ssh-ed25519 notbase64!")).toBeNull();
    });

    it("makes safe file names", () => {
        expect(sshKeyFileName("GitHub / work laptop")).toBe(
            "GitHub_work_laptop",
        );
        expect(sshKeyFileName("../../etc")).toBe("etc");
        expect(sshKeyFileName("   ")).toBe("id_ssh_key");
    });
});
