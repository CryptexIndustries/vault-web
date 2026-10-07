import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { e2eIdentity, maestroProfileArgs } from '../e2e/profile.mjs';
import { runMobile } from './mobile.mjs';

const require = createRequire(import.meta.url);
const { profiles } = require('../config/profiles.cjs');
const appConfig = require('../app.config.js');
const { identityResources, applyAndroidIdentity } = require('../plugins/with-app-identity.js');
const { configureReleaseSigning } = require('../plugins/with-release-signing-config.js');
const base = JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8')).expo;
function configured(profile, { release = false, e2e = false, offline = false } = {}) {
    const before = { ...process.env };
    try {
        process.env.CRYPTEX_APP_PROFILE = profile;
        process.env.CRYPTEX_DISTRIBUTION = 'standard';
        delete process.env.CRYPTEX_RELEASE_CONFIG;
        process.env.CRYPTEX_BUILD_PROFILE = release ? 'production' : 'development';
        process.env.CRYPTEX_OFFLINE_SERVICES = offline ? '1' : '0';
        process.env.EXPO_PUBLIC_CRYPTEX_E2E = e2e ? '1' : '0';
        process.env.EXPO_PUBLIC_APP_URL = 'https://wrong-inherited.example.test';
        process.env.EXPO_PUBLIC_ONLINE_SERVICES_API_URL = 'https://wrong-api.example.test';
        process.env.EXPO_PUBLIC_UNREVIEWED = 'must-be-removed';
        process.env.CRYPTEX_SOURCE_REVISION = JSON.stringify({ commit: 'fixture', dirty: false });
        return { config: appConfig({ config: structuredClone(base) }), env: { ...process.env } };
    } finally {
        for (const name of Object.keys(process.env)) if (!Object.hasOwn(before, name)) delete process.env[name];
        Object.assign(process.env, before);
    }
}

test('production and preprod have distinct installed identities, native routes, names and launcher assets', () => {
    const production = configured('production').config;
    const preprod = configured('preprod').config;
    assert.equal(production.android.package, profiles.production.applicationId);
    assert.equal(preprod.android.package, profiles.preprod.applicationId);
    assert.notEqual(production.scheme, preprod.scheme);
    assert.notEqual(production.name, preprod.name);
    assert.notEqual(production.icon, preprod.icon);
    assert.ok(existsSync(new URL(`../${preprod.icon}`, import.meta.url)));
    assert.notEqual(production.android.adaptiveIcon.foregroundImage, preprod.android.adaptiveIcon.foregroundImage);
    assert.notEqual(production.android.adaptiveIcon.monochromeImage, preprod.android.adaptiveIcon.monochromeImage);
});

test('secure releases use canonical public endpoints, disable E2E flags and preserve explicit offline services', () => {
    for (const profile of Object.values(profiles)) {
        const canonical = JSON.parse(readFileSync(new URL(`../${profile.configFile}`, import.meta.url), 'utf8'));
        for (const offline of [false, true]) {
            const { config, env } = configured(profile.name, { release: true, e2e: true, offline });
            assert.equal(env.EXPO_PUBLIC_APP_URL, canonical.EXPO_PUBLIC_APP_URL);
            assert.equal(env.EXPO_PUBLIC_ONLINE_SERVICES_API_URL, canonical.EXPO_PUBLIC_ONLINE_SERVICES_API_URL);
            assert.equal(env.EXPO_PUBLIC_UNREVIEWED, undefined);
            assert.equal(env.EXPO_PUBLIC_CRYPTEX_E2E, '0');
            assert.equal(env.EXPO_PUBLIC_CLOUD_ENABLED, offline ? 'false' : 'true');
            assert.equal(config.extra.buildDetails.appUrl, canonical.EXPO_PUBLIC_APP_URL);
            assert.equal(config.extra.buildDetails.apiUrl, canonical.EXPO_PUBLIC_ONLINE_SERVICES_API_URL);
            assert.deepEqual(config.extra.buildDetails.revision, { commit: 'fixture', dirty: false });
            const devClient = config.plugins.find(plugin => Array.isArray(plugin) && plugin[0] === 'expo-dev-client');
            assert.equal(devClient[1].addGeneratedScheme, false);
        }
    }
});

test('OTA stays enabled with isolated release, development and E2E profile channels', () => {
    for (const profile of Object.values(profiles)) {
        for (const [options, channel] of [[{ release: true }, profile.name], [{}, `${profile.name}-dev`], [{ e2e: true }, `${profile.name}-e2e`]]) {
            const { config } = configured(profile.name, options);
            assert.equal(config.updates.enabled, true);
            assert.equal(config.updates.requestHeaders['expo-channel-name'], channel);
            assert.equal(config.extra.eas.projectId, '1468ae8c-1717-4e82-a753-29e57f534e7f');
        }
    }
});

test('dev and E2E commands cannot inherit release classification or a different profile config', () => {
    for (const profile of Object.values(profiles)) {
        for (const [args, mode] of [[['dev'], 'dev'], [['build', '--dev'], 'dev'], [['build', '--e2e'], 'e2e']]) {
            let selected;
            runMobile([...args, '--profile', profile.name], {
                env: { ...process.env, CRYPTEX_BUILD_PROFILE: 'production', CRYPTEX_DISTRIBUTION: 'fdroid',
                    CRYPTEX_RELEASE_CONFIG: '/missing/inherited-release.json', CRYPTEX_OFFLINE_SERVICES: '1',
                    CRYPTEX_SOURCE_REVISION: 'invalid inherited JSON' },
                checkNativeIdentity: () => {},
                run: (_binary, _args, options) => { selected ??= options.env; return { status: 0 }; },
            });
            const result = spawnSync(process.execPath, ['-e', `
                const config = require('./app.config.js')({ config: require('./app.json').expo });
                console.log(JSON.stringify({ config, e2e: process.env.EXPO_PUBLIC_CRYPTEX_E2E }));
            `], { cwd: new URL('../', import.meta.url), env: selected, encoding: 'utf8' });
            assert.equal(result.status, 0, result.stderr);
            const { config, e2e } = JSON.parse(result.stdout);
            assert.equal(config.android.package, profile.applicationId);
            assert.equal(config.updates.requestHeaders['expo-channel-name'], `${profile.name}-${mode}`);
            assert.equal(config.extra.buildDetails.distribution, 'standard');
            assert.equal(config.extra.buildDetails.revision, null);
            assert.equal(e2e, mode === 'e2e' ? '1' : '0');
            const canonical = JSON.parse(readFileSync(new URL(`../${profile.configFile}`, import.meta.url), 'utf8'));
            const { configHash } = require('../config/release-config.cjs');
            assert.equal(config.extra.buildDetails.configHash, configHash(canonical));
        }
    }
});

test('native credential resource overlays and Maestro arguments select the same registry profile', () => {
    for (const profile of Object.values(profiles)) {
        const xml = identityResources(profile);
        assert.ok(xml.includes(`<string name="cryptex_app_scheme">${profile.scheme}</string>`));
        assert.ok(xml.includes(profile.displayName));
        assert.deepEqual(e2eIdentity(profile.name), { CRYPTEX_APP_ID: profile.applicationId, CRYPTEX_APP_SCHEME: profile.scheme, CRYPTEX_APP_NAME: profile.displayName });
        assert.deepEqual(maestroProfileArgs(profile.name), ['-e', `CRYPTEX_APP_ID=${profile.applicationId}`, '-e', `CRYPTEX_APP_SCHEME=${profile.scheme}`, '-e', `CRYPTEX_APP_NAME=${profile.displayName}`]);
    }
    assert.throws(() => e2eIdentity('unknown'), /Unknown application profile/);
    assert.throws(() => configured('unknown'), /Unknown application profile/);
});

test('the native release guard checks both profile IDs without relaxing secure release mode or signing', () => {
    const template = `android { signingConfigs {} buildTypes { release { signingConfig signingConfigs.debug } } }`;
    const result = configureReleaseSigning(template);
    assert.ok(result.includes(`'production': '${profiles.production.applicationId}'`));
    assert.ok(result.includes(`'preprod': '${profiles.preprod.applicationId}'`));
    assert.ok(result.includes("System.getenv('CRYPTEX_BUILD_PROFILE') != 'production'"));
    assert.ok(result.includes("Test flags and alternate entry points are forbidden"));
    assert.ok(result.includes('Missing release signing environment variable'));
    assert.equal(configureReleaseSigning(result), result);
    assert.throws(() => configureReleaseSigning(result.replace(profiles.preprod.applicationId, 'wrong.application')), /was modified/);
    const legacy = result.replace(/        def appProfile = [\s\S]*?        }\n(?=        if \(!providers)/,
        "        if (android.defaultConfig.applicationId != 'com.cryptex.vault') {\n            throw new GradleException('Production application ID must be com.cryptex.vault.')\n        }\n");
    assert.equal(configureReleaseSigning(legacy), result);
});

test('native generation points all three framework settings activities to the selected app and rejects a crossed profile', async () => {
    const temporary = mkdtempSync(join(tmpdir(), 'cryptex-identity-resources-'));
    try {
        for (const profile of Object.values(profiles)) {
            const root = join(temporary, profile.name);
            await applyAndroidIdentity({ android: { package: profile.applicationId }, modRequest: { platformProjectRoot: root } }, profile);
            const values = readFileSync(join(root, 'app/src/main/res/values/cryptex_identity.xml'), 'utf8');
            assert.ok(values.includes(profile.scheme));
            assert.ok(values.includes(profile.displayName));
            for (const name of ['cryptex_autofill_service', 'cryptex_accessibility_service', 'cryptex_credential_provider']) {
                const xml = readFileSync(join(root, `app/src/main/res/xml/${name}.xml`), 'utf8');
                assert.ok(xml.includes(`android:settingsActivity="${profile.applicationId}.MainActivity"`));
                assert.ok(!xml.includes('com.cryptex.vault.MainActivity'));
            }
        }
        await assert.rejects(applyAndroidIdentity({ android: { package: profiles.production.applicationId }, modRequest: { platformProjectRoot: temporary } }, profiles.preprod), /differs from the selected/);
    } finally { rmSync(temporary, { recursive: true, force: true }); }
});
