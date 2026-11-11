// iOS suites that use the Files screens. Maestro prepares each vault, a native
// XCUITest drives those screens and this script checks the saved files.
import { spawnSync } from "node:child_process";
import {
    copyFileSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
    EXPORT_PREFIX,
    filesDirectory,
    flow,
    resultsDirectory,
    savedFile,
    test,
    xcode,
} from "./ios-simulator.mjs";

const SECRET = "transfer-password-42";
const SSH_KEY = "ed25519-aes256-ctr";
const sshFixtures = fileURLToPath(
    new URL(
        "../../packages/vault-core/src/tests/fixtures/ssh/",
        import.meta.url,
    ),
);

const saved = (stem) => readFileSync(savedFile(stem));

async function importExport() {
    await xcode("build-for-testing");
    await flow("ios-transfer-setup.yaml");
    await test("testExport");
    if (saved(`${EXPORT_PREFIX}-encrypted`).includes(SECRET))
        throw new Error("The encrypted export contains a readable secret.");
    if (!saved(`${EXPORT_PREFIX}-readable`).includes(SECRET))
        throw new Error("The readable export is missing the saved login.");
    await flow("clear-state.yaml");
    await test("testRestore");
    await flow("setup-vault.yaml");
    await test("testImportReadableExport");
}

async function sshKeys() {
    copyFileSync(
        join(sshFixtures, `${SSH_KEY}.key`),
        join(filesDirectory(), `${EXPORT_PREFIX}-key.key`),
    );
    await xcode("build-for-testing");
    await flow("setup-vault.yaml");
    await test("testSshKeys");
    const work = mkdtempSync(join(tmpdir(), "cryptex-ios-ssh-"));
    try {
        const key = join(work, "id_key");
        writeFileSync(key, saved(`${EXPORT_PREFIX}-saved`), { mode: 0o600 });
        const decrypt = (passphrase) =>
            spawnSync("ssh-keygen", ["-y", "-P", passphrase, "-f", key], {
                encoding: "utf8",
            });
        if (decrypt("").status === 0)
            throw new Error("The saved private key is not encrypted.");
        const publicKey = (line) => line.split(" ").slice(0, 2).join(" ");
        const expected = readFileSync(
            join(sshFixtures, `${SSH_KEY}.key.pub`),
            "utf8",
        );
        if (publicKey(decrypt("export horse").stdout) !== publicKey(expected))
            throw new Error(
                "The saved private key differs from the imported key.",
            );
    } finally {
        rmSync(work, { recursive: true, force: true });
    }
}

mkdirSync(resultsDirectory, { recursive: true });
await { "import-export": importExport, "ssh-keys": sshKeys }[process.argv[2]]();
