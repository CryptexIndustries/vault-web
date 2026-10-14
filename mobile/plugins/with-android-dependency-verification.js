const { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const path = require("node:path");
const {
    withDangerousMod,
    withProjectBuildGradle,
} = require("@expo/config-plugins");

const POLICY = "apply from: new File(rootDir, '../fdroid/dependencies.gradle')";
const PLAY_POLICY = "apply from: new File(rootDir, '../config/play-dependencies.gradle')";
const PLAY_RULES_BEGIN = "# Begin Cryptex Play rules";
const PLAY_RULES_END = "# End Cryptex Play rules";
// play-dependencies.gradle excludes these optional RevenueCat dependencies, so
// R8 must not expect them. RevenueCat catches the missing Block Store classes,
// and it reads the advertising ID only in collectDeviceIdentifiers() and the
// attribution ID setters, which the app never calls.
const PLAY_RULES = [
    "-dontwarn com.google.android.gms.ads.identifier.**",
    "-dontwarn com.google.android.gms.auth.blockstore.**",
];

function addDependencyPolicy(contents, distribution = globalThis.process?.env.CRYPTEX_DISTRIBUTION) {
    const policy = distribution === "play" ? PLAY_POLICY : POLICY;
    const withoutPolicies = contents.split("\n")
        .filter(line => ![POLICY, PLAY_POLICY].includes(line.trim())).join("\n");
    return `${withoutPolicies.trimEnd()}\n\n${policy}\n`;
}

function addPlayProguardRules(contents, distribution = globalThis.process?.env.CRYPTEX_DISTRIBUTION) {
    const begin = contents.indexOf(PLAY_RULES_BEGIN);
    const end = contents.indexOf(PLAY_RULES_END);
    let base = contents;
    if (begin !== -1 || end !== -1) {
        if (begin === -1 || end < begin) throw new Error("Invalid Cryptex Play ProGuard rules block");
        base = `${contents.slice(0, begin).trimEnd()}\n${contents.slice(end + PLAY_RULES_END.length).trimStart()}`;
        base = base.trim() ? `${base.trimEnd()}\n` : "";
    }
    if (distribution !== "play") return base;
    return `${base.trimEnd() ? `${base.trimEnd()}\n\n` : ""}${[PLAY_RULES_BEGIN, ...PLAY_RULES, PLAY_RULES_END].join("\n")}\n`;
}

function mergeVerificationMetadata(baseXml, playXml) {
    const { DOMParser, XMLSerializer } = require("@xmldom/xmldom");
    const serializer = new XMLSerializer();
    const elements = node => Array.from(node.childNodes).filter(child => child.nodeType === 1);
    const parse = xml => {
        const errors = [];
        if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("Dependency verification cannot use XML entities");
        const document = new DOMParser({ errorHandler: {
            warning: message => errors.push(message),
            error: message => errors.push(message),
            fatalError: message => errors.push(message),
        } }).parseFromString(xml, "application/xml");
        if (errors.length || document.documentElement?.tagName !== "verification-metadata") {
            throw new Error("Invalid dependency verification metadata");
        }
        const children = elements(document.documentElement);
        if (children.length !== 2 || children[0].tagName !== "configuration" || children[1].tagName !== "components") {
            throw new Error("Dependency verification requires configuration and components");
        }
        return { document, configuration: children[0], components: children[1] };
    };
    const base = parse(baseXml);
    const play = parse(playXml);
    const configuration = node => serializer.serializeToString(node).replace(/>\s+</g, "><");
    if (configuration(base.configuration) !== configuration(play.configuration)) {
        throw new Error("Play checksums cannot change the dependency verification policy");
    }
    const componentKey = node => JSON.stringify(["group", "name", "version"].map(name => node.getAttribute(name)));
    const components = new Map(elements(base.components).map(node => [componentKey(node), node]));
    const append = (parent, element, indentation) => {
        const trailing = parent.lastChild?.nodeType === 3 && /^\s*$/.test(parent.lastChild.nodeValue)
            ? parent.lastChild : null;
        parent.insertBefore(base.document.createTextNode(`\n${indentation}`), trailing);
        parent.insertBefore(base.document.importNode(element, true), trailing);
    };
    const seen = new Set();
    for (const component of elements(play.components)) {
        const key = componentKey(component);
        const artifacts = elements(component);
        if (component.tagName !== "component" || !artifacts.length || ["group", "name", "version"].some(name => !component.getAttribute(name)) || seen.has(key)) {
            throw new Error("Invalid or duplicate Play dependency component");
        }
        seen.add(key);
        const artifactNames = new Set();
        for (const artifact of artifacts) {
            const name = artifact.getAttribute("name");
            const hashes = elements(artifact);
            if (artifact.tagName !== "artifact" || !name || artifactNames.has(name) || !hashes.length ||
                hashes.some(hash => hash.tagName !== "sha256" || !/^[a-f0-9]{64}$/.test(hash.getAttribute("value")))) {
                throw new Error("Play dependencies require unique artifacts and SHA-256 checksums");
            }
            artifactNames.add(name);
        }
        const existing = components.get(key);
        if (!existing) {
            append(base.components, component, "      ");
            continue;
        }
        const existingArtifacts = new Map(elements(existing).map(node => [node.getAttribute("name"), node]));
        for (const artifact of artifacts) {
            const previous = existingArtifacts.get(artifact.getAttribute("name"));
            if (previous) {
                const values = node => elements(node).map(hash => `${hash.tagName}:${hash.getAttribute("value")}`).sort().join(",");
                if (values(previous) !== values(artifact)) throw new Error("Conflicting Play dependency checksums");
            } else {
                append(existing, artifact, "         ");
            }
        }
    }
    return serializer.serializeToString(base.document);
}

module.exports = (config) => {
    const distribution = globalThis.process?.env.CRYPTEX_DISTRIBUTION;
    config = withProjectBuildGradle(config, (mod) => {
        mod.modResults.contents = addDependencyPolicy(mod.modResults.contents, distribution);
        return mod;
    });
    return withDangerousMod(config, [
        "android",
        async (mod) => {
            const destination = path.join(
                mod.modRequest.platformProjectRoot,
                "gradle",
            );
            mkdirSync(destination, { recursive: true });
            const baseMetadata = path.join(mod.modRequest.projectRoot, "fdroid/verification-metadata.xml");
            const generatedMetadata = path.join(destination, "verification-metadata.xml");
            if (distribution === "play") {
                writeFileSync(generatedMetadata, mergeVerificationMetadata(
                    readFileSync(baseMetadata, "utf8"),
                    readFileSync(path.join(mod.modRequest.projectRoot, "config/play-verification-metadata.xml"), "utf8"),
                ));
            } else {
                copyFileSync(baseMetadata, generatedMetadata);
            }
            const proguardRules = path.join(mod.modRequest.platformProjectRoot, "app/proguard-rules.pro");
            const currentRules = existsSync(proguardRules) ? readFileSync(proguardRules, "utf8") : "";
            const rules = addPlayProguardRules(currentRules, distribution);
            if (rules !== currentRules) {
                mkdirSync(path.dirname(proguardRules), { recursive: true });
                writeFileSync(proguardRules, rules);
            }
            const notices = path.join(
                mod.modRequest.platformProjectRoot,
                "app/src/main/assets/licenses",
            );
            mkdirSync(notices, { recursive: true });
            for (const name of [
                "webrtc-150.7871.01.txt",
                "oxanium-OFL.txt",
                "lucide-LICENSE.txt",
                "expo-google-fonts-LICENSE.txt",
                "openssl-3.5.8-LICENSE.txt",
                "skia-2.6.2.txt",
                "AGPL-3.0-only.txt",
                "cryptex-assets.txt",
            ]) {
                copyFileSync(
                    path.join(
                        mod.modRequest.projectRoot,
                        "fdroid/notices",
                        name,
                    ),
                    path.join(notices, name),
                );
            }
            const purchasesNotice = path.join(notices, "react-native-purchases-MIT.txt");
            if (distribution === "play") {
                copyFileSync(
                    path.join(mod.modRequest.projectRoot, "node_modules/react-native-purchases/LICENSE"),
                    purchasesNotice,
                );
            } else {
                rmSync(purchasesNotice, { force: true });
            }
            return mod;
        },
    ]);
};

module.exports.addDependencyPolicy = addDependencyPolicy;
module.exports.mergeVerificationMetadata = mergeVerificationMetadata;
module.exports.addPlayProguardRules = addPlayProguardRules;
