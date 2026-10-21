// SSH agent approval end to end: a real relay-server (token mode) and
// cryptex-agent run on this machine; the phone pairs, approves one
// `ssh-keygen -Y sign`, denies another and revokes the agent.
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { maestroProfileArgs } from './profile.mjs';

const serial = process.env.MAESTRO_DEVICE || process.env.ANDROID_SERIAL;
if (!serial || serial.trim() !== serial || serial === process.env.CRYPTEX_E2E_PROTECTED_DEVICE) {
    throw new Error('Select a dedicated, unprotected device with MAESTRO_DEVICE or ANDROID_SERIAL.');
}
const port = Number(process.env.CRYPTEX_E2E_RELAY_PORT ?? 43112);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid relay port.');
for (const tool of ['go', 'ssh-keygen', 'ssh-add', 'script', 'adb', 'maestro']) {
    if (spawnSync('sh', ['-c', `command -v ${tool}`]).status !== 0) throw new Error(`${tool} is required.`);
}

const services = fileURLToPath(new URL('../../services/', import.meta.url));
const setupFlow = fileURLToPath(new URL('./flows/ssh-agent-setup.yaml', import.meta.url));
const flow = fileURLToPath(new URL('./flows/ssh-agent.yaml', import.meta.url));
const relayUrl = `http://127.0.0.1:${port}`;
const token = randomBytes(24).toString('hex');
const work = mkdtempSync(join(tmpdir(), 'cryptex-ssh-agent-e2e-'));
const children = new Set();
// Terminal escape sequences in the agent's output (ESC, then CSI).
const ansi = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[a-zA-Z]`, 'g');

function start(program, args, options = {}) {
    const child = spawn(program, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options });
    children.add(child);
    child.on('exit', () => children.delete(child));
    return child;
}

function finished(child, name) {
    return new Promise((resolve, reject) => {
        if (child.exitCode !== null) return resolve(child.exitCode);
        child.on('error', reject);
        child.on('exit', code => resolve(code ?? 1));
    }).then(code => ({ name, code }));
}

function run(program, args, options = {}) {
    const result = spawnSync(program, args, { encoding: 'utf8', ...options });
    if (result.error) throw result.error;
    return result;
}

async function waitFor(check, what, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await check()) return;
        await delay(250);
    }
    throw new Error(`Timed out waiting for ${what}.`);
}

const portOpen = () => new Promise(resolve => {
    const socket = connect(port, '127.0.0.1');
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
});

// The agent keeps its key and settings under XDG directories; give it its own.
const home = join(work, 'home');
const agentEnv = { ...process.env, HOME: home, TERM: 'dumb' };
for (const name of ['data', 'config', 'runtime']) {
    const dir = join(work, name);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    agentEnv[`XDG_${name === 'runtime' ? 'RUNTIME_DIR' : `${name.toUpperCase()}_HOME`}`] = dir;
}
mkdirSync(home, { recursive: true });
const socket = join(agentEnv.XDG_RUNTIME_DIR, 'cryptex-agent.sock');
const signEnv = { ...agentEnv, SSH_AUTH_SOCK: socket };

/** ssh-keygen -Y sign through the agent; the phone answers. */
async function sign(name) {
    const file = join(work, `${name}.txt`);
    writeFileSync(file, `Signed by the Cryptex Vault SSH agent E2E (${name}).\n`);
    const child = start('ssh-keygen', ['-Y', 'sign', '-n', 'file', '-f', join(work, 'key.pub'), file], { env: signEnv });
    const { code } = await Promise.race([
        finished(child, name),
        delay(150_000).then(() => { child.kill(); return { code: 'timeout' }; }),
    ]);
    return { file, code };
}

let maestro;
try {
    if (await portOpen()) throw new Error(`Port ${port} is in use; set CRYPTEX_E2E_RELAY_PORT.`);
    const bin = join(work, 'bin');
    const build = run('go', ['build', '-o', `${bin}/`, './cmd/relay-server', './cmd/cryptex-agent'], { cwd: services, stdio: 'inherit' });
    if (build.status !== 0) throw new Error(`Building relay-server and cryptex-agent failed (go build exit ${build.status ?? build.signal}).`);
    const agent = join(bin, 'cryptex-agent');

    const relay = start(join(bin, 'relay-server'), [], {
        env: {
            ...process.env,
            RELAY_AUTH_MODE: 'token',
            RELAY_ACCESS_TOKEN: token,
            RELAY_PUBLIC_URL: relayUrl,
            RELAY_LISTEN_ADDR: `127.0.0.1:${port}`,
            RELAY_DB_PATH: join(work, 'relay.db'),
            RELAY_METRICS_ADDR: 'off',
        },
    });
    relay.stderr.pipe(process.stderr);
    await waitFor(portOpen, 'the relay', 10_000);
    // The phone reaches the relay at the same address the agent uses, so the
    // origin both sign into Auth and revoke requests matches.
    run('adb', ['-s', serial, 'reverse', `tcp:${port}`, `tcp:${port}`], { stdio: 'inherit' });

    // The vault and its SSH key first: a pairing code lasts three minutes,
    // and on a freshly booted emulator this setup alone can take most of it.
    maestro = start('maestro', ['--device', serial, 'test', ...maestroProfileArgs(), setupFlow], { stdio: 'inherit' });
    const setup = await finished(maestro, 'maestro');
    if (setup.code !== 0) throw new Error(`The vault setup flow failed (${setup.code}).`);

    // `pair` waits for Enter on a terminal; `script` gives it one.
    const pair = start('script', ['-q', '-f', '-e', '-c', `${agent} pair --relay ${relayUrl}`, '/dev/null'], {
        env: agentEnv,
        stdio: ['pipe', 'pipe', 'inherit'],
    });
    let pairOutput = '';
    let confirmed = false;
    pair.stdout.on('data', chunk => {
        pairOutput += chunk.toString().replace(ansi, '');
        const shown = pairOutput.match(/Check that it shows:\s*([0-9A-Z]{4}-[0-9A-Z]{4})/);
        if (!confirmed && shown && /press enter/i.test(pairOutput)) {
            confirmed = true;
            // Give the flow time to see the code before the phone moves on.
            console.log(`Agent shows confirmation code ${shown[1]}; pressing Enter.`);
            setTimeout(() => pair.stdin.write('\r'), 8000);
        }
    });
    let code;
    await waitFor(() => (code = pairOutput.match(/cryptex-pair:[A-Za-z0-9_-]+/)?.[0]), 'the pairing code', 30_000);

    maestro = start('maestro', [
        '--device', serial, 'test', ...maestroProfileArgs(),
        '-e', `PAIRING_CODE=${code}`, '-e', `RELAY_TOKEN=${token}`,
        ...process.argv.slice(2), flow,
    ], { stdio: 'inherit' });
    const maestroDone = finished(maestro, 'maestro');
    const pairDone = finished(pair, 'pairing');
    const first = await Promise.race([maestroDone, pairDone]);
    if (first.name === 'maestro') throw new Error(`Maestro stopped before pairing finished (${first.code}).`);
    if (first.code !== 0 || !/Paired with/.test(pairOutput)) throw new Error(`Pairing failed:\n${pairOutput}`);

    const service = start(agent, ['run'], { env: agentEnv });
    service.stderr.pipe(process.stderr);
    await waitFor(() => existsSync(socket), 'the agent socket', 10_000);
    const keys = run('ssh-add', ['-L'], { env: signEnv });
    const key = keys.stdout.split('\n').find(line => line.startsWith('ssh-'));
    if (!key) throw new Error(`The agent lists no keys:\n${keys.stdout}${keys.stderr}`);
    writeFileSync(join(work, 'key.pub'), `${key}\n`);
    const [type, blob] = key.split(' ');
    writeFileSync(join(work, 'allowed_signers'), `e2e@cryptex-vault ${type} ${blob}\n`);
    chmodSync(join(work, 'key.pub'), 0o600);

    const approved = await sign('approved');
    if (approved.code !== 0) throw new Error(`The approved signature failed (${approved.code}).`);
    const verify = run('ssh-keygen', ['-Y', 'verify', '-f', join(work, 'allowed_signers'), '-I', 'e2e@cryptex-vault',
        '-n', 'file', '-s', `${approved.file}.sig`], { input: readFileSync(approved.file) });
    if (verify.status !== 0) throw new Error(`ssh-keygen -Y verify rejected the signature:\n${verify.stdout}${verify.stderr}`);
    console.log('Approved signature verifies with ssh-keygen -Y verify.');

    // Let the approval screen close first, so the flow sees the second request arrive.
    await delay(10_000);
    const denied = await sign('denied');
    if (denied.code === 0 || existsSync(`${denied.file}.sig`)) throw new Error('The denied request produced a signature.');
    console.log('Denied request was refused.');

    const result = await maestroDone;
    if (result.code !== 0) throw new Error(`Maestro failed (${result.code}).`);
    await waitFor(() => /revoked/i.test(run(agent, ['status'], { env: agentEnv }).stdout), 'the agent to report the revocation', 15_000);
    console.log('The agent reports it was revoked.');
} finally {
    for (const child of children) child.kill('SIGTERM');
    spawnSync('adb', ['-s', serial, 'reverse', '--remove', `tcp:${port}`], { stdio: 'ignore' });
    rmSync(work, { recursive: true, force: true });
}
