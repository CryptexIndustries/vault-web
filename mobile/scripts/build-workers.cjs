const { build } = require("esbuild");
const fs = require("node:fs");
const path = require("node:path");

// Each worker is a self-contained program, evaluated only on its own
// background runtime, so its initialization never runs on the RN thread.
const WORKERS = [
    {
        // The exact shared analysis/scorer, including zxcvbn setup.
        name: "security-analysis",
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
    },
    // SSH key import and export: parsing, key derivation and encryption.
    { name: "ssh-key", plugins: [] },
];

async function buildWorker({ name, plugins }) {
    const result = await build({
        absWorkingDir: path.resolve(__dirname, ".."),
        entryPoints: [`src/workers/${name}.ts`],
        bundle: true,
        write: false,
        format: "iife",
        platform: "browser",
        target: "es2020",
        minify: true,
        define: { global: "globalThis" },
        treeShaking: true,
        metafile: true,
        plugins,
    });
    if (
        Object.values(result.metafile.outputs).some(
            (output) => output.imports.length,
        )
    ) {
        throw new Error(`The ${name} worker must not depend on external modules`);
    }
    const output = path.resolve(
        __dirname,
        `../src/workers/${name}.generated.json`,
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

function buildWorkers() {
    return Promise.all(WORKERS.map(buildWorker));
}

module.exports = { buildWorkers };
if (require.main === module) {
    buildWorkers().catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
}
