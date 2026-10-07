import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { X509Certificate, createHash, createPublicKey, generateKeyPairSync } from 'node:crypto';
import { loadReleaseConfig } from './release-config.mjs';
import { productionEnvironment, stageSource, finalizeNativeSources } from './build-android.mjs';
import { resolveExportRuntime } from './native-runtime.mjs';
export { resolveExportRuntime } from './native-runtime.mjs';
const require = createRequire(import.meta.url);
const { getProfile } = require('../config/profiles.cjs');
const { configHash } = require('../config/release-config.cjs');
const { getOtaConfig, UUID } = require('../config/ota.cjs');
const mobile = fileURLToPath(new URL('../', import.meta.url));
const projectFile = join(mobile, 'eas-project.json');
const keyDirectory = join(homedir(), '.config/cryptex-vault/ota');
export function parseOtaOptions(args, cwd = process.cwd()) {
    const options = { action: args[0] ?? 'preflight', profile: 'production', dryRun: false };
    assert.ok(['setup', 'preflight', 'export', 'publish', 'rollout', 'rollback'].includes(options.action), 'Choose setup, preflight, export, publish, rollout or rollback.');
    const seen = new Set();
    for (let i = 1; i < args.length; i++) {
        const flag = args[i];
        assert.ok(['--profile', '--config', '--message', '--percentage', '--group', '--runtime', '--private-key', '--output', '--dry-run', '--generate-keys', '--signing-plan-confirmed'].includes(flag) && !seen.has(flag), `Unknown or repeated OTA option: ${flag}`);
        seen.add(flag);
        const name = flag.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        if (['--dry-run', '--generate-keys', '--signing-plan-confirmed'].includes(flag)) options[name] = true;
        else {
            const value = args[++i];
            assert.ok(value?.trim() && !value.startsWith('--'), `${flag} requires a value.`);
            options[name] = value;
        }
    }
    const profile = getProfile(options.profile);
    options.config = resolve(cwd, options.config ?? join(mobile, profile.configFile));
    options.privateKey = resolve(cwd, options.privateKey ?? join(keyDirectory, profile.name, 'private-key.pem'));
    if (options.action === 'export' && !options.output) options.output = join(mobile, 'dist', `ota-${profile.name}`);
    if (options.output) options.output = resolve(cwd, options.output);
    if (options.percentage !== undefined) {
        assert.match(options.percentage, /^\d+$/, 'Rollout percentage must be an integer.');
        options.percentage = Number(options.percentage);
        assert.ok(options.percentage >= 1 && options.percentage <= 100, 'Rollout percentage must be 1–100.');
    }
    if (options.group) assert.match(options.group, UUID, 'Update group must be a UUID.');
    if (options.runtime) assert.match(options.runtime, /^[a-zA-Z0-9._-]+$/, 'Runtime must be an exact runtime identifier.');
    assert.ok(!options.group || ['rollout', 'rollback'].includes(options.action), '--group is only accepted by rollout or rollback.');
    assert.ok(!options.runtime || options.action === 'rollback', '--runtime is only accepted by rollback.');
    assert.ok(options.percentage === undefined || ['publish', 'rollout'].includes(options.action), '--percentage is only accepted by publish or rollout.');
    assert.ok(!options.generateKeys || options.action === 'setup', '--generate-keys is only accepted by setup.');
    if (['publish', 'rollback'].includes(options.action)) assert.ok(options.message?.trim(), 'Publishing and rollback require --message.');
    if (options.action === 'rollout') assert.ok(options.group && options.percentage !== undefined, 'Rollout requires --group and --percentage.');
    if (options.action === 'rollback') assert.ok(Boolean(options.group) !== Boolean(options.runtime), 'Rollback requires exactly one of --group or --runtime for embedded rollback.');
    return options;
}
export function createOtaPlan(options, { projectPath = projectFile, inherited = process.env } = {}) {
    const profile = getProfile(options.profile);
    const config = loadReleaseConfig(options.config);
    const ota = getOtaConfig({ profile, required: true, signingEnabled: config.EXPO_PUBLIC_OTA_SIGNING_ENABLED ?? 'false', projectFile: projectPath });
    const environment = profile.name === 'production' ? 'production' : 'preview';
    // APK keystore credentials are irrelevant to Metro and EAS update children.
    const env = productionEnvironment(inherited, config, { unsigned: true, profile: profile.name, distribution: 'standard' });
    const revision = { commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: resolve(mobile, '..'), encoding: 'utf8' }).trim(), dirty: Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: resolve(mobile, '..'), encoding: 'utf8' }).trim()) };
    Object.assign(env, { CRYPTEX_SOURCE_REVISION: JSON.stringify(revision), CRYPTEX_RELEASE_CONFIG: options.config, FORCE_COLOR: '0', NO_COLOR: '1', CRYPTEX_APP_PROFILE: profile.name, CRYPTEX_DISTRIBUTION: 'standard', EXPO_NO_DOTENV: '1', EXPO_PUBLIC_CRYPTEX_E2E: '0' });
    const common = ['--non-interactive', '--json'];
    const percentage = options.percentage ?? (profile.name === 'production' ? 10 : 100);
    let command;
    if (options.action === 'publish') command = ['update', '--channel', profile.name, '--environment', environment, '--platform', 'android', '--message', options.message, '--rollout-percentage', String(percentage), '--skip-bundler', '--input-dir', options.output ?? '<private-export>', '--private-key-path', options.privateKey, ...common];
    if (options.action === 'rollout') command = ['update:edit', options.group, '--branch', profile.name, '--rollout-percentage', String(percentage), ...common];
    if (options.action === 'rollback') command = options.group
        ? ['update:rollback', options.group, '--message', options.message, '--platform', 'android', '--private-key-path', options.privateKey, ...common]
        : ['update:roll-back-to-embedded', '--channel', profile.name, '--runtime-version', options.runtime, '--message', options.message, '--platform', 'android', '--private-key-path', options.privateKey, ...common];
    if (ota.updates.codeSigningMetadata === undefined && command) {
        const index = command.indexOf('--private-key-path');
        if (index !== -1) command.splice(index, 2);
    }
    return { config, profile: profile.name, environment, configPath: options.config, projectId: ota.extra.eas?.projectId, enabled: ota.updates.enabled, ota, env, command, authentication: 'EAS project/account require an authenticated check; no remote verification has run.' };
}
function execute(args, env, capture = false, cwd = mobile) {
    const result = spawnSync('pnpm', args[0] === 'install' ? args : ['exec', ...args], { cwd, env, stdio: capture ? 'pipe' : 'inherit', encoding: 'utf8' });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, `${args[0]} ${args[1]} failed with status ${result.status}`);
    return result.stdout;
}
function executeExpo(args, env, cwd) {
    const result = spawnSync(process.execPath, ['node_modules/expo/bin/cli', ...args], {cwd,env,stdio:'inherit'});
    if (result.error) throw result.error;
    assert.equal(result.status, 0, `Expo ${args[0]} failed with status ${result.status}`);
}
export function assertExportRuntimeUnchanged(before, after) {
    assert.deepEqual(after, before, 'Native runtime changed during export; refusing to publish an incompatible bundle.');
}
function verifyPrivateKey(plan, privateKey) {
    const key = createPublicKey(readFileSync(privateKey));
    const certificate = new X509Certificate(readFileSync(plan.ota.updates.codeSigningCertificate));
    assert.ok(certificate.checkPrivateKey(require('node:crypto').createPrivateKey(readFileSync(privateKey))), 'OTA private key does not match the pinned profile certificate.');
    assert.equal(key.asymmetricKeyType, 'rsa', 'OTA signing requires an RSA key.');
}
export function provisionProfileSigning(profileName, { projectPath = projectFile, keysPath = keyDirectory } = {}) {
    const profile = getProfile(profileName);
    const project = JSON.parse(readFileSync(projectPath, 'utf8'));
    const signing = project.profiles[profile.name];
    const certificate = resolve(dirname(projectPath), signing.certificate);
    const directory = join(keysPath, profile.name);
    const key = join(directory, 'private-key.pem');
    assert.ok(!existsSync(key) && !existsSync(certificate), 'OTA key or certificate already exists; preserve it.');
    mkdirSync(directory, { recursive: true, mode: 0o700 }); chmodSync(directory, 0o700);
    mkdirSync(dirname(certificate), { recursive: true });
    const pair = generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
    writeFileSync(key, pair.privateKey, { flag: 'wx', mode: 0o600 });
    const temporary = mkdtempSync(join(tmpdir(), 'cryptex-ota-certificate-'));
    try {
        const generated = join(temporary, 'certificate.pem');
        const result = spawnSync('openssl', ['req', '-new', '-x509', '-sha256', '-key', key, '-out', generated, '-days', '3650', '-subj', `/CN=Cryptex Vault OTA ${profile.name}`], { stdio: 'pipe' });
        if (result.error) throw result.error;
        assert.equal(result.status, 0, 'Could not create OTA signing certificate.');
        const bytes = readFileSync(generated);
        writeFileSync(certificate, bytes, { flag: 'wx', mode: 0o644 });
        signing.sha256 = createHash('sha256').update(new X509Certificate(bytes).raw).digest('hex');
        writeFileSync(projectPath, JSON.stringify(project, null, 2) + '\n');
    } catch (error) { rmSync(key, { force: true }); throw error; }
    finally { rmSync(temporary, { recursive: true, force: true }); }
    return { certificate, privateKey: key };
}
function setup(options) {
    if (options.dryRun) { console.log('Local setup preview only; no keys, project changes, authentication or network requests.'); return; }
    if (options.generateKeys) provisionProfileSigning(options.profile);
    console.log('Local EAS setup complete. Authentication, project ownership and signing-plan eligibility remain unverified.');
}
export function assertRemoteGroup(data, plan, group) {
    assert.ok(Array.isArray(data) && data.length > 0, 'EAS did not return an update group.');
    for (const item of data) assert.ok(item.group === group && item.branch === plan.profile && item.platform === 'android', 'Update group does not belong to the selected Android profile branch.');
}
export function assertRemoteChannel(data, profile) {
    const channel = data?.currentPage;
    assert.ok(channel?.name === profile && Array.isArray(channel.updateBranches), 'EAS channel does not match the selected profile.');
    const mapping = JSON.parse(channel.branchMapping);
    assert.ok(mapping.data?.length === 1, 'Channel must map entirely to its matching profile branch.');
    const destination = mapping.data[0];
    assert.ok(destination.branchMappingLogic === 'true' || destination.branchMappingLogic === true, 'Channel mapping must target all clients.');
    assert.ok(channel.updateBranches.some(branch => branch.id === destination.branchId && branch.name === profile), 'Channel points to a different profile branch.');
}
export function parseRemoteVariables(listing) {
    const variables = [];
    for (const raw of listing.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || /^Environment: (production|preview)$/.test(line) || line === 'No variables found for this environment.') continue;
        const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
        assert.ok(match, 'Unrecognized EAS environment output; refusing to publish.');
        variables.push({name:match[1],value:match[2]});
    }
    return variables;
}
export function assertRemoteEnvironment(variables, env) {
    assert.ok(Array.isArray(variables), 'Invalid EAS environment response.');
    for (const variable of variables) {
        if (/^(EXPO_PUBLIC_|CRYPTEX_|EXPO_NO_DOTENV$|NODE_ENV$)/.test(variable.name)) {
            assert.ok(variable.value === env[variable.name], `EAS environment conflicts with canonical profile configuration: ${variable.name}`);
        }
    }
}
export function runOta(args = process.argv.slice(2)) {
    const options = parseOtaOptions(args);
    if (options.action === 'setup') return setup(options);
    const plan = createOtaPlan(options);
    console.log(JSON.stringify({ profile: plan.profile, environment: plan.environment, projectId: plan.projectId, enabled: plan.enabled, configPath: plan.configPath, command: plan.command, authentication: plan.authentication }, null, 2));
    if (options.dryRun || options.action === 'preflight') return;
    if (options.action !== 'export') {
        if (plan.ota.updates.codeSigningCertificate) assert.ok(options.signingPlanConfirmed, 'Signed publishing requires --signing-plan-confirmed after checking EAS plan eligibility.');
        if (options.action !== 'rollout' && plan.ota.updates.codeSigningCertificate) verifyPrivateKey(plan, options.privateKey);
        const project = JSON.parse(readFileSync(projectFile, 'utf8'));
        const info = execute(['eas', 'project:info'], plan.env, true);
        assert.ok(info.includes(plan.projectId) && info.includes(`@${project.owner}/${project.slug}`), 'Authenticated EAS project does not match the configured identity.');
        const channel = JSON.parse(execute(['eas', 'channel:view', plan.profile, '--json', '--non-interactive'], plan.env, true));
        assertRemoteChannel(channel, plan.profile);
        // Capture only; never print remote values, including masked sensitive values.
        for (const scope of ['project', 'account']) {
            const listing = execute(['eas', 'env:list', '--environment', plan.environment, '--format', 'short', '--scope', scope], plan.env, true);
            const variables = parseRemoteVariables(listing);
            assertRemoteEnvironment(variables, plan.env);
        }
        if (options.group) {
            const listing = JSON.parse(execute(['eas', 'update:list', '--branch', plan.profile, '--limit', '100', '--json', '--non-interactive'], plan.env, true));
            assert.ok(listing.currentPage?.some(item => item.group === options.group), 'Update group is not among the latest100 groups on this project/profile branch.');
            assertRemoteGroup(JSON.parse(execute(['eas', 'update:view', options.group, '--json'], plan.env, true)), plan, options.group);
        }
    }
    if (['rollout', 'rollback'].includes(options.action)) {
        execute(['eas', ...plan.command], plan.env);
        return;
    }
    const staging = mkdtempSync(join(tmpdir(), 'cryptex-ota-stage-'));
    try {
        stageSource(staging);
        const stagedMobile = join(staging, 'mobile');
        const profile = getProfile(plan.profile);
        const config = plan.config;
        const snapshot = join(stagedMobile, profile.configFile);
        writeFileSync(snapshot, JSON.stringify(config) + '\n');
        const env = { ...plan.env, CRYPTEX_RELEASE_CONFIG: snapshot };
        const toolchain = JSON.parse(readFileSync(join(stagedMobile, 'fdroid/toolchain.json'), 'utf8'));
        const app = JSON.parse(readFileSync(join(stagedMobile, 'app.json'), 'utf8')).expo;
        const metadata = { profile: plan.profile, sourceRevision: JSON.parse(env.CRYPTEX_SOURCE_REVISION), version: { name: app.version, code: app.android.versionCode } };
        // Only nativebuild writes full signing metadata. This ignored asset is
        // deliberately excluded from runtime compatibility by fingerprint.config.js.
        execute(['install', '--frozen-lockfile', '--offline', '--ignore-scripts'], env, false, staging);
        executeExpo(['prebuild', '--platform', 'android', '--no-install'], env, stagedMobile);
        finalizeNativeSources(stagedMobile, {toolchain,metadata});
        const output = options.output ?? join(staging, 'export');
        const runtime = resolveExportRuntime(stagedMobile, env);
        if (['export', 'publish'].includes(options.action)) executeExpo(['export', '--platform', 'android', '--output-dir', output], env, stagedMobile);
        assertExportRuntimeUnchanged(runtime, resolveExportRuntime(stagedMobile, env));
        const exportMetadata = { ...metadata, projectId: plan.projectId, configHash: configHash(config),
            applicationId: profile.applicationId, channel: plan.ota.updates.requestHeaders['expo-channel-name'],
            otaUrl: plan.ota.updates.url, otaSigned: Boolean(plan.ota.updates.codeSigningCertificate), ...runtime };
        writeFileSync(`${output}.json`, JSON.stringify(exportMetadata, null, 2) + '\n');
        console.log(JSON.stringify({ exportPath: output, metadataPath: `${output}.json`, ...runtime }, null, 2));
        if (options.action === 'publish') plan.command[plan.command.indexOf('--input-dir') + 1] = output;
        if (plan.command) execute(['eas', ...plan.command], {...env,EAS_NO_VCS:'1',EAS_PROJECT_ROOT:stagedMobile}, false, stagedMobile);
    } finally { rmSync(staging, { recursive: true, force: true }); }

}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try { runOta(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
