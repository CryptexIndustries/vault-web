import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync } from "node:fs";
import { createHash, X509Certificate } from "node:crypto";
import { join } from "node:path";

export function buildPlayBundle({
    unsignedBundle,
    output,
    unsigned,
    env,
    metadata,
}) {
    const inspectEnv = { ...env };
    for (const name of Object.keys(inspectEnv))
        if (name.startsWith("CRYPTEX_KEY")) delete inspectEnv[name];
    if (unsigned) copyFileSync(unsignedBundle, output);
    else {
        const credentials = [
            "-keystore",
            env.CRYPTEX_KEYSTORE,
            "-storepass:env",
            "CRYPTEX_KEYSTORE_PASSWORD",
        ];
        const jarsigner = join(env.JAVA_HOME, "bin/jarsigner");
        execFileSync(
            jarsigner,
            [
                ...credentials,
                "-keypass:env",
                "CRYPTEX_KEY_PASSWORD",
                "-digestalg",
                "SHA-256",
                "-sigalg",
                "SHA256withRSA",
                "-signedjar",
                output,
                unsignedBundle,
                env.CRYPTEX_KEY_ALIAS,
            ],
            { env, stdio: "pipe" },
        );
        // Trust the approved upload certificate and reject unsigned/tampered entries.
        execFileSync(
            jarsigner,
            ["-verify", "-strict", ...credentials, output],
            { env, stdio: "pipe" },
        );
        const certificate = execFileSync(
            join(env.JAVA_HOME, "bin/keytool"),
            ["-printcert", "-jarfile", output, "-rfc"],
            { env: inspectEnv },
        );
        const signer = new X509Certificate(certificate);
        assert.equal(
            createHash("sha256").update(signer.raw).digest("hex"),
            metadata.signer.certificateSha256,
            "Unapproved AAB signer.",
        );
    }
    console.log(`Google Play AAB: ${output}`);
    return output;
}
