import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const { addDependencyPolicy } = require("../plugins/with-android-dependency-verification") as {
    addDependencyPolicy(contents: string): string;
};

describe("Android dependency verification", () => {
    it("retains the checksum policy after generated prebuild and is idempotent", () => {
        const result = addDependencyPolicy("apply plugin: 'expo-root-project'\n");
        expect(result).toContain("apply from: new File(rootDir, '../fdroid/dependencies.gradle')");
        expect(addDependencyPolicy(result)).toBe(result);
    });

    it("verifies artifact metadata without bypasses or blanket trust entries", () => {
        const metadata = readFileSync(resolve(__dirname, "../fdroid/verification-metadata.xml"), "utf8");
        expect(metadata).toContain("<verify-metadata>true</verify-metadata>");
        expect(metadata).not.toMatch(/<trusted-artifacts|<ignored-keys|<trust\s/);
        expect(metadata).toMatch(/<sha256 value="[a-f0-9]{64}"/);
        expect(metadata).not.toMatch(/group="com\.google\.(?:android\.gms|mlkit|firebase)"/);
        expect(metadata).toContain('group="org.tensorflow" name="tensorflow-lite-metadata" version="0.2.0"');
        expect(metadata).toContain('group="org.tensorflow" name="tensorflow-lite-metadata" version="0.1.0-rc2"');
    });

    it("checks resolved external modules instead of rejecting source project substitutions", () => {
        const policy = readFileSync(resolve(__dirname, "../fdroid/dependencies.gradle"), "utf8");
        const requestPolicy = policy.slice(policy.indexOf("resolutionStrategy.eachDependency"),
            policy.indexOf("incoming.afterResolve"));
        expect(requestPolicy).not.toContain("Disallowed prebuilt Android dependency");
        expect(requestPolicy).toContain("dependency.useVersion('0.86.0')");
        expect(requestPolicy).toContain("Unpinned Android dependency");
        expect(policy).toMatch(/incoming\.afterResolve[\s\S]*instanceof ModuleComponentIdentifier[\s\S]*Disallowed prebuilt Android dependency/);
    });
});
