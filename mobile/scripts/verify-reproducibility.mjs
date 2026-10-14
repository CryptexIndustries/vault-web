import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { verifyRelease } from "./verify-release.mjs";
import { getProfile, loadReleaseConfig, parseReleaseOptions } from "./release-config.mjs";

const mobile = fileURLToPath(new URL("../", import.meta.url));
export const apkSha256 = path => createHash("sha256").update(readFileSync(path)).digest("hex");

export function reproductionOptions(args, cwd = process.cwd()) {
    const paths = [];
    const releaseArgs = [];
    for (let index = 0; index < args.length; index++) {
        const arg = args[index];
        if (!arg.startsWith("--")) { assert.ok(arg.trim(), "APK path must not be empty."); paths.push(resolve(cwd, arg)); }
        else {
            assert.ok(["--profile", "--config", "--distribution", "--offline-services"].includes(arg), "Unknown reproduction option.");
            releaseArgs.push(arg);
            if (arg !== "--offline-services") releaseArgs.push(args[++index]);
        }
    }
    assert.equal(paths.length, 3, "Specify signed-reference.apk first-unsigned.apk independent-unsigned.apk.");
    const options = parseReleaseOptions(releaseArgs, { cwd });
    const [signed, firstUnsigned, secondUnsigned] = paths;
    return { ...options, signed, firstUnsigned, secondUnsigned };
}

export function assertReproductionTools(env = process.env) {
    const inspectionEnv = { ...env };
    for (const name of ["CRYPTEX_KEYSTORE", "CRYPTEX_KEYSTORE_PASSWORD", "CRYPTEX_KEY_ALIAS", "CRYPTEX_KEY_PASSWORD"]) delete inspectionEnv[name];
    const toolchain = JSON.parse(readFileSync(join(mobile, "fdroid/toolchain.json"), "utf8"));
    const python = inspectionEnv.CRYPTEX_REPRODUCTION_PYTHON || "python3";
    const pythonVersion = execFileSync(python, ["--version"], { env: inspectionEnv, encoding: "utf8" }).trim();
    assert.equal(pythonVersion, `Python ${toolchain.reproductionPython}`, `Use Python ${toolchain.reproductionPython}; set CRYPTEX_REPRODUCTION_PYTHON to its executable.`);
    const copierArgs = ["-c", "from apksigcopier import main; raise SystemExit(main())"];
    const version = execFileSync(python, [...copierArgs, "--version"], { env: inspectionEnv, encoding: "utf8" }).trim();
    assert.equal(version, `apksigcopier, version ${toolchain.apksigcopier}`, "Use the pinned apksigcopier version");
    return { python, copierArgs, env: inspectionEnv };
}

export function reconstructSignedReference(signed, unsigned, reconstructed, { configPath, config, referenceSha256, ...options } = {}) {
    config ??= loadReleaseConfig(configPath ?? join(mobile, getProfile(options.profile ?? "production").configFile));
    assert.equal(new Set([signed, unsigned, reconstructed].map(path => resolve(path))).size, 3, "Reconstruction requires distinct artifact paths.");
    assert.ok(!existsSync(reconstructed), "Reconstruction destination already exists.");
    const { python, copierArgs, env: inspectionEnv } = assertReproductionTools(options.env);
    const policy = { ...options, unsigned: false, config, env: inspectionEnv };
    verifyRelease(signed, policy);
    verifyRelease(unsigned, { ...policy, unsigned: true });
    referenceSha256 ??= apkSha256(signed);
    assert.equal(apkSha256(signed), referenceSha256, "Reference APK changed during reproduction.");
    execFileSync(python, [...copierArgs, "copy", signed, unsigned, reconstructed], { env: inspectionEnv, stdio: "inherit" });
    verifyRelease(reconstructed, policy);
    assert.equal(apkSha256(signed), referenceSha256, "Reference APK changed during signature copying.");
    assert.ok(readFileSync(reconstructed).equals(readFileSync(signed)), "Reconstructed signed APK differs from the reference byte-for-byte");
}

export function verifyReproducibility(signed, firstUnsigned, secondUnsigned, { configPath, config, ...options } = {}) {
    config ??= loadReleaseConfig(configPath ?? join(mobile, getProfile(options.profile ?? "production").configFile));
    const artifacts = [signed, firstUnsigned, secondUnsigned];
    assert.equal(new Set(artifacts.map(path => resolve(path))).size, 3, "Reproduction requires three distinct artifact paths.");
    assert.ok(readFileSync(firstUnsigned).equals(readFileSync(secondUnsigned)), "Independent unsigned APKs differ byte-for-byte");
    assert.equal(new Set(artifacts.map(path => realpathSync(path))).size, 3, "Reproduction requires distinct real artifacts, not symlink aliases.");
    const identities = artifacts.map(path => { const stat = statSync(path); assert.ok(stat.isFile(), "APK artifact must be a regular file."); return `${stat.dev}:${stat.ino}`; });
    assert.equal(new Set(identities).size, 3, "Reproduction requires independent files, not hard-link aliases.");
    // Check the toolchain before any external APK inspection.
    assertReproductionTools(options.env);
    verifyRelease(firstUnsigned, { ...options, config, unsigned: true });
    const temporary = mkdtempSync(join(tmpdir(), "cryptex-signature-reproduction-"));
    try {
        const reconstructed = join(temporary, "reconstructed.apk");
        // Copy the published signature onto the independent unsigned build,
        // then verify the signature and require exact published APK bytes.
        reconstructSignedReference(signed, secondUnsigned, reconstructed, { ...options, config });
        console.log(`Unsigned SHA-256: ${apkSha256(firstUnsigned)}`);
        console.log(`Signed SHA-256: ${apkSha256(signed)}`);
        console.log("Independent unsigned bytes and reconstructed signed APK match exactly.");
    } finally {
        rmSync(temporary, { recursive: true, force: true });
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    try {
        const { signed, firstUnsigned, secondUnsigned, ...options } = reproductionOptions(process.argv.slice(2));
        verifyReproducibility(signed, firstUnsigned, secondUnsigned, options);
    } catch (error) { console.error(error.message); process.exitCode = 1; }
}
