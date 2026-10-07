import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

export function resolveExportRuntime(cwd, env, run = spawnSync) {
    // EAS uses this installed SDK CLI too, with its detected workflow.
    const result = run(process.execPath, ['node_modules/expo-updates/cli/build/cli.js', 'runtimeversion:resolve', '--platform', 'android'], { cwd, env, stdio: 'pipe', encoding: 'utf8' });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, 'Expo Updates runtime resolution failed.');
    const resolved = JSON.parse(result.stdout);
    assert.match(resolved.runtimeVersion || '', /^[a-f0-9]{40,64}$/, 'Missing native fingerprint runtime.');
    assert.ok(['managed', 'generic'].includes(resolved.workflow), 'Invalid native fingerprint workflow.');
    return { runtimeVersion: resolved.runtimeVersion, workflow: resolved.workflow };
}
