/**
 * @jest-environment node
 */
import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";

import { base64ToUint8, uint8ToBase64 } from "../encoding";
import { SSHReader, SSHWriter } from "../internal/ssh/wire";
import {
    importSSHPrivateKey,
    MAX_IMPORT_BCRYPT_ROUNDS,
    SSH_EXPORT_RANDOM_BYTES,
} from "../vault-utils/ssh-key";
import { runSSHKeyTask } from "../vault-utils/ssh-key-task";

const FIXTURES = join(__dirname, "fixtures", "ssh");
const PASSPHRASE = "correct horse";

const fixture = (name: string) => readFileSync(join(FIXTURES, name), "utf8");

/** Rewrites the bcrypt rounds in an encrypted OpenSSH key file. */
const withRounds = (text: string, rounds: number) => {
    const body = base64ToUint8(
        text.replace(/-----[^-]+-----/g, "").replace(/\s+/g, ""),
    );
    const reader = new SSHReader(body);
    const magic = reader.bytes("openssh-key-v1\0".length);
    const cipher = reader.string();
    const kdf = reader.string();
    const salt = new SSHReader(reader.string()).string();
    const rewritten = new SSHWriter()
        .raw(magic)
        .string(cipher)
        .string(kdf)
        .string(new SSHWriter().string(salt).uint32(rounds).toBytes())
        .raw(reader.rest())
        .toBytes();
    return `-----BEGIN OPENSSH PRIVATE KEY-----\n${uint8ToBase64(rewritten)}\n-----END OPENSSH PRIVATE KEY-----\n`;
};

describe("SSH key import work limits", () => {
    it("refuses bcrypt rounds above the limit before deriving the key", async () => {
        const text = withRounds(
            fixture("ed25519-aes256-ctr.key"),
            MAX_IMPORT_BCRYPT_ROUNDS + 1,
        );
        const result = await importSSHPrivateKey(text, {
            passphrase: PASSPHRASE,
        });
        expect(result.isErr() && result.error.code).toBe("kdf-too-expensive");
        expect(result.isErr() && result.error.message).toContain("1,001");
    });
});

describe("runSSHKeyTask", () => {
    it("imports a key into plain data", () => {
        const result = runSSHKeyTask({
            kind: "import",
            text: fixture("ed25519-aes256-ctr.key"),
            passphrase: PASSPHRASE,
        });
        expect(result.ok && result.kind).toBe("import");
        if (!result.ok || result.kind !== "import") return;
        expect(Object.keys(result.data).sort()).toEqual([
            "Comment",
            "PrivateKey",
            "PublicKey",
        ]);
        expect(result.data.PublicKey).toMatch(/^ssh-ed25519 /);
    });

    it("returns key errors as codes and messages", () => {
        const result = runSSHKeyTask({
            kind: "import",
            text: fixture("ed25519-aes256-ctr.key"),
            passphrase: "wrong",
        });
        expect(result).toEqual({
            ok: false,
            code: "wrong-passphrase",
            message: expect.any(String),
        });
    });

    it("uses caller-supplied random bytes for an encrypted export", () => {
        const imported = runSSHKeyTask({
            kind: "import",
            text: fixture("ed25519.key"),
        });
        if (!imported.ok || imported.kind !== "import") {
            throw new Error("import failed");
        }
        const random = uint8ToBase64(
            new Uint8Array(SSH_EXPORT_RANDOM_BYTES).fill(7),
        );
        const exportOnce = () =>
            runSSHKeyTask({
                kind: "export",
                data: imported.data,
                passphrase: PASSPHRASE,
                random,
            });
        const first = exportOnce();
        expect(first.ok).toBe(true);
        expect(exportOnce()).toEqual(first);
    });

    it("reports broken stored data instead of throwing", () => {
        const result = runSSHKeyTask({
            kind: "export",
            data: { PrivateKey: "garbage", PublicKey: "", Comment: "" },
        });
        expect(result.ok).toBe(false);
    });
});

describe("SSH key work without crypto.getRandomValues", () => {
    it("imports and exports unencrypted keys without asking for random bytes", () => {
        const original = globalThis.crypto.getRandomValues;
        globalThis.crypto.getRandomValues = () => {
            throw new Error("no random source");
        };
        try {
            const imported = runSSHKeyTask({
                kind: "import",
                text: fixture("ed25519-aes256-ctr.key"),
                passphrase: PASSPHRASE,
            });
            expect(imported.ok).toBe(true);
            if (!imported.ok || imported.kind !== "import") return;
            expect(
                runSSHKeyTask({ kind: "export", data: imported.data }).ok,
            ).toBe(true);
        } finally {
            globalThis.crypto.getRandomValues = original;
        }
    });
});
