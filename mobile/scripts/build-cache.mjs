import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

export const dependencyDirectories = ["", "mobile", "web", "packages/vault-core", "packages/api-contract", "packages/shared-ui"];

export function sourceFiles(checkout) {
    const env = { ...process.env };
    for (const name of ["CRYPTEX_KEYSTORE", "CRYPTEX_KEYSTORE_PASSWORD", "CRYPTEX_KEY_ALIAS", "CRYPTEX_KEY_PASSWORD"]) delete env[name];
    return [...new Set(execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: checkout, env, encoding: "utf8" }).split("\0"))]
        .filter(file => file && !/^mobile\/(?:android|ios)\//.test(file) &&
            !/(?:^|\/)(?:node_modules|dist|build|\.mobile-build|\.cxx|\.gradle|\.kotlin|\.expo|\.next|\.review-artifacts)(?:\/|$)/.test(file) &&
            !/(?:^|\/)\.env(?:\.|$)/.test(file) && !/\.(?:keystore|jks|p12|pfx)$/i.test(file) && !file.startsWith("mobile/e2e/results/"))
        .filter(file => existsSync(join(checkout, file))).sort();
}

export function writeIfChanged(file, contents) {
    const bytes = Buffer.isBuffer(contents) ? contents : Buffer.from(contents);
    if (existsSync(file) && readFileSync(file).equals(bytes)) return false;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, bytes);
    return true;
}

function ownedFile(root, file) {
    assert.ok(!isAbsolute(file) && file.split(/[\\/]/).every(part => part && part !== "." && part !== ".."), "Invalid cached source path.");
    return join(root, file);
}

export function synchronizeSources(checkout, destination, previousFiles = [], files = sourceFiles(checkout)) {
    const hashes = new Map();
    let changed = 0;
    let removed = 0;
    for (const file of files) {
        const source = ownedFile(checkout, file);
        const stat = lstatSync(source);
        assert.ok(stat.isFile() && !stat.isSymbolicLink(), `Source symlink requires review before publication: ${file}`);
        const bytes = readFileSync(source);
        hashes.set(file, createHash("sha256").update(bytes).digest("hex"));
        const target = ownedFile(destination, file);
        if (!existsSync(target) || !readFileSync(target).equals(bytes)) {
            mkdirSync(dirname(target), { recursive: true });
            // Copy the bytes we hashed, even if another agent edits the original
            // immediately afterwards. Never write back into the source checkout.
            writeFileSync(target, bytes);
            chmodSync(target, stat.mode & 0o777);
            changed++;
        }
    }
    for (const file of previousFiles) {
        if (!hashes.has(file)) {
            rmSync(ownedFile(destination, file), { force: true });
            removed++;
        }
    }
    const digest = predicate => {
        const hash = createHash("sha256");
        for (const [file, contentHash] of hashes) if (predicate(file)) hash.update(file).update("\0").update(contentHash).update("\0");
        return hash.digest("hex");
    };
    const dependencyInput = file => /(?:^|\/)package\.json$/.test(file) || /^(?:pnpm-lock\.yaml|pnpm-workspace\.yaml|\.npmrc|\.pnpmfile\.[cm]?js)$/.test(file) || file.startsWith("patches/");
    return {
        files: [...hashes.keys()], changed, removed,
        sourceHash: digest(() => true),
        dependencyHash: digest(dependencyInput),
        nativeHash: digest(file => dependencyInput(file) || /^mobile\/(?:app\.(?:json|config\.[cm]?[jt]s)|fingerprint\.config\.js|eas-project\.json)$/.test(file) || /^mobile\/(?:config|plugins|assets|modules|fdroid)\//.test(file)),
    };
}

export function openBuildWorkspace(checkout, { profile, distribution, arch = "all", offlineServices, clean, reproduceFrom }) {
    const root = join(checkout, ".mobile-build");
    mkdirSync(root, { recursive: true, mode: 0o700 });
    // Fresh builds are managed by the caller; only reusable workspaces need locks.
    assert.ok(!clean && !reproduceFrom && distribution !== "fdroid");
    const directory = join(root, `${profile}-${distribution}-${arch}${offlineServices ? "-offline" : ""}`);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const lock = join(directory, ".lock");
    if (existsSync(lock)) {
        const ownerFile = join(lock, "owner.json");
        assert.ok(existsSync(ownerFile), `This build workspace is already in use: ${directory}`);
        const owner = JSON.parse(readFileSync(ownerFile, "utf8"));
        assert.ok(Number.isSafeInteger(owner.pid) && owner.pid > 0, `Invalid build workspace lock: ${directory}`);
        let active = true;
        try { process.kill(owner.pid, 0); } catch (error) { if (error.code === "ESRCH") active = false; else throw error; }
        assert.ok(!active, `This build workspace is already in use by process ${owner.pid}: ${directory}`);
        rmSync(lock, { recursive: true });
    }
    try { mkdirSync(lock); } catch (error) {
        if (error.code === "EEXIST") throw new Error(`This build workspace is already in use: ${directory}`);
        throw error;
    }
    const stateFile = join(directory, "state.json");
    const staging = join(directory, "source");
    let state;
    try {
        writeFileSync(join(lock, "owner.json"), JSON.stringify({ pid: process.pid }));
        state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")) : {};
        mkdirSync(staging, { recursive: true });
    } catch (error) {
        rmSync(lock, { recursive: true, force: true });
        throw error;
    }
    return {
        staging,
        get state() { return state; },
        save(update) {
            state = { ...state, ...update };
            writeFileSync(`${stateFile}.tmp`, JSON.stringify(state) + "\n");
            renameSync(`${stateFile}.tmp`, stateFile);
        },
        close() { rmSync(lock, { recursive: true, force: true }); },
    };
}

export function invalidateDependencies(staging) {
    for (const directory of dependencyDirectories) rmSync(join(resolve(staging), directory, "node_modules"), { recursive: true, force: true });
}
