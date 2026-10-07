import assert from "node:assert/strict";
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const rules = JSON.parse(readFileSync(new URL("npm-cleanup.json", import.meta.url), "utf8"));
const checkoutRules = JSON.parse(readFileSync(new URL("checkout-cleanup.json", import.meta.url), "utf8"));
const sourceEdits = JSON.parse(readFileSync(new URL("npm-source-edits.json", import.meta.url), "utf8"));
const sha256 = value => createHash("sha256").update(value).digest("hex");

function inside(root, path) {
    const rel = relative(root, path);
    return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

// Remove reviewed unused binaries and host compilers rebuilt after scanning.
// The caller must provide an isolated Linux checkout with its own node_modules.
export function prepareSource(checkout, apply = false) {
    assert.ok(isAbsolute(checkout), "--checkout must be an absolute path");
    const root = realpathSync(checkout);
    const mobile = JSON.parse(readFileSync(join(root, "mobile/package.json"), "utf8"));
    assert.deepEqual(mobile.expo.autolinking.android.buildFromSource, [".*"],
        "Expo AAR removal requires all Android modules to build from source");
    assert.ok(existsSync(join(root, "mobile/android/app/build.gradle")),
        "Run Android prebuild before removing the Expo template");
    const store = join(root, "node_modules/.pnpm");
    assert.ok(inside(root, realpathSync(store)), "pnpm dependencies must belong to this checkout");
    const planned = [];
    const plan = (target, packageName) => {
        if (!existsSync(target)) return;
        assert.ok(!lstatSync(target).isSymbolicLink(), `Refusing linked removal: ${target}`);
        assert.ok(inside(root, realpathSync(target)), `Removal escapes checkout: ${target}`);
        planned.push({ path: relative(root, target), package: packageName });
    };
    for (const unused of checkoutRules) plan(join(root, unused), "checkout");

    for (const entry of readdirSync(store, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const modules = join(store, entry.name, "node_modules");
        if (!existsSync(modules)) continue;
        for (const child of readdirSync(modules, { withFileTypes: true })) {
            if (!child.isDirectory()) continue;
            const candidates = child.name.startsWith("@")
                ? readdirSync(join(modules, child.name), { withFileTypes: true })
                    .filter((item) => item.isDirectory())
                    .map((item) => join(modules, child.name, item.name))
                : [join(modules, child.name)];
            for (const pkg of candidates) {
                if (!existsSync(join(pkg, "package.json"))) continue;
                const manifest = JSON.parse(readFileSync(join(pkg, "package.json"), "utf8"));
                const key = `${manifest.name}@${manifest.version}`;
                for (const unused of rules[key] ?? []) {
                    const target = join(pkg, unused);
                    plan(target, key);
                }
                const edit = sourceEdits[key];
                if (edit) {
                    const target = join(pkg, edit.path);
                    assert.ok(!lstatSync(target).isSymbolicLink() && inside(root, realpathSync(target)),
                        `Source edit escapes checkout: ${target}`);
                    let contents = readFileSync(target, "utf8");
                    if (sha256(contents) === edit.preparedSha256) continue;
                    assert.equal(sha256(contents), edit.sha256, `Unreviewed source contents: ${key}/${edit.path}`);
                    for (const block of edit.remove) contents = contents.replace(block, "");
                    assert.equal(sha256(contents), edit.preparedSha256, `Source edit mismatch: ${key}/${edit.path}`);
                    planned.push({ path: relative(root, target), package: key, contents });
                }
            }
        }
    }

    // fdroidserver 2.4.5 misses non-executable .node files. Fail on unreviewed addons.
    for (const entry of readdirSync(store, { recursive: true, withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith(".node")) continue;
        const addon = relative(root, realpathSync(join(entry.parentPath, entry.name)));
        assert.ok(planned.some(item => addon === item.path || addon.startsWith(`${item.path}${sep}`)),
            `Unreviewed native Node addon: ${addon}`);
    }

    // Validate the full plan before removing any files.
    for (const item of planned) {
        if (apply) {
            const target = join(root, item.path);
            if (item.contents !== undefined) {
                // pnpm may hardlink package files to its cache. Replace the inode.
                const temporary = `${target}.fdroid-tmp`;
                writeFileSync(temporary, item.contents, { flag: "wx", mode: statSync(target).mode & 0o777 });
                try { renameSync(temporary, target); }
                finally { rmSync(temporary, { force: true }); }
            } else rmSync(target, { recursive: true });
        }
    }
    return planned;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const args = process.argv.slice(2);
    assert.ok(args.length === 2 || args.length === 3,
        "Usage: node mobile/fdroid/prepare-source.mjs --checkout /absolute/isolated-checkout [--apply]");
    assert.equal(args[0], "--checkout");
    assert.ok(args.length === 2 || args[2] === "--apply", "Unknown option");
    const apply = args[2] === "--apply";
    const planned = prepareSource(args[1], apply);
    for (const item of planned) console.log(`${apply ? "Prepared" : "Would prepare"}: ${item.path}`);
    console.log(`${planned.length} reviewed paths ${apply ? "prepared" : "listed"}. Run the F-Droid scanner next.`);
}
