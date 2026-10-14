import test from "node:test";
import assert from "node:assert/strict";
import { createRequire, Module } from "node:module";
import { readFileSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { embeddedManifestEnvironment } from "./build-android.mjs";
import { assertEmbeddedUpdate } from "./verify-release.mjs";

const require = createRequire(import.meta.url);
const generatorFile = join(dirname(require.resolve("expo-updates/package.json")), "utils/build/createManifestForBuildAsync.js");
const controls = ["CRYPTEX_EMBEDDED_UPDATE_ID", "CRYPTEX_EMBEDDED_UPDATE_COMMIT_TIME"];
const replay = { id: "f6b07b79-15c9-4c88-a930-b508cf51d79f", commitTime: "1790549889123" };
const fixtureAssets = [
    { name: "logo", type: "png", scales: [1, 2], fileHashes: ["logo-small", "logo-large"], httpServerLocation: "/assets/icons" },
    { name: "font", type: "ttf", scales: [1], fileHashes: ["font"], httpServerLocation: "/assets/fonts" },
];

async function generate(options = replay, { assets = fixtureAssets, failAssets = false, clock = null } = {}) {
    const root = mkdtempSync(join(tmpdir(), "cryptex-embedded-manifest-"));
    const project = join(root, "project"); const output = join(root, "output");
    mkdirSync(project); mkdirSync(output);
    const previousEnvironment = controls.map(name => process.env[name]);
    const previousCwd = process.cwd(); const OriginalDate = globalThis.Date;
    let metroCalls = 0; let metroEnded = 0; let randomCalls = 0;
    const compiled = new Module(generatorFile);
    compiled.filename = generatorFile; compiled.paths = Module._nodeModulePaths(dirname(generatorFile));
    compiled.require = name => {
        if (name === "crypto") return {
            ...require("node:crypto"), randomUUID() { randomCalls++; return require("node:crypto").randomUUID(); },
        };
        if (name === "expo/config/paths") return { resolveEntryPoint: () => "index.js" };
        if (name === "expo/internal/unstable-expo-updates-cli-exports") return {
            drawableFileTypes: new Set(["png"]),
            createMetroServerAndBundleRequestAsync: async () => { metroCalls++; return { server: { end() { metroEnded++; } }, bundleRequest: {} }; },
            exportEmbedAssetsAsync: async () => { if (failAssets) throw new Error("fixture Metro failure"); return structuredClone(assets); },
        };
        return Module.createRequire(generatorFile)(name);
    };
    compiled._compile(readFileSync(generatorFile, "utf8"), generatorFile);
    try {
        for (const name of controls) delete process.env[name];
        if (options.id !== undefined) process.env[controls[0]] = options.id;
        if (options.commitTime !== undefined) process.env[controls[1]] = options.commitTime;
        if (clock !== null) globalThis.Date = class extends OriginalDate {
            constructor(...args) { super(...(args.length ? args : [clock])); }
        };
        await compiled.exports.createManifestForBuildAsync("android", project, output);
        const bytes = readFileSync(join(output, "app.manifest"));
        const { readEmbeddedManifestAsync } = require("eas-cli/build/update/embeddedManifest.js");
        const parsedByEas = await readEmbeddedManifestAsync(join(output, "app.manifest"));
        return { bytes, manifest: JSON.parse(bytes), parsedByEas, metroCalls, metroEnded, randomCalls };
    } catch (error) {
        error.fixtureState = { metroCalls, metroEnded, randomCalls }; throw error;
    } finally {
        globalThis.Date = OriginalDate; process.chdir(previousCwd);
        for (let index = 0; index < controls.length; index++) {
            if (previousEnvironment[index] === undefined) delete process.env[controls[index]];
            else process.env[controls[index]] = previousEnvironment[index];
        }
        rmSync(root, { recursive: true, force: true });
    }
}

test("actual Expo generator replays the exact public UUID and milliseconds across paths and clocks", async () => {
    const first = await generate(replay, { clock: 946684800000 });
    const second = await generate(replay, { clock: 2208988800000 });
    assert.deepEqual(first.bytes, second.bytes);
    assert.equal(first.manifest.id, replay.id);
    assert.equal(first.manifest.commitTime, 1790549889123);
    assert.equal(first.parsedByEas.id, replay.id);
    assert.equal(first.randomCalls, 0); assert.equal(second.randomCalls, 0);
    assert.equal(first.metroCalls, 1); assert.equal(first.metroEnded, 1);
});

test("F-Droid manifests repeat across clocks and paths while standard profiles retain fresh identities", async () => {
    const metadata = { distribution: "fdroid", sourceRevision: { commit: "a".repeat(40), dirty: false }, configHash: "b".repeat(64), version: { name: "0.1.0", code: 1 } };
    const environment = embeddedManifestEnvironment(metadata);
    const options = { id: environment.CRYPTEX_EMBEDDED_UPDATE_ID, commitTime: environment.CRYPTEX_EMBEDDED_UPDATE_COMMIT_TIME };
    const first = await generate(options, { clock: 946684800000 });
    const second = await generate(options, { clock: 2208988800000 });
    assert.deepEqual(first.bytes, second.bytes);
    assert.deepEqual(assertEmbeddedUpdate(first.manifest), { id: options.id, commitTime: 0 });
    assert.equal(first.parsedByEas.id, options.id);
    for (const changed of [
        { ...metadata, sourceRevision: { commit: "c".repeat(40), dirty: false } },
        { ...metadata, configHash: "d".repeat(64) },
        { ...metadata, version: { name: "0.2.0", code: 2 } },
    ]) assert.notDeepEqual(embeddedManifestEnvironment(changed), environment);
    for (const profile of ["production", "preprod"]) {
        assert.deepEqual(embeddedManifestEnvironment({ ...metadata, distribution: "standard", profile }), {});
        const fresh = await generate({}, { clock: 946684800000 });
        assert.equal(fresh.randomCalls, 1);
        assert.equal(fresh.manifest.commitTime, 946684800000);
    }
});

test("replay fields stay exact when assets change; asset order and contents remain upstream", async () => {
    const original = await generate();
    const changedAssets = structuredClone(fixtureAssets).reverse(); changedAssets[0].fileHashes[0] = "changed-font";
    const changed = await generate(replay, { assets: changedAssets });
    assert.equal(changed.manifest.id, original.manifest.id);
    assert.equal(changed.manifest.commitTime, original.manifest.commitTime);
    assert.notDeepEqual(changed.bytes, original.bytes, "Whole APK reproduction must reject content changes independently of replay fields");
    assert.equal(changed.manifest.assets[0].name, "font");
    assert.equal(changed.manifest.assets[0].packagerHash, "changed-font");
    assert.equal(original.manifest.assets[0].name, "logo");
    assert.equal(original.manifest.assets.find(asset => asset.name === "logo" && asset.scale === 2).packagerHash, "logo-large");
});

test("partial or malformed replay inputs fail before Metro without fallback", async () => {
    const badIds = ["", replay.id.toUpperCase(), "invalid", replay.id.replace("-4c88-", "-0c88-"), replay.id.replace("-a930-", "-7930-")];
    const badTimes = ["", "-1", "1.5", "01", " 1", "1e9", "8640000000000001", "9007199254740992", "NaN", "Infinity"];
    for (const options of [
        { id: replay.id }, { commitTime: replay.commitTime },
        ...badIds.map(id => ({ ...replay, id })), ...badTimes.map(commitTime => ({ ...replay, commitTime })),
    ]) await assert.rejects(() => generate(options), error => {
        assert.match(error.message, /replay requires.*together/i);
        assert.equal(error.fixtureState.metroCalls, 0); assert.equal(error.fixtureState.randomCalls, 0); return true;
    });
});

test("zero and maximum valid millisecond timestamps replay without rounding or fallback", async () => {
    for (const commitTime of ["0", "8640000000000000"]) {
        assert.equal((await generate({ ...replay, commitTime })).manifest.commitTime, Number(commitTime));
    }
});

test("without replay inputs stock random UUID, current time and asset enumeration are untouched", async () => {
    const first = await generate({}, { clock: 946684800123 });
    const second = await generate({}, { clock: 2208988800456, assets: [...fixtureAssets].reverse() });
    assert.notEqual(first.manifest.id, second.manifest.id);
    assert.match(first.manifest.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(first.manifest.commitTime, 946684800123); assert.equal(second.manifest.commitTime, 2208988800456);
    assert.equal(first.randomCalls, 1); assert.equal(second.randomCalls, 1);
    assert.equal(first.manifest.assets[0].name, "logo"); assert.equal(second.manifest.assets[0].name, "font");
});

test("asset extraction failures still close Metro", async () => {
    await assert.rejects(() => generate(replay, { failAssets: true }), error => {
        assert.match(error.message, /fixture Metro failure/);
        assert.equal(error.fixtureState.metroCalls, 1); assert.equal(error.fixtureState.metroEnded, 1); return true;
    });
});
