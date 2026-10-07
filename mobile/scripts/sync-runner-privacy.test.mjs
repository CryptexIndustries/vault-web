import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, rmSync, copyFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const secrets = ['fixture<secret>/=', 'fixture/base64=='];
const phrases = ['alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu',
  'one two three four five six seven eight nine ten eleven twelve'];
const gson = value => value.replace(/[<>&='"]/g, char => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0')).replaceAll('/', '\\/');

for (const mode of ['success', 'failure', 'sender-failure', 'markerless-failure', 'conflict', 'stale-evidence', 'repeated-invitation', 'suffixed-capture', 'publication-failure', 'primary-and-publication-failure']) {
  test(`sync runner publishes only sanitized private evidence after ${mode}`, () => {
    const root = mkdtempSync(join(tmpdir(), 'cryptex-sync-privacy-test-'));
    try {
      mkdirSync(join(root, 'e2e'));
      mkdirSync(join(root, 'bin'));
      const staleDirectory = join(root, 'e2e/results/sync-link-sender-artifacts/nested');
      const staleSecret = 'prior-run-private-material';
      if (mode === 'stale-evidence') {
        mkdirSync(staleDirectory, { recursive: true, mode: 0o700 });
        writeFileSync(join(staleDirectory, 'old.json'), JSON.stringify({ secret: staleSecret }), { mode: 0o600 });
        writeFileSync(join(staleDirectory, 'old.png'), 'prior private image', { mode: 0o600 });
      }
      copyFileSync(new URL('../e2e/run-sync-link.mjs', import.meta.url), join(root, 'e2e/run-sync-link.mjs'));
      copyFileSync(new URL('../e2e/profile.mjs', import.meta.url), join(root, 'e2e/profile.mjs'));
      mkdirSync(join(root, 'config'));
      copyFileSync(new URL('../config/profiles.cjs', import.meta.url), join(root, 'config/profiles.cjs'));
      const config = join(root, 'config.json');
      writeFileSync(config, JSON.stringify({ env: {
        SIGNALING_PORT: '6011', SIGNALING_SECRET: secrets[0], TURN_PASSWORD: secrets[1],
        TURN_USERNAME: `${Math.floor(Date.now() / 1000) + 3600}:mobile-e2e`,
      } }), { mode: 0o600 });
      // Both executables are isolated adapters. They never delegate to actual tools.
      const downloadsState = join(root, 'downloads.json');
      writeFileSync(downloadsState, JSON.stringify({ files: ['e2e-invitation.cryxlink',
        'e2e-invitation (1).cryxlink', 'unrelated.cryxlink', 'e2e-invitation (draft).cryxlink'],
        rows: [
          { id: 1, name: 'e2e-invitation.cryxlink', directory: 'Download/' },
          { id: 2, name: 'e2e-invitation (1).cryxlink', directory: 'Download/' },
          { id: 3, name: 'unrelated.cryxlink', directory: 'Download/' },
          { id: 4, name: 'e2e-invitation.cryxlink', directory: 'Documents/' },
        ] }));
      writeFileSync(join(root, 'bin/adb'), `#!${process.execPath}
        const fs = require('node:fs');
        const statePath = ${JSON.stringify(downloadsState)};
        const state = JSON.parse(fs.readFileSync(statePath));
        const args = process.argv;
        if (args.includes('query')) console.log(state.rows.map((row,index) =>
          'Row: ' + index + ' _id=' + row.id + ', _display_name=' + row.name + ', relative_path=' + row.directory).join('\\n'));
        if (args.includes('delete')) {
          const id = Number(args.at(-1).split('/').at(-1));
          state.rows = state.rows.filter(row => row.id !== id);
        }
        if (args.includes('ls')) console.log(state.files.join('\\n'));
        if (args.includes('rm')) {
          const name = args.at(-1).replaceAll("'", '').split('/').at(-1);
          state.files = state.files.filter(file => file !== name);
        }
        fs.writeFileSync(statePath, JSON.stringify(state));
        if (process.argv.includes('pull')) fs.writeFileSync(process.argv.at(-1), 'actual-fixture-invitation');
      `, { mode: 0o700 });
      writeFileSync(join(root, 'bin/maestro'), `#!${process.execPath}
        const fs = require('node:fs'), path = require('node:path');
        const args = process.argv;
        const output = args[args.indexOf('--output') + 1];
        const art = args[args.indexOf('--test-output-dir') + 1];
        const name = path.basename(args.at(-1), '.yaml');
        if (name === 'sync-link-sender') {
          const statePath = ${JSON.stringify(downloadsState)};
          const state = JSON.parse(fs.readFileSync(statePath));
          if (state.files.some(file => /^e2e-invitation(?: \\(\\d+\\))?\\.cryxlink$/.test(file)) ||
            state.rows.some(row => row.directory === 'Download/' && /^e2e-invitation(?: \\(\\d+\\))?\\.cryxlink$/.test(row.name))) process.exit(12);
          state.files.push(process.env.AUDIT_MODE === 'suffixed-capture' ? 'e2e-invitation (1).cryxlink' : 'e2e-invitation.cryxlink');
          fs.writeFileSync(statePath, JSON.stringify(state));
        }
        const env = JSON.parse(fs.readFileSync(process.env.E2E_SYNC_CONFIG)).env;
        const phrases = ${JSON.stringify(phrases)};
        const values = [env.SIGNALING_SECRET, env.TURN_PASSWORD, phrases[0]];
        if (process.env.AUDIT_MODE === 'conflict') values.push(phrases[1]);
        const gson = ${gson.toString()};
        const text = values.flatMap(value => [value, gson(value), JSON.stringify(gson(value)).slice(1, -1)]).join('\\n');
        fs.mkdirSync(art, { recursive: true });
        fs.writeFileSync(path.join(art, 'debug.log'), text +
          (process.env.AUDIT_MODE === 'markerless-failure'
            ? '\\n{"text":"' + phrases[0] + '"}' : '\\nE2E_TRANSFER_PHRASE:' + phrases[0]) +
          (process.env.AUDIT_MODE === 'conflict' ? '\\nE2E_TRANSFER_PHRASE:' + phrases[1] : ''));
        fs.writeFileSync(path.join(art, 'private.png'), 'private image');
        fs.writeFileSync(output, text);
        console.log(text);
        console.error(text);
        if (['publication-failure', 'primary-and-publication-failure'].includes(process.env.AUDIT_MODE) && name === 'sync-link-sender-start') {
          fs.rmSync(art, { recursive: true });
          fs.writeFileSync(art, 'invalid artifact directory');
          if (process.env.AUDIT_MODE === 'primary-and-publication-failure') process.exit(9);
        }
        if ((process.env.AUDIT_MODE === 'failure' && name === 'sync-link-sender-start') ||
          (['sender-failure', 'markerless-failure'].includes(process.env.AUDIT_MODE) && name === 'sync-link-sender')) process.exit(9);
      `, { mode: 0o700 });
      const invocation = () => spawnSync(process.execPath, [join(root, 'e2e/run-sync-link.mjs')], {
        encoding: 'utf8', env: { ...process.env, PATH: join(root, 'bin') + ':' + process.env.PATH,
          E2E_SYNC_CONFIG: config, E2E_SYNC_SENDER: 'audit-sender', E2E_SYNC_RECEIVER: 'audit-receiver',
          CRYPTEX_E2E_PROTECTED_DEVICE: 'audit-protected', AUDIT_MODE: mode },
      });
      const output = invocation();
      assert.equal(output.status, ['success', 'stale-evidence', 'repeated-invitation'].includes(mode) ? 0 : 1, output.stderr);
      if (mode === 'suffixed-capture') assert.match(output.stderr,
        /Actual shared invitation was not captured under its fresh canonical fixture filename/);
      if (mode === 'publication-failure') assert.match(output.stderr, /Could not publish sanitized sync evidence/);
      if (mode === 'primary-and-publication-failure') {
        assert.match(output.stderr, /Sync phase sync-link-sender-start failed on audit-sender/);
        assert.match(output.stderr, /Maestro failed with status 9/);
      }
      if (mode === 'repeated-invitation') assert.equal(invocation().status, 0, 'Repeated source retained a prior invitation');
      const downloads = JSON.parse(readFileSync(downloadsState));
      assert.ok(downloads.files.includes('unrelated.cryxlink'));
      assert.ok(downloads.files.includes('e2e-invitation (draft).cryxlink'));
      assert.deepEqual(downloads.rows.map(row => row.id), [3, 4]);
      const sensitiveValues = mode === 'conflict' ? [...secrets, ...phrases] : [...secrets, phrases[0]];
      if (mode === 'stale-evidence') {
        sensitiveValues.push(staleSecret);
        assert.equal(existsSync(join(staleDirectory, 'old.json')), false, 'Stale secret evidence retained');
        assert.equal(existsSync(join(staleDirectory, 'old.png')), false, 'Stale private image retained');
      }
      for (const value of sensitiveValues) assert.ok(!(output.stdout + output.stderr).includes(value), 'Terminal leaked a fixture secret');
      let retainedFiles = 0;
      function scan(directory) {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
          const path = join(directory, entry.name);
          if (entry.isDirectory()) {
            if (entry.name.endsWith('-artifacts')) assert.equal(statSync(path).mode & 0o777, 0o700);
            scan(path);
          } else {
            assert.equal(statSync(path).mode & 0o777, 0o600);
            assert.ok(!entry.name.endsWith('.png'), 'Private image retained');
            const text = readFileSync(path, 'utf8');
            for (const value of sensitiveValues) {
              for (const variant of [value, gson(value), JSON.stringify(gson(value)).slice(1, -1)]) {
                assert.ok(!text.includes(variant), 'Retained evidence leaked a fixture secret');
              }
            }
            retainedFiles++;
          }
        }
      }
      scan(join(root, 'e2e/results'));
      assert.ok(retainedFiles >= 3, 'Missing sanitized logs, JUnit, or debug evidence');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}
