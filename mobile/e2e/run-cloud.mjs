import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { maestroProfileArgs } from './profile.mjs';

const serial = process.env.MAESTRO_DEVICE || process.env.ANDROID_SERIAL;
if (!serial || serial.trim() !== serial || serial === process.env.CRYPTEX_E2E_PROTECTED_DEVICE) {
    throw new Error('Select a dedicated, unprotected device with MAESTRO_DEVICE or ANDROID_SERIAL.');
}
const port = Number(process.env.CRYPTEX_E2E_CLOUD_PORT ?? 43111);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid cloud fixture port.');
const origin = `http://127.0.0.1:${port}`;
const deviceScenario = process.env.CRYPTEX_E2E_DEVICE_SCENARIO === '1';
const deviceCount = Number(process.env.CRYPTEX_E2E_DEVICE_COUNT ?? 3);
let fixture;
async function existingFixture() {
    let response;
    try { response = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(1000) }); }
    catch (error) {
        if (error.cause?.code === 'ECONNREFUSED') return false;
        throw new Error(`Cannot inspect cloud fixture at ${origin}.`, { cause: error });
    }
    const health = await response.json().catch(() => null);
    if (!response.ok || health?.fixture !== 'cryptex-mobile-online-services') {
        throw new Error(`Port ${port} is occupied by another service; refusing to use it for cloud tests.`);
    }
    if (!!health.deviceScenario !== deviceScenario) throw new Error('Cloud fixture scenario differs. Stop the existing fixture before running this suite.');
    if ((health.deviceCount ?? 3) !== deviceCount) throw new Error('Cloud fixture device count differs. Stop the existing fixture before running this suite.');
    return true;
}
async function command(program, args) {
    const child = spawn(program, args, { stdio: 'inherit' });
    const stop = () => child.kill('SIGTERM');
    process.on('SIGINT', stop); process.on('SIGTERM', stop);
    try {
        await new Promise((resolve, reject) => {
            child.on('error', reject);
            child.on('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`${program} failed (${signal ?? code}).`)));
        });
    } finally {
        process.off('SIGINT', stop); process.off('SIGTERM', stop);
    }
}
try {
    if (!await existingFixture()) {
        fixture = spawn(process.execPath, [fileURLToPath(new URL('./fixtures/online-services.mjs', import.meta.url))], { stdio: 'inherit' });
        let startupError;
        fixture.on('error', error => { startupError = error; });
        let ready = false;
        for (let attempt = 0; attempt < 50; attempt++) {
            if (startupError) throw startupError;
            if (fixture.exitCode !== null) throw new Error('Cloud fixture exited before startup.');
            if (await existingFixture()) { ready = true; break; }
            await delay(100);
        }
        if (!ready) throw new Error('Cloud fixture did not start within five seconds.');
    }
    await command('adb', ['-s', serial, 'reverse', `tcp:${port}`, `tcp:${port}`]);
    await command('maestro', ['--device', serial, 'test', ...maestroProfileArgs(), ...process.argv.slice(2)]);
} finally {
    if (fixture && fixture.exitCode === null) {
        fixture.kill('SIGTERM');
        await new Promise(resolve => fixture.once('exit', resolve));
    }
}
