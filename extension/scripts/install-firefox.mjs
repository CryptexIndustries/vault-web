// Downloads the Firefox release the Firefox e2e tests run on, checks it
// against the SHA-512 Mozilla published for it and prints the executable.
//   node extension/scripts/install-firefox.mjs
// To update, take the linux-x86_64/en-US line from
// https://archive.mozilla.org/pub/firefox/releases/<version>/SHA512SUMS.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";

const VERSION = "159.0.1";
const SHA512 =
    "76ed0cce9d298e1a4450e497947a40a2ad9d11a4ced1bb6c823f02d5f8a30d891ff63e7f6c1bde6f127cf4bc02ec8c9342a90c00c8b0d6bc633845d3fdbec623";

const directory = path.join(
    os.homedir(),
    ".cache",
    "cryptex-vault-e2e",
    `firefox-${VERSION}`,
);
export const firefoxExecutable = path.join(directory, "firefox", "firefox");

async function install() {
    if (fs.existsSync(firefoxExecutable)) return;
    if (process.platform !== "linux" || process.arch !== "x64") {
        throw new Error(
            "Only Linux x64 is downloaded. Set CRYPTEX_FIREFOX_PATH to a Firefox executable instead.",
        );
    }
    const url = `https://archive.mozilla.org/pub/firefox/releases/${VERSION}/linux-x86_64/en-US/firefox-${VERSION}.tar.xz`;
    // Unpacked in a staging folder and moved into place, so an interrupted
    // run never leaves a partial Firefox that later runs take as installed.
    fs.mkdirSync(directory, { recursive: true });
    const staging = fs.mkdtempSync(path.join(directory, "staging-"));
    try {
        await download(url, staging);
        fs.rmSync(path.dirname(firefoxExecutable), {
            recursive: true,
            force: true,
        });
        fs.renameSync(
            path.join(staging, "firefox"),
            path.dirname(firefoxExecutable),
        );
    } finally {
        fs.rmSync(staging, { recursive: true, force: true });
    }
}

async function download(url, staging) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    const archive = path.join(staging, "firefox.tar.xz");
    const hash = createHash("sha512");
    await pipeline(
        Readable.fromWeb(response.body),
        async function* (chunks) {
            for await (const chunk of chunks) {
                hash.update(chunk);
                yield chunk;
            }
        },
        fs.createWriteStream(archive),
    );
    const actual = hash.digest("hex");
    if (actual !== SHA512) {
        throw new Error(`${url} has SHA-512 ${actual}, expected ${SHA512}`);
    }
    const tar = spawnSync("tar", ["-xJf", archive, "-C", staging], {
        stdio: "inherit",
    });
    if (tar.status !== 0) throw new Error("Couldn't unpack Firefox");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        await install();
        console.log(firefoxExecutable);
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
