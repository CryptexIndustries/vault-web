import { createServer } from 'node:http';
import { createHash, createPublicKey, randomBytes, verify } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import superjson from 'superjson';

export const RECOVERY_PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art';
const fail = (message, code = 'BAD_REQUEST') => { throw Object.assign(new Error(message), { code }); };
const hash = bytes => createHash('sha256').update(bytes).digest('base64url');

// Disposable loopback contract fixture. The app still signs challenges and uploads
// real encrypted vault bytes. No application authentication or crypto is bypassed.
export function createOnlineServicesFixture({ origin = 'http://localhost:43111', deviceScenario = false, deviceCount = 3 } = {}) {
    if (!Number.isInteger(deviceCount) || deviceCount < 3 || deviceCount > 300) throw new Error('Device fixture count must be an integer from 3 to 300.');
    const accounts = new Map(), devices = new Map(), challenges = new Map();
    const sessions = new Map(), refreshTokens = new Map(), recoverySessions = new Map();
    const uploads = new Map(), objects = new Map(), relationships = new Map();
    let sequence = 0;
    const id = prefix => `${prefix}-${++sequence}`;
    const tokens = deviceId => {
        const sessionToken = randomBytes(32).toString('base64url');
        const refreshToken = randomBytes(32).toString('base64url');
        const expiresAt = Date.now() + 3600000, refreshExpiresAt = Date.now() + 86400000;
        sessions.set(sessionToken, { deviceId, expiresAt });
        refreshTokens.set(refreshToken, { deviceId, expiresAt: refreshExpiresAt });
        return { sessionToken, refreshToken, expiresAt, refreshExpiresAt };
    };
    const recoveryAccount = input => {
        const account = accounts.get(input.userId);
        if (!account || input.recoveryPhrase !== account.phrase) fail('Invalid Recovery Kit', 'UNAUTHORIZED');
        return account;
    };
    const transfer = snapshotId => ({ url: `${origin}/objects/${snapshotId}`, expiresAt: new Date(Date.now() + 60000), headers: {} });
    const dispatch = (path, input = {}, bearer) => {
        let account, deviceId;
        if (!path.startsWith('v1.auth.') && !path.startsWith('v1.backup.recovery') && path !== 'v1.backup.createRecoverySession') {
            const session = sessions.get(bearer);
            if (!session || session.expiresAt <= Date.now()) fail('Session required', 'UNAUTHORIZED');
            deviceId = session.deviceId;
            account = accounts.get(devices.get(deviceId)?.userId);
            if (!account) fail('Device is no longer registered', 'UNAUTHORIZED');
        }
        switch (path) {
            case 'v1.auth.register': {
                const publicKey = createPublicKey({ key: JSON.parse(input.publicKeyJWK), format: 'jwk' });
                const userId = id('fixture-user'), deviceId = id('fixture-device');
                accounts.set(userId, { userId, deviceId, enabled: false, phrase: null, snapshots: [] });
                devices.set(deviceId, { userId, publicKey, root: true });
                if (deviceScenario) {
                    const peerId = `e2e-peer-${deviceId}`, rootId = `e2e-root-${deviceId}`;
                    devices.set(peerId, { userId, publicKey, root: false });
                    devices.set(rootId, { userId, publicKey, root: true });
                    const syncId = `e2e-sync-${deviceId}`;
                    relationships.set(syncId, { userId, syncId, fromDeviceId: deviceId, toDeviceId: peerId, createdAt: new Date('2026-01-01') });
                    for (let index = 3; index < deviceCount; index++) {
                        const extraId = `e2e-device-${index}-${deviceId}`;
                        devices.set(extraId, { userId, publicKey, root: index % 20 === 0 });
                        if (index % 4 !== 0) {
                            const fromDeviceId = index % 2 === 0 ? peerId : deviceId;
                            const extraSyncId = `e2e-extra-sync-${index}-${deviceId}`;
                            relationships.set(extraSyncId, { userId, syncId: extraSyncId, fromDeviceId, toDeviceId: extraId, createdAt: new Date('2026-01-01') });
                        }
                    }
                }
                return { userId, deviceId };
            }
            case 'v1.auth.challenge': {
                if (!devices.has(input.deviceId)) fail('Unknown device', 'UNAUTHORIZED');
                const challengeId = id('challenge'), challenge = randomBytes(32).toString('base64');
                const expiresAt = Date.now() + 60000;
                challenges.set(challengeId, { challenge, deviceId: input.deviceId, expiresAt });
                return { challengeId, challenge, expiresAt };
            }
            case 'v1.auth.verify': {
                const challenge = challenges.get(input.challengeId);
                challenges.delete(input.challengeId);
                if (!challenge || challenge.deviceId !== input.deviceId || challenge.expiresAt <= Date.now() ||
                    !verify('sha256', Buffer.from(challenge.challenge, 'base64'), { key: devices.get(input.deviceId).publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(input.signature, 'base64url'))) fail('Invalid signature', 'UNAUTHORIZED');
                return tokens(input.deviceId);
            }
            case 'v1.auth.refresh': {
                const refresh = refreshTokens.get(input.refreshToken);
                refreshTokens.delete(input.refreshToken);
                if (!refresh || refresh.expiresAt <= Date.now()) fail('Invalid refresh token', 'UNAUTHORIZED');
                return tokens(refresh.deviceId);
            }
            case 'v1.auth.logout': {
                const session = sessions.get(bearer);
                if (!session || session.expiresAt <= Date.now()) fail('Session required', 'UNAUTHORIZED');
                sessions.delete(bearer); refreshTokens.delete(input.refreshToken); return { success: true };
            }
            case 'v1.auth.recover': {
                const recovered = recoveryAccount(input), nextDevice = id('fixture-device');
                devices.set(nextDevice, { userId: recovered.userId, root: true, publicKey: createPublicKey({ key: JSON.parse(input.newPublicKeyJWK), format: 'jwk' }) });
                recovered.deviceId = nextDevice;
                return { success: true, deviceId: nextDevice };
            }
            case 'v1.user.generateRecoveryToken': case 'v1.user.rotateRecoveryToken':
                account.phrase = RECOVERY_PHRASE;
                return { userId: account.userId, token: account.phrase };
            case 'v1.user.configuration':
                return { deviceId, root: devices.get(deviceId).root, canLink: devices.get(deviceId).root, maxLinks: 5, canPromoteDevices: true, managedEncryptedBackups: true, passwordSharing: true, securityReportBasic: true, securityReportAdvanced: true, recoveryTokenCreatedAt: account.phrase ? new Date('2026-01-01') : null, recoveryGenerationNeeded: !account.phrase };
            case 'v1.payment.subscription':
                return { productName: 'E2E Premium', nonFree: true, status: 'active', paymentStatus: 'paid', resourceStatus: { linkedDevices: 0 } };
            case 'v1.payment.checkoutSession':
                if (!['premiumMonthly', 'premiumYearly'].includes(input?.tier) || input.uiMode !== 'hosted' || !['mobile-production', 'mobile-preprod'].includes(input.returnTarget)) fail('Invalid hosted checkout request');
                if (!account.phrase) fail('Save a Recovery Kit first', 'PRECONDITION_FAILED');
                // Synthetic Stripe-host URL for browser handoff only. Entitlement is unchanged.
                return `https://checkout.stripe.com/c/pay/cs_test_cryptex_fixture_${input.tier}`;
            case 'v1.device.link': {
                if (!devices.get(deviceId).root) fail('Root access required', 'FORBIDDEN');
                const publicKey = createPublicKey({ key: JSON.parse(input.publicKeyJWK), format: 'jwk' });
                const peerId = id('fixture-linked-device'), syncId = id('fixture-sync');
                devices.set(peerId, { userId: account.userId, publicKey, root: false });
                relationships.set(syncId, { userId: account.userId, syncId, fromDeviceId: deviceId, toDeviceId: peerId, createdAt: new Date() });
                return { deviceId: peerId, syncId };
            }
            case 'v1.device.topology':
                if (!devices.get(deviceId).root) fail('Root access required', 'FORBIDDEN');
                return {
                    devices: [...devices.entries()].filter(([, d]) => d.userId === account.userId).map(([id, d]) => ({ id, createdAt: new Date('2026-01-01'), lastSeen: new Date(), root: d.root, current: id === deviceId })),
                    relationships: [...relationships.values()].filter(r => r.userId === account.userId).map(({ userId: _userId, ...r }) => r),
                };
            case 'v1.device.setRoot': case 'v1.device.remove': {
                if (!devices.get(deviceId).root) fail('Root access required', 'FORBIDDEN');
                const target = devices.get(input.id);
                if (!target || target.userId !== account.userId) fail('Device not found', 'NOT_FOUND');
                if (path.endsWith('setRoot')) {
                    if (typeof input.root !== 'boolean') fail('Root permission must be a boolean');
                    const roots = [...devices.values()].filter(d => d.userId === account.userId && d.root).length;
                    if (!input.root && target.root && roots <= 1) fail('At least one device must retain root access', 'PRECONDITION_FAILED');
                    target.root = input.root;
                    return undefined;
                } else {
                    if (input.id === deviceId || target.root) fail('Cannot remove the current device or a root device', 'FORBIDDEN');
                    devices.delete(input.id);
                    for (const [syncId, r] of relationships) if (r.fromDeviceId === input.id || r.toDeviceId === input.id) relationships.delete(syncId);
                    for (const [token, session] of sessions) if (session.deviceId === input.id) sessions.delete(token);
                    for (const [token, refresh] of refreshTokens) if (refresh.deviceId === input.id) refreshTokens.delete(token);
                }
                return true;
            }
            case 'v1.device.breakLink': {
                const relationship = relationships.get(input.syncId);
                if (!relationship || relationship.userId !== account.userId) fail('Relationship not found', 'NOT_FOUND');
                if (relationship.fromDeviceId !== deviceId && relationship.toDeviceId !== deviceId && !devices.get(deviceId).root) fail('Root access required', 'FORBIDDEN');
                relationships.delete(input.syncId);
                return true;
            }
            case 'v1.backup.status':
                return { enabled: account.enabled, entitled: true, graceExpiresAt: null, recoveryConfigured: !!account.phrase, accountRecoveryProtection: account.snapshots.length ? 'protected' : account.enabled ? 'pending' : 'none', latestReadyAt: account.snapshots[0]?.readyAt ?? null, versionCount: account.snapshots.length, storageBytes: account.snapshots.reduce((sum, s) => sum + s.byteLength, 0), maxSnapshotBytes: 8388608, maxAccountBytes: 33554432, storageConfigured: true };
            case 'v1.backup.enable':
                if (!account.phrase) fail('Save a Recovery Kit first', 'PRECONDITION_FAILED');
                account.enabled = true; return { enabled: true };
            case 'v1.backup.disable': account.enabled = false; return { enabled: false };
            case 'v1.backup.createUpload': {
                if (!account.enabled || !account.phrase) fail('Backups disabled', 'PRECONDITION_FAILED');
                if (!(input.byteLength > 0 && input.byteLength <= 8388608) || !/^[\w-]{43}$/.test(input.checksumSha256)) fail('Invalid upload');
                const snapshotId = id('snapshot');
                uploads.set(snapshotId, { userId: account.userId, ...input });
                return { snapshotId, transfer: transfer(snapshotId) };
            }
            case 'v1.backup.completeUpload': {
                const upload = uploads.get(input.snapshotId), bytes = objects.get(input.snapshotId);
                if (!upload || upload.userId !== account.userId || !bytes || bytes.length !== upload.byteLength || hash(bytes) !== upload.checksumSha256) fail('Upload checksum mismatch');
                const snapshot = { id: input.snapshotId, createdAt: new Date(), readyAt: new Date(), byteLength: bytes.length, checksumSha256: upload.checksumSha256, sourceLabel: 'Root device' };
                account.snapshots.unshift(snapshot); uploads.delete(input.snapshotId); return snapshot;
            }
            case 'v1.backup.list': return { items: account.snapshots, nextCursor: null };
            case 'v1.backup.createDownload': {
                const snapshot = account.snapshots.find(s => s.id === input.snapshotId);
                if (!snapshot) fail('Snapshot not found', 'NOT_FOUND');
                return { snapshot, transfer: transfer(snapshot.id) };
            }
            case 'v1.backup.delete':
                if (!account.snapshots.some(s => s.id === input.snapshotId)) fail('Snapshot not found', 'NOT_FOUND');
                account.snapshots = account.snapshots.filter(s => s.id !== input.snapshotId); objects.delete(input.snapshotId); return true;
            case 'v1.backup.deleteAll':
                for (const snapshot of account.snapshots) objects.delete(snapshot.id);
                account.snapshots = []; account.enabled = false; return true;
            case 'v1.backup.createRecoverySession': {
                const recovered = recoveryAccount(input), expiresAt = new Date(Date.now() + 60000);
                recoverySessions.set(input.sessionToken, { account: recovered, expiresAt }); return { expiresAt };
            }
            case 'v1.backup.recoveryList': case 'v1.backup.recoveryDownload': {
                const session = recoverySessions.get(input.sessionToken);
                if (!session || session.expiresAt <= new Date()) fail('Recovery session required', 'UNAUTHORIZED');
                if (path.endsWith('recoveryList')) return { items: session.account.snapshots, nextCursor: null };
                const snapshot = session.account.snapshots.find(s => s.id === input.snapshotId);
                if (!snapshot) fail('Snapshot not found', 'NOT_FOUND');
                return { snapshot, transfer: transfer(snapshot.id) };
            }
            default: fail(`Unhandled fixture procedure ${path}`, 'NOT_FOUND');
        }
    };
    const server = createServer(async (request, response) => {
        try {
            const url = new URL(request.url, origin);
            if (url.pathname === '/health') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ fixture: 'cryptex-mobile-online-services', deviceScenario, ...(deviceCount !== 3 ? { deviceCount } : {}) })); return; }
            if (url.pathname.startsWith('/objects/')) {
                const snapshotId = url.pathname.slice('/objects/'.length);
                if (request.method === 'PUT' && uploads.has(snapshotId)) {
                    const chunks = []; for await (const chunk of request) chunks.push(chunk);
                    const bytes = Buffer.concat(chunks), upload = uploads.get(snapshotId);
                    if (bytes.length !== upload.byteLength || hash(bytes) !== upload.checksumSha256) fail('Upload checksum mismatch');
                    objects.set(snapshotId, bytes); response.end(); return;
                }
                if (request.method === 'GET' && objects.has(snapshotId)) { response.setHeader('Content-Type', 'application/octet-stream'); response.end(objects.get(snapshotId)); return; }
                response.writeHead(404); response.end(); return;
            }
            if (!url.pathname.startsWith('/api/trpc/')) { response.writeHead(404); response.end(); return; }
            const chunks = []; for await (const chunk of request) chunks.push(chunk);
            const batch = url.searchParams.get('batch') === '1';
            const raw = JSON.parse(request.method === 'GET' ? url.searchParams.get('input') ?? '{}' : Buffer.concat(chunks).toString() || '{}');
            const paths = decodeURIComponent(url.pathname.slice('/api/trpc/'.length)).split(',');
            const results = paths.map((path, index) => {
                try {
                    const value = batch ? raw[index] : raw;
                    const input = value?.json !== undefined ? superjson.deserialize(value) : undefined;
                    return { result: { data: superjson.serialize(dispatch(path, input, request.headers.authorization?.replace(/^Bearer /, ''))) } };
                } catch (error) { return { error: superjson.serialize({ message: error.message, code: -32000, data: { code: error.code ?? 'BAD_REQUEST', httpStatus: error.code === 'UNAUTHORIZED' ? 401 : 400, path } }) }; }
            });
            response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(batch ? results : results[0]));
        } catch (error) { response.writeHead(400); response.end(error.message); }
    });
    return { server, dispatch, objects, accounts };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const port = Number(process.env.CRYPTEX_E2E_CLOUD_PORT ?? 43111);
    const deviceCount = Number(process.env.CRYPTEX_E2E_DEVICE_COUNT ?? 3);
    createOnlineServicesFixture({ origin: `http://localhost:${port}`, deviceScenario: process.env.CRYPTEX_E2E_DEVICE_SCENARIO === '1', deviceCount }).server.listen(port, '127.0.0.1', () => console.log(`Online Services fixture http://localhost:${port}`));
}
