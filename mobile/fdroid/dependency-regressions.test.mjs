import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const mobile = createRequire(new URL("../package.json", import.meta.url));
const router = createRequire(mobile.resolve("expo-router/package.json"));
const expoConfig = createRequire(mobile.resolve("@expo/config-plugins/package.json"));
const expoCli = createRequire(createRequire(mobile.resolve("expo/package.json")).resolve("@expo/cli/package.json"));

test("patched query decoder keeps normal URL parsing and bounds malformed decoding work", { timeout: 2000 }, () => {
    const query = router("query-string");
    assert.deepEqual({ ...query.parse("name=hello%20world&utf8=%F0%9F%94%92&a=1&a=2") }, {
        a: ["1", "2"], name: "hello world", utf8: "🔒",
    });
    const malformed = "%FF".repeat(20000);
    assert.equal(query.parse(`bad=${malformed}`).bad, malformed);
    assert.equal(query.stringify({ name: "hello world" }), "name=hello%20world");
});

test("Xcode UUID generation remains compatible with the fixed CommonJS UUID API", () => {
    const xcode = expoConfig("xcode");
    const project = xcode.project("unused.pbxproj");
    project.hash = { project: { objects: {} } };
    assert.match(project.generateUuid(), /^[0-9A-F]{24}$/);
    const uuid = createRequire(expoConfig.resolve("xcode/package.json"))("uuid");
    assert.throws(() => uuid.v5("x", uuid.v5.DNS, new Uint8Array(8), 4), RangeError);
});

test("Xcode log YAML parsing uses the fixed merge-source budget", () => {
    const pretty = createRequire(expoCli.resolve("@expo/xcpretty/package.json"));
    const yaml = pretty("js-yaml");
    assert.equal(pretty("js-yaml/package.json").version, "4.3.2");
    const source = "arr: &arr [{}, {}, {}, {}]\ntargets:\n  - <<: *arr\n  - <<: *arr\n";
    assert.throws(() => yaml.load(source, { maxTotalMergeKeys: 4 }), /merge|limit|exceed/i);
    assert.deepEqual(yaml.load("name: cryptex\n"), { name: "cryptex" });
});
