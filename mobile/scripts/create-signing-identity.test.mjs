import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const helper = fileURLToPath(new URL("./create-signing-identity.mjs", import.meta.url));
const repository = fileURLToPath(new URL("../../", import.meta.url));

test("signing setup refuses private material inside the repository", () => {
    for (const directory of [repository, join(repository, "mobile/release-test")]) {
        const result = spawnSync(process.execPath, [helper, directory], { encoding: "utf8" });
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /outside the repository/);
        assert.equal(result.stdout, "");
    }
});

test("signing setup does not overwrite an existing identity directory", () => {
    const directory = mkdtempSync(join(tmpdir(), "cryptex-signing-refusal-"));
    try {
        const identity = join(directory, "identity");
        mkdirSync(identity, { mode: 0o700 });
        const marker = join(identity, "release.p12");
        writeFileSync(marker, "existing identity", { mode: 0o600 });
        const result = spawnSync(process.execPath, [helper, identity], { encoding: "utf8" });
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /EEXIST/);
        assert.equal(readFileSync(marker, "utf8"), "existing identity");
        assert.equal(result.stdout, "");
    } finally {
        rmSync(directory, { recursive: true });
    }
});

test("signing setup refuses a symlink parent", () => {
    const directory = mkdtempSync(join(tmpdir(), "cryptex-signing-parent-"));
    try {
        symlinkSync(directory, join(directory, "linked"), "dir");
        const result = spawnSync(process.execPath, [helper, join(directory, "linked/signing")], { encoding: "utf8" });
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /locally owned directory parent/);
        assert.equal(result.stdout, "");
    } finally {
        rmSync(directory, { recursive: true });
    }
});
