import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync, openSync, closeSync, readdirSync, existsSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { e2eIdentity } from './profile.mjs';

const mobile = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sender = process.env.E2E_SYNC_SENDER;
const receiver = process.env.E2E_SYNC_RECEIVER;
const configPath = process.env.E2E_SYNC_CONFIG;
const protectedSerial = process.env.CRYPTEX_E2E_PROTECTED_DEVICE;
if (!sender || !receiver || !configPath || sender === receiver || [sender, receiver].includes(protectedSerial)) {
  throw new Error('Set distinct E2E_SYNC_SENDER and E2E_SYNC_RECEIVER dedicated serials and E2E_SYNC_CONFIG; the protected device is forbidden.');
}
const configuration = JSON.parse(readFileSync(configPath, 'utf8'));
const turnExpiry = Number(configuration.env?.TURN_USERNAME?.split(':')[0]);
if (!Number.isFinite(turnExpiry) || turnExpiry < Math.floor(Date.now() / 1000) + 900) {
  throw new Error('TURN fixture credentials expire too soon. Regenerate private configuration with sync-config.mjs before starting the two-device journey.');
}
const temporary = mkdtempSync(join(tmpdir(), 'cryptex-sync-e2e-'));
mkdirSync(join(mobile, 'e2e/results'), { recursive: true });
const evidencePaths = [];
const discoveredPhrases = new Set();
function redactText(text, secrets) {
  for (const secret of secrets) {
    const variants = new Set([secret, JSON.stringify(secret).slice(1, -1)]);
    for (const value of Array.from(variants)) {
      variants.add(value.replaceAll('/', '\\/'));
      for (const upper of [false, true]) {
        const escaped = value.replace(/[<>&='"]/g, char => {
          const hex = char.charCodeAt(0).toString(16).padStart(4, '0');
          return `\\u${upper ? hex.toUpperCase() : hex}`;
        });
        variants.add(escaped);
        variants.add(escaped.replaceAll('/', '\\/'));
      }
    }
    for (const value of Array.from(variants)) variants.add(JSON.stringify(value).slice(1, -1));
    for (const value of [...variants].sort((left, right) => right.length - left.length)) {
      text = text.split(value).join('[REDACTED]');
    }
  }
  return text;
}
function redactEvidence() {
  const secrets = [configuration.env.SIGNALING_SECRET, configuration.env.TURN_PASSWORD, configuration.env.TRANSFER_PHRASE, ...discoveredPhrases].filter(Boolean);
  for (const path of evidencePaths) {
    if (!existsSync(path)) continue;
    const text = redactText(readFileSync(path, 'utf8'), secrets);
    writeFileSync(path, text, { mode: 0o600 });
    chmodSync(path, 0o600);
  }
}
function run(program, args, capture = false) {
  const result = spawnSync(program, args, { cwd: mobile, stdio: capture ? 'pipe' : 'inherit', encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${program} failed with status ${result.status}`);
  return result.stdout;
}
const invitationName = /^e2e-invitation(?: \(\d+\))?\.cryxlink$/;
function invitationFiles(serial) {
  return run('adb', ['-s', serial, 'shell', 'ls', '-1', '/sdcard/Download'], true)
    .split(/\r?\n/).filter(name => invitationName.test(name));
}
function clearCapturedInvitations(serial) {
  // A former receiver has shell-owned pushed files that the capture activity
  // cannot see/delete under scoped storage. Remove only this fixture's exact
  // names, including MediaStore reservations that could suffix the new export.
  const rows = run('adb', ['-s', serial, 'shell', 'content', 'query', '--uri',
    'content://media/external/file', '--projection', '_id:_display_name:relative_path'], true);
  for (const row of rows.split(/\r?\n/)) {
    const match = row.match(/\b_id=(\d+), _display_name=(.*), relative_path=Download\/$/);
    if (!match || !invitationName.test(match[2])) continue;
    run('adb', ['-s', serial, 'shell', 'content', 'delete', '--uri',
      `content://media/external/file/${match[1]}`], true);
  }
  for (const name of invitationFiles(serial)) {
    run('adb', ['-s', serial, 'shell', 'rm', '-f', `'/sdcard/Download/${name}'`], true);
  }
  if (invitationFiles(serial).length) throw new Error('Could not clear previous fixture invitations from the dedicated sender');
}
function publishEvidence(callback, primaryFailure) {
  try {
    callback();
  } catch (error) {
    const failure = new Error('Could not publish sanitized sync evidence', { cause: error });
    if (primaryFailure) {
      // Keep the original Maestro failure as the reported cause. Publication
      // failure still accompanies it, and the overall run remains unsuccessful.
      primaryFailure.evidenceFailure = failure;
      return;
    }
    throw failure;
  }
}
function flow(serial, name, configuration = configPath) {
  const { env: configuredEnv } = JSON.parse(readFileSync(configuration, 'utf8'));
  const env = { ...configuredEnv, ...e2eIdentity() };
  const wrapper = join(temporary, `${name}.yaml`);
  writeFileSync(wrapper, `appId: ${env.CRYPTEX_APP_ID}\nenv: ${JSON.stringify(env)}\n---\n- runFlow: ${JSON.stringify(join(mobile, 'e2e/flows', `${name}.yaml`))}\n`, { mode: 0o600 });
  const artifacts = join(temporary, `${name}-artifacts`);
  const privateLog = join(temporary, `${name}.log`);
  const privateJunit = join(temporary, `${name}.xml`);
  const descriptor = openSync(privateLog, 'w', 0o600);
  const secrets = [env.SIGNALING_SECRET, env.TURN_PASSWORD, env.TRANSFER_PHRASE].filter(Boolean);
  const redact = text => redactText(text, secrets);
  let result;
  let primaryFailure;
  let copiedPhrases = [];
  function discoverSenderPhrases() {
    if (name !== 'sync-link-sender') return;
    let phraseOutput = readFileSync(privateLog, 'utf8');
    function collectText(directory) {
      if (!existsSync(directory)) return;
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) collectText(path);
        else if (/\.(?:log|json|xml|yaml|yml|txt)$/.test(entry.name)) phraseOutput += '\n' + readFileSync(path, 'utf8');
      }
    }
    collectText(artifacts);
    if (existsSync(privateJunit)) phraseOutput += '\n' + readFileSync(privateJunit, 'utf8');
    copiedPhrases = [...phraseOutput.matchAll(/E2E_TRANSFER_PHRASE:([a-z]+(?: [a-z]+){11})\b/g)].map(match => match[1]);
    // A failed copy can still leave the phrase as an exact UI text value in
    // hierarchy/debug evidence. Restrict this fallback to quoted twelve-word
    // lowercase values in the sender phase; it never supplies the receiver key.
    const visiblePhrases = [...phraseOutput.matchAll(/\\?["']([a-z]+(?: [a-z]+){11})\\?["']/g)].map(match => match[1]);
    for (const phrase of [...copiedPhrases, ...visiblePhrases]) discoveredPhrases.add(phrase);
    secrets.push(...discoveredPhrases);
  }
  console.log(`Sync phase ${name} on ${serial} started`);
  try {
    result = spawnSync('maestro', ['--device', serial, 'test', '--format', 'junit',
      '--output', privateJunit, '--test-output-dir', artifacts,
      '--debug-output', artifacts, wrapper], { cwd: mobile, stdio: ['ignore', descriptor, descriptor] });
    discoverSenderPhrases();
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Maestro failed with status ${result.status}`);
    if (name === 'sync-link-sender') {
      if (new Set(copiedPhrases).size !== 1) throw new Error('Could not identify exactly one copied twelve-word transfer phrase');
      console.log(`Sync phase ${name} on ${serial} passed`);
      return copiedPhrases[0];
    }
    console.log(`Sync phase ${name} on ${serial} passed`);
  } catch (error) {
    primaryFailure = new Error(`Sync phase ${name} failed on ${serial}; inspect e2e/results/${name}.xml`, { cause: error });
    throw primaryFailure;
  } finally {
    publishEvidence(() => {
      closeSync(descriptor);
      discoverSenderPhrases();
      const logPath = join(mobile, 'e2e/results', `${name}.log`);
      writeFileSync(logPath, redact(readFileSync(privateLog, 'utf8')), { mode: 0o600 });
      chmodSync(logPath, 0o600);
      const junit = join(mobile, 'e2e/results', `${name}.xml`);
      if (existsSync(privateJunit)) {
        writeFileSync(junit, redact(readFileSync(privateJunit, 'utf8')), { mode: 0o600 });
        chmodSync(junit, 0o600);
      }
      evidencePaths.push(logPath, junit);
      // Maestro records typed secrets in debug logs and screenshots. Retain sanitized
      // textual evidence, and remove private images with the temporary workspace.
      const destination = join(mobile, 'e2e/results', `${name}-artifacts`);
      // Replace only this runner-owned phase's evidence, including older failure files.
      rmSync(destination, { recursive: true, force: true });
      mkdirSync(destination, { recursive: true, mode: 0o700 });
      chmodSync(destination, 0o700);
      function retainText(directory, prefix = '') {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
          const source = join(directory, entry.name);
          const relative = join(prefix, entry.name);
          if (entry.isDirectory()) retainText(source, relative);
          else if (/\.(?:log|json|xml|yaml|yml|txt)$/.test(entry.name)) {
            const target = join(destination, relative);
            mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
            chmodSync(dirname(target), 0o700);
            writeFileSync(target, redact(readFileSync(source, 'utf8')), { mode: 0o600 });
            chmodSync(target, 0o600);
            evidencePaths.push(target);
          }
        }
      }
      try { retainText(artifacts); } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }, primaryFailure);
  }
}
try {
  const port = configuration.env.SIGNALING_PORT;
  if (!/^\d+$/.test(port)) throw new Error('Invalid signaling port in E2E_SYNC_CONFIG');
  for (const serial of [sender, receiver]) {
    run('adb', ['-s', serial, 'reverse', `tcp:${port}`, `tcp:${port}`]);
  }
  clearCapturedInvitations(sender);
  configuration.env.TRANSFER_PHRASE = flow(sender, 'sync-link-sender');
  redactEvidence();
  const capturedNames = invitationFiles(sender);
  if (capturedNames.length !== 1 || capturedNames[0] !== 'e2e-invitation.cryxlink') {
    throw new Error('Actual shared invitation was not captured under its fresh canonical fixture filename');
  }
  const receiverConfig = join(temporary, 'receiver.json');
  writeFileSync(receiverConfig, JSON.stringify(configuration), { mode: 0o600 });
  const invitation = join(temporary, 'e2e-invitation.cryxlink');
  run('adb', ['-s', sender, 'pull', '/sdcard/Download/e2e-invitation.cryxlink', invitation]);
  run('adb', ['-s', receiver, 'push', invitation, '/sdcard/Download/e2e-invitation.cryxlink']);
  run('adb', ['-s', receiver, 'shell', 'am', 'broadcast', '-a', 'android.intent.action.MEDIA_SCANNER_SCAN_FILE',
    '-d', 'file:///sdcard/Download/e2e-invitation.cryxlink']);
  const sourceBytes = readFileSync(invitation);
  if (!sourceBytes.length) throw new Error('Captured invitation is empty');
  const roundtrip = join(temporary, 'receiver-invitation.cryxlink');
  run('adb', ['-s', receiver, 'pull', '/sdcard/Download/e2e-invitation.cryxlink', roundtrip]);
  const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
  if (sha256(sourceBytes) !== sha256(readFileSync(roundtrip))) throw new Error('Receiver invitation bytes differ from the actual shared export');
  flow(sender, 'sync-link-sender-start');
  flow(receiver, 'sync-link-receiver', receiverConfig);
  flow(sender, 'sync-link-sender-complete');
  flow(sender, 'sync-linked-edit');
  flow(receiver, 'sync-linked-verify', receiverConfig);
  flow(receiver, 'sync-linked-return-edit', receiverConfig);
  flow(sender, 'sync-linked-return-verify');
} finally {
  redactEvidence();
  rmSync(temporary, { recursive: true, force: true });
}
