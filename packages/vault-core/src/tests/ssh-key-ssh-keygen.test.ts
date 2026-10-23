/**
 * Cross-checks SSH key handling against the real ssh-keygen. Skipped when
 * ssh-keygen isn't installed.
 *
 * @jest-environment node
 */
import { describe, expect, it } from "@jest/globals";
import { execFileSync, spawnSync } from "child_process";
import {
    mkdtempSync,
    readdirSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";

import {
    describeSSHKey,
    exportSSHPrivateKey,
    generateSSHKey,
    importSSHPrivateKey,
    sshPublicKeyLine,
} from "../vault-utils/ssh-key";

const hasSSHKeygen = spawnSync("ssh-keygen", ["-?"]).error === undefined;
const describeIfSSHKeygen = hasSSHKeygen ? describe : describe.skip;

const FIXTURES = join(__dirname, "fixtures", "ssh");
const PASSPHRASE = "correct horse";

const sshKeygen = (...args: string[]) =>
    execFileSync("ssh-keygen", args, { encoding: "utf8" }).trim();

const withTempDir = <T>(run: (dir: string) => T): T => {
    const dir = mkdtempSync(join(tmpdir(), "cryptex-ssh-"));
    try {
        return run(dir);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
};

const writeKey = (dir: string, name: string, contents: string) => {
    const path = join(dir, name);
    writeFileSync(path, contents, { mode: 0o600 });
    return path;
};

/** "SHA256:..." from ssh-keygen -l output: "<bits> <fingerprint> <comment> (<type>)". */
const keygenFingerprint = (path: string) =>
    sshKeygen("-l", "-f", path).split(" ")[1];

describeIfSSHKeygen("ssh-keygen cross-checks", () => {
    const publicFixtures = readdirSync(FIXTURES).filter((name) =>
        name.endsWith(".key.pub"),
    );

    it.each(publicFixtures)(
        "matches ssh-keygen's fingerprint for %s",
        async (pub) => {
            const keyFile = pub.slice(0, -".pub".length);
            const result = await importSSHPrivateKey(
                readFileSync(join(FIXTURES, keyFile), "utf8"),
                { passphrase: PASSPHRASE },
            );
            if (result.isErr()) {
                // Fixtures for unsupported ciphers have .pub files too.
                expect(result.error.code).toBe("unsupported-cipher");
                return;
            }
            expect(describeSSHKey(result.value)?.fingerprint).toBe(
                keygenFingerprint(join(FIXTURES, pub)),
            );
        },
    );

    it("produces keys that ssh-keygen reads and signs with", () =>
        withTempDir((dir) => {
            const data = generateSSHKey("cross-check");
            const keyPath = writeKey(
                dir,
                "id_ed25519",
                exportSSHPrivateKey(data),
            );
            expect(sshKeygen("-y", "-f", keyPath)).toBe(sshPublicKeyLine(data));
            expect(keygenFingerprint(keyPath)).toBe(
                describeSSHKey(data)?.fingerprint,
            );

            const message = writeKey(
                dir,
                "message.txt",
                "signed by Cryptex Vault\n",
            );
            sshKeygen("-Y", "sign", "-q", "-f", keyPath, "-n", "file", message);
            const allowed = writeKey(
                dir,
                "allowed_signers",
                `test@example.com ${sshPublicKeyLine(data)}\n`,
            );
            const verified = spawnSync(
                "ssh-keygen",
                [
                    "-Y",
                    "verify",
                    "-f",
                    allowed,
                    "-I",
                    "test@example.com",
                    "-n",
                    "file",
                    "-s",
                    `${message}.sig`,
                ],
                { input: readFileSync(message) },
            );
            expect(verified.status).toBe(0);
        }));

    it("produces passphrase-protected files that ssh-keygen opens", () =>
        withTempDir((dir) => {
            const data = generateSSHKey("protected");
            const keyPath = writeKey(
                dir,
                "id_ed25519",
                exportSSHPrivateKey(data, PASSPHRASE),
            );
            expect(sshKeygen("-y", "-P", PASSPHRASE, "-f", keyPath)).toBe(
                sshPublicKeyLine(data),
            );
            expect(
                spawnSync("ssh-keygen", ["-y", "-P", "wrong", "-f", keyPath])
                    .status,
            ).not.toBe(0);
        }));

    it("re-exports imported RSA and ECDSA keys that ssh-keygen accepts", async () => {
        for (const file of [
            "rsa-pkcs1.key",
            "ecdsa-sec1-nopub.key",
            "ecdsa-p521.key",
        ]) {
            const result = await importSSHPrivateKey(
                readFileSync(join(FIXTURES, file), "utf8"),
            );
            if (result.isErr()) throw result.error;
            withTempDir((dir) => {
                const keyPath = writeKey(
                    dir,
                    "key",
                    exportSSHPrivateKey(result.value),
                );
                expect(sshKeygen("-y", "-f", keyPath)).toBe(
                    sshPublicKeyLine(result.value),
                );
            });
        }
    });
});
