import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { prepareProduction } from "./build-android.mjs";
import { defaultSigningDirectory } from "./signing.mjs";
import ota from "../config/ota.cjs";

export function doctor(args = process.argv.slice(2)) {
    const { options, config, env, metadata } = prepareProduction(args);
    const otaConfig = ota.getOtaConfig({ profile: options.profile, distribution: options.distribution, signingEnabled: config.EXPO_PUBLIC_OTA_SIGNING_ENABLED ?? "false" });
    const updates = otaConfig.updates;
    const report = { profile: options.profile, distribution: options.distribution, applicationId: metadata.applicationId,
        configPath: options.configPath, configHash: metadata.configHash, endpoints: { app: metadata.appUrl, api: metadata.apiUrl },
        javaHome: env.JAVA_HOME, androidSdk: env.ANDROID_HOME, signingDirectory: defaultSigningDirectory(options.profile),
        signer: metadata.signer, sourceRevision: metadata.sourceRevision, ota: !updates.enabled ? "disabled" : updates.codeSigningCertificate ? "enabled, signed" : "enabled, unsigned",
        eas: { owner: otaConfig.owner, projectId: otaConfig.extra?.eas?.projectId, authentication: "not checked; requires authenticated project preflight" } };
    console.log(JSON.stringify(report, null, 2));
    return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    try { doctor(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
