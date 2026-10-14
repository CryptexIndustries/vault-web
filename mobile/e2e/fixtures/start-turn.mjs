import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { isIP } from 'node:net';

const [environmentPath, relayAddress] = process.argv.slice(2);
if (!environmentPath || isIP(relayAddress || '') !== 4) {
  throw new Error('Usage: node start-turn.mjs CLOUD_ENV_FILE HOST_LAN_IPV4');
}
const line = readFileSync(environmentPath, 'utf8').split(/\r?\n/).find(value => value.startsWith('TURN_AUTH_SECRET='));
const secret = line?.slice('TURN_AUTH_SECRET='.length).trim().replace(/^(["'])(.*)\1$/, '$2');
if (!secret || /[\r\n]/.test(secret)) throw new Error('Local TURN_AUTH_SECRET is missing or invalid');
const directory = mkdtempSync(join(tmpdir(), 'cryptex-e2e-turn-'));
const configuration = join(directory, 'turnserver.conf');
writeFileSync(configuration, [
  'listening-port=3478', 'listening-ip=127.0.0.1', `listening-ip=${relayAddress}`, `relay-ip=${relayAddress}`,
  'min-port=49160', 'max-port=49260', 'realm=cryptex-e2e.local',
  'use-auth-secret', `static-auth-secret=${secret}`, 'no-tls', 'no-dtls',
  'no-cli', 'no-multicast-peers', 'allow-loopback-peers', 'log-file=stdout', 'simple-log', '',
].join('\n'), { mode: 0o600 });
const result = spawnSync('docker', [
  'run', '-d', '--name', 'cryptex-vault-e2e-turn', '--user', '0:0', '--network', 'host',
  '--mount', `type=bind,src=${configuration},dst=/etc/coturn/turnserver.conf,readonly`,
  'coturn/coturn:4.6.3', '-c', '/etc/coturn/turnserver.conf', '--relay-threads=2',
], { encoding: 'utf8' });
if (result.error || result.status !== 0) {
  rmSync(directory, { recursive: true, force: true });
  throw result.error || new Error(result.stderr);
}
console.log(`Dedicated TURN fixture started. Stop with docker rm -f cryptex-vault-e2e-turn, then remove ${directory}.`);
