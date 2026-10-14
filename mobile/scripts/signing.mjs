import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, X509Certificate } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseEnv } from "node:util";
import { getProfile } from "./release-config.mjs";

export const signingNames = ["CRYPTEX_KEYSTORE", "CRYPTEX_KEYSTORE_PASSWORD", "CRYPTEX_KEY_ALIAS", "CRYPTEX_KEY_PASSWORD"];

export function defaultSigningDirectory(profile = "production", home = homedir()) {
    return join(home, ".local/share/cryptex-vault", getProfile(profile).name === "production" ? "signing" : "signing-preprod");
}

function assertPrivateFile(path) {
    const info = lstatSync(path);
    assert.ok(info.isFile() && !info.isSymbolicLink(), "Signing credentials must be a regular file, not a symlink.");
    if (process.getuid) assert.equal(info.uid, process.getuid(), "Signing credentials must belong to the current user.");
    assert.equal(info.mode & 0o077, 0, "Signing credentials must not be readable or writable by group/others (chmod 600).");
    let directory = dirname(resolve(path));
    while (directory !== dirname(directory)) {
        assert.ok(!lstatSync(directory).isSymbolicLink(), "Signing credentials must not have a symlink parent.");
        directory = dirname(directory);
    }
}

export function loadSigningEnvironment(env, { profile = "production", home = homedir(), unsigned = false } = {}) {
    const path = join(defaultSigningDirectory(profile, home), "signing.env");
    const loaded = {};
    if (!unsigned && existsSync(path)) {
        assertPrivateFile(path);
        const parsed = parseEnv(readFileSync(path, "utf8"));
        for (const [name, value] of Object.entries(parsed)) {
            assert.ok(signingNames.includes(name), `Unexpected key in signing.env: ${name}`);
            loaded[name] = value;
        }
    }
    const result = { ...env, ...loaded };
    for (const name of signingNames) {
        if (env[name] !== undefined) result[name] = env[name];
        if (unsigned) delete result[name];
        else assert.ok(result[name], `Missing ${name}. Run signing setup for ${profile}; expected credentials at ${path}.`);
    }
    if (!unsigned) {
        result.CRYPTEX_KEYSTORE = resolve(result.CRYPTEX_KEYSTORE);
        assertPrivateFile(result.CRYPTEX_KEYSTORE);
    }
    return result;
}

export function validateSigningIdentity(env, identity, { unsigned = false, run = spawnSync } = {}) {
    const publicCert = new X509Certificate(Buffer.from(identity.certificateDerBase64, "base64"));
    assert.equal(createHash("sha256").update(publicCert.raw).digest("hex"), identity.certificateSha256, "Public signing identity is inconsistent.");
    if (unsigned) return;
    assert.equal(env.CRYPTEX_KEY_ALIAS, identity.alias, "Release key alias differs from the profile's public signing identity.");
    const inspectionEnv = { ...env };
    const result = run(join(env.JAVA_HOME, "bin/keytool"), ["-exportcert", "-keystore", env.CRYPTEX_KEYSTORE,
        "-storepass:env", "CRYPTEX_KEYSTORE_PASSWORD", "-alias", identity.alias], { env: inspectionEnv });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, "Cannot inspect the selected signing key. Check its credential file.");
    const certificate = new X509Certificate(result.stdout);
    assert.equal(createHash("sha256").update(certificate.raw).digest("hex"), identity.certificateSha256, "Selected signing key differs from the profile's approved public identity.");
}
