const { build } = require("esbuild");
const fs = require("node:fs");
const path = require("node:path");

// Keep the exact shared analysis/scorer in a self-contained worker program.
// The string is evaluated only on the background runtime, including zxcvbn setup.
async function buildSecurityWorker() {
    const result = await build({
        absWorkingDir: path.resolve(__dirname, ".."),
        entryPoints: ["src/workers/security-analysis.ts"],
        bundle: true,
        write: false,
        format: "iife",
        platform: "browser",
        target: "es2020",
        minify: true,
        define: { global: "globalThis" },
        treeShaking: true,
        metafile: true,
        plugins: [
            {
                name: "analysis-only",
                setup(build) {
                    // Shared utilities also export crypto/URL-matching helpers. None
                    // of their import-time initialization belongs in this worker.
                    build.onResolve(
                        { filter: /^(?:\.\/encryption|psl)$/ },
                        (args) => ({
                            path: args.path,
                            external: true,
                            sideEffects: false,
                        }),
                    );
                },
            },
        ],
    });
    if (
        Object.values(result.metafile.outputs).some(
            (output) => output.imports.length,
        )
    ) {
        throw new Error("Security worker must not depend on external modules");
    }
    const output = path.resolve(
        __dirname,
        "../src/workers/security-analysis.generated.json",
    );
    const contents = JSON.stringify(result.outputFiles[0].text);
    if (
        !fs.existsSync(output) ||
        fs.readFileSync(output, "utf8") !== contents
    ) {
        fs.writeFileSync(output, contents);
    }
    return result;
}
module.exports = { buildSecurityWorker };
if (require.main === module) buildSecurityWorker();
