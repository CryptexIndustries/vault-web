const { readFileSync, existsSync } = require('node:fs');
const { resolve, dirname } = require('node:path');
const { X509Certificate, createHash } = require('node:crypto');
const { getProfile } = require('./profiles.cjs');
const mobile = resolve(__dirname, '..');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function getOtaConfig({ profile, distribution = 'standard', signingEnabled = false, mode = 'release', projectFile = resolve(mobile, 'eas-project.json') }) {
    profile = getProfile(typeof profile === 'string' ? profile : profile.name);
    if (!['standard', 'fdroid'].includes(distribution)) throw new Error('Distribution must be standard or fdroid.');
    if (distribution === 'fdroid' && profile.name !== 'production') throw new Error('F-Droid requires the production profile.');
    if (![true, false, 'true', 'false'].includes(signingEnabled)) throw new Error('EXPO_PUBLIC_OTA_SIGNING_ENABLED must be true or false.');
    if (!existsSync(projectFile)) throw new Error('Missing EAS project configuration. Restore mobile/eas-project.json.');
    const project = JSON.parse(readFileSync(projectFile, 'utf8'));
    if (!UUID.test(project.projectId) || !/^[a-z0-9][a-z0-9-]*$/i.test(project.owner) || project.slug !== 'cryptex-vault') throw new Error('Invalid EAS project identity.');
    if (!['release', 'development', 'e2e'].includes(mode)) throw new Error('OTA mode must be release, development or e2e.');
    const channel = profile.name + (mode === 'release' ? '' : mode === 'e2e' ? '-e2e' : '-dev');
    const enabled = distribution !== 'fdroid';
    const signed = enabled && (signingEnabled === true || signingEnabled === 'true');
    const config = {
        owner: project.owner,
        runtimeVersion: { policy: 'fingerprint' },
        updates: enabled ? {
            enabled: true,
            url: `https://u.expo.dev/${project.projectId}`,
            requestHeaders: { 'expo-channel-name': channel },
            checkAutomatically: 'ON_LOAD',
            fallbackToCacheTimeout: 0,
        } : { enabled: false, checkAutomatically: 'NEVER', fallbackToCacheTimeout: 0 },
        extra: { eas: { projectId: project.projectId }, buildDetails: { profile: profile.name, distribution, otaSigning: !enabled ? 'disabled' : signed ? 'signed' : 'unsigned' } },
    };
    if (!signed) return config;
    const signing = project.profiles?.[profile.name];
    if (!signing || typeof signing.certificate !== 'string' || !/^[a-z0-9-]+$/i.test(signing.keyId)) throw new Error('Missing profile OTA signing configuration.');
    const certificate = resolve(dirname(projectFile), signing.certificate);
    if (!existsSync(certificate)) throw new Error(`Missing ${profile.name} OTA certificate. Run mobile:ota setup --profile ${profile.name} --generate-keys.`);
    const cert = new X509Certificate(readFileSync(certificate));
    if (cert.publicKey.asymmetricKeyType !== 'rsa' || (cert.publicKey.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) throw new Error('OTA certificate must use RSA with at least 2048 bits.');
    const now = Date.now();
    if (now < Date.parse(cert.validFrom) || now >= Date.parse(cert.validTo)) throw new Error('OTA signing certificate is not currently valid.');
    const fingerprint = createHash('sha256').update(cert.raw).digest('hex');
    if (signing.sha256 !== fingerprint) throw new Error('OTA certificate does not match its pinned SHA-256 fingerprint.');
    return { ...config, updates: { ...config.updates, codeSigningCertificate: certificate, codeSigningMetadata: { keyid: signing.keyId, alg: 'rsa-v1_5-sha256' } } };
}
function requireOtaConfiguration(profile, options = {}) { return getOtaConfig({ ...options, profile }); }
module.exports = { getOtaConfig, requireOtaConfiguration, UUID };
