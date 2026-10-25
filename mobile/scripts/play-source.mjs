import assert from "node:assert/strict";
import {
    lstatSync,
    readdirSync,
    readFileSync,
    realpathSync,
    rmSync,
} from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";

const packages = {
    "react-native-purchases": "10.11.0",
    "@revenuecat/purchases-js-hybrid-mappings": "19.5.0",
    "@revenuecat/purchases-typescript-internal": "19.5.0",
    "@revenuecat/purchases-js": "1.67.1",
};
const sources = [
    "mobile/config/play-dependencies.gradle",
    "mobile/config/play-verification-metadata.xml",
    "mobile/src/app_lib/google-play-billing.ts",
];

function inside(root, path) {
    const rel = relative(root, path);
    return (
        rel !== "" &&
        rel !== ".." &&
        !rel.startsWith(`..${sep}`) &&
        !isAbsolute(rel)
    );
}

// This runs in the isolated native-build checkout, before source scanning.
export function preparePlayFreeSource(checkout, apply = false) {
    assert.ok(
        isAbsolute(checkout),
        "Play source preparation requires an absolute checkout path",
    );
    const root = realpathSync(checkout);
    const validate = (target) => {
        let path = root,
            stat;
        for (const segment of relative(root, target).split(sep)) {
            path = join(path, segment);
            stat = lstatSync(path, { throwIfNoEntry: false });
            if (!stat) return;
            assert.ok(
                !stat.isSymbolicLink(),
                `Refusing linked Play source: ${path}`,
            );
        }
        assert.ok(
            inside(root, realpathSync(target)),
            `Play source escapes checkout: ${target}`,
        );
        return stat;
    };
    for (const source of [
        "mobile/android/app/build.gradle",
        "mobile/android/gradle/wrapper/gradle-wrapper.properties",
    ]) {
        assert.ok(
            validate(join(root, source))?.isFile(),
            "Run Android prebuild before preparing Play-free source",
        );
    }
    const store = join(root, "node_modules/.pnpm");
    assert.ok(
        validate(store),
        "Play source preparation requires an isolated pnpm store",
    );
    const planned = [];
    const plan = (target, packageName) => {
        if (validate(target))
            planned.push({
                path: relative(root, target),
                package: packageName,
            });
    };
    for (const source of sources) plan(join(root, source), "checkout");

    for (const entry of readdirSync(store, { withFileTypes: true })) {
        const name = Object.keys(packages).find((name) =>
            entry.name.startsWith(`${name.replace("/", "+")}@`),
        );
        if (!name) continue;
        const directory = join(store, entry.name);
        assert.ok(
            validate(directory) && entry.isDirectory(),
            `Invalid Play package directory: ${directory}`,
        );
        const pkg = join(directory, "node_modules", name);
        if (!validate(pkg)) continue;
        const manifestPath = join(pkg, "package.json");
        assert.ok(
            validate(manifestPath),
            `Missing Play package manifest: ${pkg}`,
        );
        const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
        assert.equal(
            manifest.name,
            name,
            `Unexpected Play package identity: ${pkg}`,
        );
        assert.equal(
            manifest.version,
            packages[name],
            `Unreviewed Play package version: ${name}@${manifest.version}`,
        );
        plan(pkg, `${name}@${manifest.version}`);
    }

    // An unsafe path or unreviewed upgrade must leave the entire checkout intact.
    if (apply)
        for (const item of planned)
            rmSync(join(root, item.path), { recursive: true });
    return planned;
}
