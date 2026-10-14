import { describe, expect, it } from "@jest/globals";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { DOMParser } from "@xmldom/xmldom";
import { runInNewContext } from "node:vm";

const plugin = require("../plugins/with-android-dependency-verification") as {
    (config: { name: string; slug: string }): { mods: { android: { dangerous(mod: object): Promise<object> } } };
    addDependencyPolicy(contents: string, distribution?: string): string;
    mergeVerificationMetadata(baseXml: string, playXml: string): string;
    addPlayProguardRules(contents: string, distribution?: string): string;
};
const { addDependencyPolicy, mergeVerificationMetadata, addPlayProguardRules } = plugin;
const projectRoot = resolve(__dirname, "..");
const baseline = readFileSync(join(projectRoot, "fdroid/verification-metadata.xml"), "utf8");
const playChecksums = readFileSync(join(projectRoot, "config/play-verification-metadata.xml"), "utf8");
const disallowedFdroidComponents = /group="(?:com\.google\.(?:android\.gms|firebase)|com\.android\.billingclient|com\.revenuecat\.purchases|com\.amazon\.device)"/;

function artifactHashes(xml: string): string[] {
    const document = new DOMParser().parseFromString(xml, "application/xml");
    return Array.from(document.getElementsByTagName("component")).flatMap(component =>
        Array.from(component.getElementsByTagName("artifact")).flatMap(artifact =>
            Array.from(artifact.getElementsByTagName("sha256")).map(hash =>
                [component.getAttribute("group"), component.getAttribute("name"), component.getAttribute("version"),
                    artifact.getAttribute("name"), hash.getAttribute("value")].join(":"))));
}

async function generateMetadata(distribution: string, platformProjectRoot: string) {
    const previous = process.env.CRYPTEX_DISTRIBUTION;
    process.env.CRYPTEX_DISTRIBUTION = distribution;
    try {
        const config = plugin({ name: "fixture", slug: "fixture" });
        await config.mods.android.dangerous({ modRequest: { projectRoot, platformProjectRoot }, modResults: {} });
    } finally {
        if (previous === undefined) delete process.env.CRYPTEX_DISTRIBUTION;
        else process.env.CRYPTEX_DISTRIBUTION = previous;
    }
    return readFileSync(join(platformProjectRoot, "gradle/verification-metadata.xml"), "utf8");
}

function metadataWith(component: string) {
    return baseline.slice(0, baseline.indexOf("   <components>")) + `<components>${component}</components></verification-metadata>`;
}

describe("Android dependency verification", () => {
    it("retains the checksum policy after generated prebuild and is idempotent", () => {
        const result = addDependencyPolicy("apply plugin: 'expo-root-project'\n", "fdroid");
        expect(result).toContain("apply from: new File(rootDir, '../fdroid/dependencies.gradle')");
        expect(addDependencyPolicy(result, "fdroid")).toBe(result);
    });

    it("switches the generated policy without retaining the previous distribution", () => {
        const fdroid = addDependencyPolicy("apply plugin: 'expo-root-project'\n", "fdroid");
        const play = addDependencyPolicy(fdroid, "play");
        expect(play).toContain("apply from: new File(rootDir, '../config/play-dependencies.gradle')");
        expect(play).not.toContain("../fdroid/dependencies.gradle");
        expect(addDependencyPolicy(play, "play")).toBe(play);
        expect(addDependencyPolicy(play, "fdroid")).toBe(fdroid);
        expect(addDependencyPolicy(play, "standard")).toBe(fdroid);
    });

    it("verifies artifact metadata without bypasses or blanket trust entries", () => {
        const metadata = baseline;
        expect(metadata).toContain("<verify-metadata>true</verify-metadata>");
        expect(metadata).not.toMatch(/<trusted-artifacts|<ignored-keys|<trust\s/);
        expect(metadata).toMatch(/<sha256 value="[a-f0-9]{64}"/);
        expect(metadata).not.toMatch(disallowedFdroidComponents);
        expect(metadata).not.toContain('group="com.google.mlkit"');
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
        expect(policy).not.toMatch(/play|revenuecat|billingclient/i);
        const play = readFileSync(resolve(__dirname, "../config/play-dependencies.gradle"), "utf8");
        expect(play).toContain("com.android.billingclient:billing:8.3.0");
        for (const excluded of ["play-services-ads-identifier", "play-services-auth-blockstore", "purchases-store-amazon"]) {
            expect(play).toContain(`module: '${excluded}'`);
            expect(play).not.toContain(`:${excluded}:`);
        }
        expect(play).toContain("exclude group: 'com.amazon.device'");
        expect(play).toContain('reviewedPlayDependencies.contains("${id.group}:${id.module}:${id.version}".toString())');
        expect(play).toContain("System.getenv('CRYPTEX_DISTRIBUTION') != 'play'");
        expect(play).not.toContain("../fdroid/dependencies.gradle");
        expect(play).toContain("'com.google.mlkit', 'org.tensorflow'");
        expect(play).toContain("Unpinned Android dependency");
        expect(play).toContain("Disallowed prebuilt Android dependency");
        expect(policy).toMatch(/incoming\.afterResolve[\s\S]*instanceof ModuleComponentIdentifier[\s\S]*Disallowed prebuilt Android dependency/);
    });

    it("adds every Play checksum once while retaining every baseline checksum", () => {
        const merged = mergeVerificationMetadata(baseline, playChecksums);
        const hashes = artifactHashes(merged);
        const expected = new Set([...artifactHashes(baseline), ...artifactHashes(playChecksums)]);
        expect(hashes.length).toBe(expected.size);
        expect(new Set(hashes)).toEqual(expected);
        expect(merged).not.toMatch(/<trusted-artifacts|<ignored-keys|<trust\s/);
        expect(mergeVerificationMetadata(merged, playChecksums)).toBe(merged);
        const component = new DOMParser().parseFromString(merged, "application/xml").getElementsByTagName("component");
        const errorProne = Array.from(component).filter(node => node.getAttribute("group") === "com.google.errorprone" &&
            node.getAttribute("name") === "error_prone_annotations" && node.getAttribute("version") === "2.18.0");
        expect(errorProne).toHaveLength(1);
        expect(Array.from(errorProne[0].getElementsByTagName("artifact")).map(node => node.getAttribute("name"))).toEqual([
            "error_prone_annotations-2.18.0.pom", "error_prone_annotations-2.18.0.jar",
        ]);
    });

    it("rejects checksum overlays that weaken verification or contain malformed XML", () => {
        expect(() => mergeVerificationMetadata(baseline, playChecksums.replace("<verify-metadata>true", "<verify-metadata>false")))
            .toThrow("cannot change the dependency verification policy");
        expect(() => mergeVerificationMetadata(baseline, playChecksums.replace("</configuration>", "<trusted-artifacts/></configuration>")))
            .toThrow("cannot change the dependency verification policy");
        expect(() => mergeVerificationMetadata(baseline, "<verification-metadata>"))
            .toThrow("Invalid dependency verification metadata");
        expect(() => mergeVerificationMetadata(baseline, playChecksums.replace(/<sha256 /, "<sha1 ")))
            .toThrow("SHA-256 checksums");
    });

    it("rejects conflicting checksums and duplicate Play component identities", () => {
        const component = '<component group="fixture" name="fixture" version="1"><artifact name="fixture.jar">' +
            `<sha256 value="${"a".repeat(64)}"/></artifact></component>`;
        expect(() => mergeVerificationMetadata(metadataWith(component), metadataWith(component.replace("a".repeat(64), "b".repeat(64)))))
            .toThrow("Conflicting Play dependency checksums");
        expect(() => mergeVerificationMetadata(baseline, metadataWith(component + component)))
            .toThrow("duplicate Play dependency component");
    });

    it("adds the Play R8 rules only to Play builds and removes them when switching back", () => {
        const template = "# Add project specific ProGuard rules here.\n-keep class com.facebook.react.** { *; }\n";
        const play = addPlayProguardRules(template, "play");
        expect(play.startsWith(template)).toBe(true);
        expect(play).toContain("-dontwarn com.google.android.gms.ads.identifier.**");
        expect(play).toContain("-dontwarn com.google.android.gms.auth.blockstore.**");
        expect(addPlayProguardRules(play, "play")).toBe(play);
        for (const distribution of ["fdroid", "standard"]) {
            expect(addPlayProguardRules(play, distribution)).toBe(template);
            expect(addPlayProguardRules(template, distribution)).toBe(template);
        }
        expect(addPlayProguardRules("", "fdroid")).toBe("");
        expect(() => addPlayProguardRules("# End Cryptex Play rules\n", "play")).toThrow("Invalid Cryptex Play ProGuard rules block");
    });

    it("generates Play checksums and removes them and the SDK notice when switching to F-Droid or standard", async () => {
        const platformProjectRoot = mkdtempSync(join(tmpdir(), "cryptex-distribution-checksums-"));
        const sdkNotice = join(platformProjectRoot, "app/src/main/assets/licenses/react-native-purchases-MIT.txt");
        const proguardRules = join(platformProjectRoot, "app/proguard-rules.pro");
        try {
            for (const distribution of ["fdroid", "standard"]) {
                const play = await generateMetadata("play", platformProjectRoot);
                expect(new Set(artifactHashes(play))).toEqual(new Set([...artifactHashes(baseline), ...artifactHashes(playChecksums)]));
                expect(play).toMatch(disallowedFdroidComponents);
                expect(existsSync(sdkNotice)).toBe(true);
                expect(readFileSync(proguardRules, "utf8")).toContain("-dontwarn com.google.android.gms.auth.blockstore.**");
                const clean = await generateMetadata(distribution, platformProjectRoot);
                expect(clean).toBe(baseline);
                expect(clean).not.toMatch(disallowedFdroidComponents);
                expect(existsSync(sdkNotice)).toBe(false);
                expect(readFileSync(proguardRules, "utf8")).not.toMatch(/gms|Cryptex Play/);
            }
        } finally {
            rmSync(platformProjectRoot, { recursive: true, force: true });
        }
    });

    it("includes the Play checksum delta in the native fingerprint only for Play", () => {
        const source = readFileSync(join(projectRoot, "fingerprint.config.js"), "utf8");
        for (const distribution of ["fdroid", "standard", "play"]) {
            const config = { exports: {} as { extraSources: { filePath: string }[] } };
            runInNewContext(source, { module: config, process: { env: { CRYPTEX_DISTRIBUTION: distribution } } });
            const paths = config.exports.extraSources.map(entry => entry.filePath);
            expect(paths.includes("./config/play-verification-metadata.xml")).toBe(distribution === "play");
            expect(paths.includes("./config/play-dependencies.gradle")).toBe(distribution === "play");
        }
    });
});
