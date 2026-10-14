import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const extension = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Each release profile builds from one committed public configuration. */
export const PROFILES = Object.freeze({
    production: "release-config.json",
    preprod: "prerelease-config.json",
});

/**
 * Every value the extension build reads. A configuration must set all of
 * them, so a local .env file can't fill a gap in a release build.
 */
export const CONFIG_KEYS = Object.freeze([
    "VITE_APP_URL",
    "VITE_ONLINE_SERVICES_API_URL",
    "VITE_CLOUD_ENABLED",
    "VITE_PUSHER_APP_ID",
    "VITE_PUSHER_APP_KEY",
    "VITE_PUSHER_APP_HOST",
    "VITE_PUSHER_APP_PORT",
    "VITE_PUSHER_APP_TLS",
    "VITE_EXTENSION_NAME_PREFIX",
]);

/** Checks the shape; vite.config.ts checks the values of production builds. */
export function validateReleaseConfig(
    config,
    source = "release configuration",
) {
    if (!config || typeof config !== "object" || Array.isArray(config)) {
        throw new Error(`${source} must be a JSON object.`);
    }
    for (const [key, value] of Object.entries(config)) {
        if (!CONFIG_KEYS.includes(key)) {
            throw new Error(
                `${source} has ${key}, which the extension doesn't read. Only public VITE_ values belong here.`,
            );
        }
        if (typeof value !== "string") {
            throw new Error(`${source}: ${key} must be a string.`);
        }
    }
    const missing = CONFIG_KEYS.filter((key) => !(key in config));
    if (missing.length) {
        throw new Error(
            `${source} is missing ${missing.join(", ")}. Use "" for values you don't need.`,
        );
    }
    return config;
}

export function loadReleaseConfig(path) {
    let config;
    try {
        config = JSON.parse(readFileSync(path, "utf8"));
    } catch (error) {
        throw new Error(`Can't read ${path}: ${error.message}`);
    }
    return validateReleaseConfig(config, path);
}

export function parseBuildOptions(args, cwd = process.cwd()) {
    const options = { profile: "production" };
    const seen = new Set();
    for (let index = 0; index < args.length; index++) {
        const arg = args[index];
        if (arg === "--") continue;
        if (!["--profile", "--config"].includes(arg) || seen.has(arg)) {
            throw new Error(
                `Invalid or repeated option: ${arg}. Use --profile production|preprod and optionally --config <path>.`,
            );
        }
        seen.add(arg);
        const value = args[++index];
        if (!value || value.startsWith("--")) {
            throw new Error(`${arg} requires a value.`);
        }
        if (arg === "--profile") options.profile = value;
        else options.configPath = resolve(cwd, value);
    }
    if (!Object.hasOwn(PROFILES, options.profile)) {
        throw new Error(
            `Unknown profile: ${options.profile}. Choose production or preprod.`,
        );
    }
    options.configPath ??= join(extension, PROFILES[options.profile]);
    return options;
}
