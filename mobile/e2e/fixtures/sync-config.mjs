import { readFile, writeFile, chmod } from 'node:fs/promises';
import { createHmac } from 'node:crypto';

// Generate short-lived Maestro configuration from the existing local services.
// Output must live outside the repository. Never print credentials to the log.
const [environmentPath, outputPath] = process.argv.slice(2);
if (!environmentPath || !outputPath) {
  throw new Error('Usage: node sync-config.mjs CLOUD_ENV_FILE OUTPUT_CONFIG');
}
const environment = {};
for (const line of (await readFile(environmentPath, 'utf8')).split(/\r?\n/)) {
  const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
  if (!match) continue;
  environment[match[1]] = match[2].trim().replace(/^(["'])(.*)\1$/, '$2');
}
for (const name of ['NEXT_PUBLIC_PUSHER_APP_ID', 'NEXT_PUBLIC_PUSHER_APP_KEY', 'PUSHER_APP_SECRET', 'TURN_AUTH_SECRET']) {
  if (!environment[name]) throw new Error(`Missing ${name} in local service configuration`);
}
const username = `${Math.floor(Date.now() / 1000) + 3600}:mobile-e2e`;
const env = {
  SIGNALING_HOST: 'localhost',
  SIGNALING_PORT: environment.NEXT_PUBLIC_PUSHER_APP_PORT || '6011',
  SIGNALING_APP_ID: environment.NEXT_PUBLIC_PUSHER_APP_ID,
  SIGNALING_KEY: environment.NEXT_PUBLIC_PUSHER_APP_KEY,
  SIGNALING_SECRET: environment.PUSHER_APP_SECRET,
  TURN_HOST: process.env.E2E_TURN_HOST || '10.0.2.2:3478',
  TURN_USERNAME: username,
  TURN_PASSWORD: createHmac('sha1', environment.TURN_AUTH_SECRET).update(username).digest('base64'),
};
await writeFile(outputPath, JSON.stringify({ env }), { mode: 0o600 });
await chmod(outputPath, 0o600);
