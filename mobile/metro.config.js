const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");
const path = require("node:path");

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, "..");

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(projectRoot);
const localBuildJobs = Number(process.env.CRYPTEX_LOCAL_BUILD_JOBS);
if (Number.isSafeInteger(localBuildJobs) && localBuildJobs > 0) {
    config.maxWorkers = localBuildJobs;
}
// A development Metro server must not crawl copies belonging to release builds.
const localBuildDirectory = path
    .join(monorepoRoot, ".mobile-build")
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const existingBlockList = config.resolver.blockList;
config.resolver.blockList = [
    ...(Array.isArray(existingBlockList)
        ? existingBlockList
        : existingBlockList
          ? [existingBlockList]
          : []),
    new RegExp(`^${localBuildDirectory}(?:[/\\\\]|$)`),
];

config.watchFolders = [monorepoRoot];
config.resolver.nodeModulesPaths = [
    path.resolve(projectRoot, "node_modules"),
    path.resolve(monorepoRoot, "node_modules"),
];
// Keep hierarchical lookup for pnpm nested package deps (expo-router → @expo/metro-runtime).
config.resolver.disableHierarchicalLookup = false;

config.resolver.extraNodeModules = {
    ...config.resolver.extraNodeModules,
    crypto: require.resolve("react-native-quick-crypto"),
    stream: require.resolve("readable-stream"),
    buffer: require.resolve("@craftzdog/react-native-buffer"),
};

const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
    if (moduleName === "crypto") {
        return context.resolveRequest(
            context,
            "react-native-quick-crypto",
            platform,
        );
    }

    // libsodium-wrappers-sumo needs WASM; use native Argon2 + JS secretstream shim.
    if (
        moduleName === "libsodium-wrappers-sumo" ||
        moduleName === "libsodium-sumo"
    ) {
        return {
            filePath: path.resolve(
                projectRoot,
                "src/shims/libsodium-wrappers-sumo.ts",
            ),
            type: "sourceFile",
        };
    }

    if (defaultResolveRequest) {
        return defaultResolveRequest(context, moduleName, platform);
    }
    return context.resolveRequest(context, moduleName, platform);
};

config.resolver.assetExts = config.resolver.assetExts.filter(
    (ext) => ext !== "wasm",
);
config.resolver.sourceExts = [...config.resolver.sourceExts, "wasm"];

// Generate the isolated worker from shared source whenever Metro starts.
module.exports = require("./scripts/build-security-worker.cjs")
    .buildSecurityWorker()
    .then(() => withNativeWind(config, { input: "./global.css" }));
