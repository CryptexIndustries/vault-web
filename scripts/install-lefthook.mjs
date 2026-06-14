import { spawnSync } from "node:child_process";

const skip = (reason) => {
    console.log(`Skipping lefthook install: ${reason}.`);
};

const hasGit = spawnSync("git", ["--version"], { stdio: "ignore" });

if (hasGit.error?.code === "ENOENT") {
    skip("git is not available");
    process.exit(0);
}

if (hasGit.status !== 0) {
    skip("git version check failed");
    process.exit(0);
}

const inWorkTree = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
    encoding: "utf8",
});

if (inWorkTree.status !== 0 || inWorkTree.stdout.trim() !== "true") {
    skip("current directory is not a git worktree");
    process.exit(0);
}

const install = spawnSync("lefthook", ["install"], {
    stdio: "inherit",
    shell: process.platform === "win32",
});

if (install.error) {
    console.error(install.error.message);
    process.exit(1);
}

process.exit(install.status ?? 1);
