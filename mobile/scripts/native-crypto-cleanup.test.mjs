import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { webcrypto } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const runnerUrl = new URL('./test-native-crypto.mjs', import.meta.url).href;
const key = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const result = {
  publicJwk: await webcrypto.subtle.exportKey('jwk', key.publicKey),
  signature: Buffer.from(await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key.privateKey,
    new TextEncoder().encode('public signature fixture'))).toString('hex'),
  webrtc: { rounds: 2, applicationOnly: true, immediateHellos: 2, textMessages: 18,
    binaryBytes: 524392, largeMessageBytes: 131089 },
};

function execute(mode, serial = 'emulator-5564', abi = 'x86_64') {
  const directory = mkdtempSync(join(tmpdir(), 'cryptex-crypto-cleanup-'));
  try {
    writeFileSync(join(directory, 'runner.mjs'), `
      import { createRequire, syncBuiltinESMExports } from 'node:module';
      import * as commands from './fake-child-process.mjs';
      Object.assign(createRequire(import.meta.url)('node:child_process'), commands);
      syncBuiltinESMExports();
      await import(${JSON.stringify(runnerUrl)});
    `);
    writeFileSync(join(directory, 'result.json'), JSON.stringify(result));
    writeFileSync(join(directory, 'fake-child-process.mjs'), `
      import { appendFileSync, readFileSync } from 'node:fs';
      const mode = process.env.FAKE_MODE;
      const record = (program, args) => appendFileSync(process.env.FAKE_CALLS, JSON.stringify({ program, args }) + '\\n');
      export function execFileSync(program, args) {
        record(program, args);
        if (program !== 'adb') throw new Error('Unexpected fixture command: ' + program);
        if (args[2] === 'uninstall') {
          if (mode.includes('cleanup-fail')) throw new Error('FAKE_UNINSTALL_FAILED');
          return 'Success\\n';
        }
        if (args[2] === 'shell' && args[3] === 'getprop') return process.env.FAKE_ABI + '\\n';
        if (args[2] === 'shell' && args[3]?.startsWith('date ')) return '10-02 12:00:00.000\\n';
        if (args[2] === 'shell' && args[3] === 'am' && ['force-stop', 'start'].includes(args[4])) {
          if (args[4] === 'start' && mode === 'launch-fail') throw new Error('FAKE_LAUNCH_FAILED');
          return 'Success\\n';
        }
        if (args[2] === 'logcat') {
          if (mode.includes('runtime-fail')) return 'CRYPTEX_CRYPTO_FAILURE original runtime failure';
          return 'CRYPTEX_CRYPTO_RESULT ' + readFileSync(process.env.FAKE_RESULT, 'utf8');
        }
        if (args[2] === 'install') return 'Success\\n';
        throw new Error('Unexpected fixture ADB command: ' + args.join(' '));
      }
      export function spawnSync(program, args) {
        record(program, args);
        if (program === './gradlew') return { status: 0, stdout: '' };
        if (program === 'adb' && args[2] === 'shell' && args[3] === 'pidof') return { status: 0, stdout: '1234\\n' };
        throw new Error('Unexpected fixture child: ' + program + ' ' + args.join(' '));
      }
    `);
    const output = spawnSync(process.execPath, [join(directory, 'runner.mjs')], {
      encoding: 'utf8', env: { ...process.env, ANDROID_SERIAL: serial,
        CRYPTEX_E2E_PROTECTED_DEVICE: 'emulator-5556', CRYPTEX_APP_PROFILE: 'production', FAKE_MODE: mode, FAKE_ABI: abi,
        FAKE_CALLS: join(directory, 'calls.jsonl'), FAKE_RESULT: join(directory, 'result.json') },
    });
    let calls = [];
    try { calls = readFileSync(join(directory, 'calls.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    return { ...output, calls };
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

for (const abi of ['x86_64', 'arm64-v8a', 'x86', 'armeabi-v7a']) {
  test(`native crypto builds its test bundle for the selected ${abi} device`, () => {
    const output = execute('success', 'emulator-5564', abi);
    assert.equal(output.status, 0, output.stderr);
    const builds = output.calls.filter(call => call.program === './gradlew');
    assert.equal(builds.length, 1);
    assert.deepEqual(builds[0].args, [
      ':app:createBundleE2eJsAndAssets', '--rerun', ':app:assembleE2e',
      `-PreactNativeArchitectures=${abi}`, '-I', '../tests/native-crypto.init.gradle', '--console=plain',
    ]);
  });
}

for (const mode of ['success', 'runtime-fail', 'launch-fail', 'cleanup-fail', 'runtime-fail-cleanup-fail']) {
  test(`native crypto runner isolates its package after ${mode}`, () => {
    const output = execute(mode);
    assert.equal(output.status, mode === 'success' ? 0 : 1, output.stderr);
    const adbCalls = output.calls.filter(call => call.program === 'adb');
    assert.ok(adbCalls.length > 0);
    for (const call of adbCalls) assert.deepEqual(call.args.slice(0, 2), ['-s', 'emulator-5564']);
    assert.deepEqual(adbCalls.filter(call => call.args[2] === 'uninstall').map(call => call.args),
      [['-s', 'emulator-5564', 'uninstall', 'com.cryptex.vault.cryptotest']]);
    assert.equal(output.stdout.includes('tests passed.'), mode === 'success');
    if (mode.includes('runtime-fail')) assert.match(output.stderr, /CRYPTEX_CRYPTO_FAILURE original runtime failure/);
    if (mode === 'launch-fail') assert.match(output.stderr, /FAKE_LAUNCH_FAILED/);
    if (mode.includes('cleanup-fail')) assert.match(output.stderr, /cleanup.*failed/i);
  });
}

test('protected emulator is refused before any external command', () => {
  const output = execute('success', 'emulator-5556');
  assert.equal(output.status, 1);
  assert.deepEqual(output.calls, []);
});
