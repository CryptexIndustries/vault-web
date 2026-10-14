// Builds the release extension from a committed public configuration:
//   pnpm build:ext                          production (release-config.json)
//   pnpm build:ext -- --profile preprod     preproduction (prerelease-config.json)
//   pnpm build:ext -- --config <path>       a configuration of your own
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { loadReleaseConfig, parseBuildOptions } from "./release-config.mjs";

const extension = join(dirname(fileURLToPath(import.meta.url)), "..");

try {
    const options = parseBuildOptions(process.argv.slice(2));
    const config = loadReleaseConfig(options.configPath);
    console.log(
        `Building the ${options.profile} extension from ${relative(process.cwd(), options.configPath)}`,
    );

    // Values already in the environment override Vite's .env files, so the
    // configuration decides every value. Drop other VITE_ variables so a
    // stray shell variable can't reach the bundle.
    const env = Object.fromEntries(
        Object.entries(process.env).filter(([key]) => !key.startsWith("VITE_")),
    );
    Object.assign(env, config);

    rmSync(join(extension, "dist"), { recursive: true, force: true });
    for (const viteConfig of [
        "vite.config.ts",
        "vite.config.content.ts",
        "vite.config.passkey.ts",
    ]) {
        const result = spawnSync(
            "pnpm",
            [
                "exec",
                "vite",
                "build",
                "--mode",
                "production",
                "--config",
                viteConfig,
            ],
            { cwd: extension, env, stdio: "inherit" },
        );
        if (result.status !== 0) process.exit(result.status ?? 1);
    }
} catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
}
