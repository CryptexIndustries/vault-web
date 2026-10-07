import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { createOnlineServicesFixture, RECOVERY_PHRASE } from './online-services.mjs';

function authenticatedFixture(fixture = createOnlineServicesFixture()) {
    const key = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const identity = fixture.dispatch('v1.auth.register', { publicKeyJWK: JSON.stringify(key.publicKey.export({ format: 'jwk' })), captchaToken: '' });
    const challenge = fixture.dispatch('v1.auth.challenge', { deviceId: identity.deviceId });
    const signature = sign('sha256', Buffer.from(challenge.challenge, 'base64'), { key: key.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
    const tokens = fixture.dispatch('v1.auth.verify', { ...identity, challengeId: challenge.challengeId, signature });
    return { fixture, identity, tokens, key, challenge, signature };
}

test('signed registration rejects replay and invalid signatures; refresh rotates tokens', () => {
    const { fixture, identity, tokens, challenge, signature } = authenticatedFixture();
    assert.throws(() => fixture.dispatch('v1.auth.verify', { ...identity, challengeId: challenge.challengeId, signature }), /Invalid signature/);
    const other = fixture.dispatch('v1.auth.challenge', identity);
    assert.throws(() => fixture.dispatch('v1.auth.verify', { ...identity, challengeId: other.challengeId, signature }), /Invalid signature/);
    assert.throws(() => fixture.dispatch('v1.user.configuration'), /Session required/);
    assert.throws(() => fixture.dispatch('v1.auth.logout'), /Session required/);
    assert.equal(fixture.dispatch('v1.user.configuration', {}, tokens.sessionToken).deviceId, identity.deviceId);
    const fresh = fixture.dispatch('v1.auth.refresh', { refreshToken: tokens.refreshToken });
    assert.notEqual(fresh.refreshToken, tokens.refreshToken);
    assert.throws(() => fixture.dispatch('v1.auth.refresh', { refreshToken: tokens.refreshToken }), /Invalid refresh token/);
});

test('hosted checkout requires a signed session and Recovery Kit without changing entitlement', () => {
    const { fixture, tokens } = authenticatedFixture();
    const call = (path, input) => fixture.dispatch(path, input, tokens.sessionToken);
    const input = { tier: 'premiumYearly', uiMode: 'hosted', returnTarget: 'mobile-production' };
    assert.throws(() => fixture.dispatch('v1.payment.checkoutSession', input), /Session required/);
    assert.throws(() => call('v1.payment.checkoutSession', input), /Recovery Kit/);
    call('v1.user.generateRecoveryToken');
    const subscription = call('v1.payment.subscription');
    const configuration = call('v1.user.configuration');
    const backupStatus = call('v1.backup.status');
    for (const tier of ['premiumMonthly', 'premiumYearly']) {
        for (const returnTarget of ['mobile-production', 'mobile-preprod']) {
            assert.equal(call('v1.payment.checkoutSession', { ...input, tier, returnTarget }), `https://checkout.stripe.com/c/pay/cs_test_cryptex_fixture_${tier}`);
        }
    }
    for (const invalid of [
        {},
        { ...input, tier: 'free' },
        { ...input, uiMode: 'embedded' },
        { ...input, returnTarget: 'https://untrusted.example' },
        { ...input, returnTarget: undefined },
    ]) assert.throws(() => call('v1.payment.checkoutSession', invalid), /Invalid hosted checkout/);
    assert.deepEqual(call('v1.payment.subscription'), subscription);
    assert.deepEqual(call('v1.user.configuration'), configuration);
    assert.deepEqual(call('v1.backup.status'), backupStatus);
});

test('encrypted backup lifecycle validates bytes and requires Recovery Kit access', () => {
    const { fixture, identity, tokens } = authenticatedFixture();
    const call = (path, input) => fixture.dispatch(path, input, tokens.sessionToken);
    assert.throws(() => call('v1.backup.enable'), /Recovery Kit/);
    call('v1.user.generateRecoveryToken'); call('v1.backup.enable');
    const bytes = Buffer.from('opaque encrypted vault fixture'), checksumSha256 = createHash('sha256').update(bytes).digest('base64url');
    const { snapshotId } = call('v1.backup.createUpload', { byteLength: bytes.length, checksumSha256, idempotencyKey: 'fixture-idempotency-1' });
    fixture.objects.set(snapshotId, Buffer.from('corrupt'));
    assert.throws(() => call('v1.backup.completeUpload', { snapshotId }), /checksum/);
    fixture.objects.set(snapshotId, bytes);
    call('v1.backup.completeUpload', { snapshotId });
    assert.equal(call('v1.backup.status').accountRecoveryProtection, 'protected');
    assert.equal(call('v1.backup.createDownload', { snapshotId }).snapshot.checksumSha256, checksumSha256);
    const otherAccount = authenticatedFixture(fixture);
    assert.throws(() => fixture.dispatch('v1.backup.createDownload', { snapshotId }, otherAccount.tokens.sessionToken), /Snapshot not found/);
    assert.throws(() => fixture.dispatch('v1.backup.delete', { snapshotId }, otherAccount.tokens.sessionToken), /Snapshot not found/);
    assert.throws(() => fixture.dispatch('v1.backup.createRecoverySession', { userId: identity.userId, recoveryPhrase: 'wrong', sessionToken: 'recovery-session' }), /Invalid Recovery Kit/);
    fixture.dispatch('v1.backup.createRecoverySession', { userId: identity.userId, recoveryPhrase: RECOVERY_PHRASE, sessionToken: 'recovery-session' });
    assert.equal(fixture.dispatch('v1.backup.recoveryList', { sessionToken: 'recovery-session' }).items.length, 1);
    assert.equal(fixture.dispatch('v1.backup.recoveryDownload', { sessionToken: 'recovery-session', snapshotId }).snapshot.id, snapshotId);
    call('v1.backup.delete', { snapshotId });
    assert.equal(call('v1.backup.list').items.length, 0);
    assert.equal(fixture.objects.size, 0);
});

test('HTTP tRPC transport supports batches and binary object uploads', async () => {
    const { fixture, tokens } = authenticatedFixture();
    await new Promise(resolve => fixture.server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${fixture.server.address().port}`;
    try {
        const batch = await fetch(`${origin}/api/trpc/v1.user.configuration,v1.backup.status?batch=1&input=${encodeURIComponent(JSON.stringify({ 0: { json: null }, 1: { json: null } }))}`, { headers: { Authorization: `Bearer ${tokens.sessionToken}` } });
        const result = await batch.json();
        assert.equal(result.length, 2);
        assert.equal(result[0].result.data.json.managedEncryptedBackups, true);
        assert.equal(result[1].result.data.json.versionCount, 0);
        fixture.dispatch('v1.user.generateRecoveryToken', {}, tokens.sessionToken);
        fixture.dispatch('v1.backup.enable', {}, tokens.sessionToken);
        const bytes = Buffer.from('encrypted bytes over HTTP'), checksumSha256 = createHash('sha256').update(bytes).digest('base64url');
        const { snapshotId } = fixture.dispatch('v1.backup.createUpload', { byteLength: bytes.length, checksumSha256 }, tokens.sessionToken);
        assert.equal((await fetch(`${origin}/objects/${snapshotId}`, { method: 'PUT', body: Buffer.from('bad') })).status, 400);
        assert.equal((await fetch(`${origin}/objects/${snapshotId}`, { method: 'PUT', body: bytes })).status, 200);
        fixture.dispatch('v1.backup.completeUpload', { snapshotId }, tokens.sessionToken);
        assert.deepEqual(Buffer.from(await (await fetch(`${origin}/objects/${snapshotId}`)).arrayBuffer()), bytes);
    } finally { await new Promise(resolve => fixture.server.close(resolve)); }
});

test('account recovery binds a new signing key and logout revokes its session', () => {
    const { fixture, identity, tokens } = authenticatedFixture();
    fixture.dispatch('v1.user.generateRecoveryToken', {}, tokens.sessionToken);
    const key = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const recovered = fixture.dispatch('v1.auth.recover', { userId: identity.userId, recoveryPhrase: RECOVERY_PHRASE, newPublicKeyJWK: JSON.stringify(key.publicKey.export({ format: 'jwk' })), captchaToken: '' });
    assert.notEqual(recovered.deviceId, identity.deviceId);
    const challenge = fixture.dispatch('v1.auth.challenge', recovered);
    const signature = sign('sha256', Buffer.from(challenge.challenge, 'base64'), { key: key.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
    const recoveredSession = fixture.dispatch('v1.auth.verify', { ...recovered, challengeId: challenge.challengeId, signature });
    assert.equal(fixture.dispatch('v1.user.configuration', {}, recoveredSession.sessionToken).deviceId, recovered.deviceId);
    assert.equal(fixture.accounts.get(identity.userId).deviceId, recovered.deviceId);
    fixture.dispatch('v1.auth.logout', { refreshToken: recoveredSession.refreshToken }, recoveredSession.sessionToken);
    assert.throws(() => fixture.dispatch('v1.user.configuration', {}, recoveredSession.sessionToken), /Session required/);
});

test('device scenario enforces root changes, removal and nonroot topology restrictions', () => {
    const { fixture, identity, tokens } = authenticatedFixture(createOnlineServicesFixture({ deviceScenario: true }));
    const call = (path, input) => fixture.dispatch(path, input, tokens.sessionToken);
    const peerId = `e2e-peer-${identity.deviceId}`, rootId = `e2e-root-${identity.deviceId}`;
    const topology = () => call('v1.device.topology');
    assert.equal(topology().devices.length, 3);
    assert.equal(topology().relationships.length, 1);
    assert.throws(() => call('v1.device.remove', { id: identity.deviceId }), /Cannot remove/);
    assert.throws(() => call('v1.device.remove', { id: rootId }), /Cannot remove/);
    assert.throws(() => call('v1.device.setRoot', { id: peerId, root: 'false' }), /must be a boolean/);
    const other = authenticatedFixture(fixture);
    assert.throws(() => call('v1.device.setRoot', { id: other.identity.deviceId, root: false }), /Device not found/);
    assert.throws(() => call('v1.device.remove', { id: other.identity.deviceId }), /Device not found/);
    call('v1.device.setRoot', { id: peerId, root: true });
    assert.equal(topology().devices.find(d => d.id === peerId).root, true);
    assert.throws(() => call('v1.device.remove', { id: peerId }), /Cannot remove/);
    call('v1.device.setRoot', { id: peerId, root: false });
    call('v1.device.remove', { id: peerId });
    assert.equal(topology().devices.length, 2);
    assert.equal(topology().relationships.length, 0);
    call('v1.device.setRoot', { id: rootId, root: false });
    assert.throws(() => call('v1.device.setRoot', { id: identity.deviceId, root: false }), /At least one device/);
    call('v1.device.setRoot', { id: rootId, root: true });
    call('v1.device.setRoot', { id: identity.deviceId, root: false });
    assert.equal(call('v1.user.configuration').root, false);
    assert.equal(call('v1.user.configuration').canLink, false);
    for (const [path, input] of [
        ['v1.device.topology', {}],
        ['v1.device.setRoot', { id: identity.deviceId, root: true }],
        ['v1.device.remove', { id: rootId }],
    ]) assert.throws(() => call(path, input), /Root access required/);
});

test('device scenario is opt-in and its health response identifies the scenario', async () => {
    const normal = authenticatedFixture();
    assert.equal(normal.fixture.dispatch('v1.device.topology', {}, normal.tokens.sessionToken).devices.length, 1);
    const fixture = createOnlineServicesFixture({ deviceScenario: true });
    await new Promise(resolve => fixture.server.listen(0, '127.0.0.1', resolve));
    try {
        const health = await fetch(`http://127.0.0.1:${fixture.server.address().port}/health`).then(response => response.json());
        assert.deepEqual(health, { fixture: 'cryptex-mobile-online-services', deviceScenario: true });
    } finally { await new Promise(resolve => fixture.server.close(resolve)); }
});

test('root invitation registration can be promoted then rolled back without retaining its relationship', () => {
    const { fixture, tokens } = authenticatedFixture(createOnlineServicesFixture({ deviceScenario: true }));
    const call = (path, input) => fixture.dispatch(path, input, tokens.sessionToken);
    const publicKey = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey;
    const before = call('v1.device.topology');
    const invitation = call('v1.device.link', { publicKeyJWK: JSON.stringify(publicKey.export({ format: 'jwk' })) });
    call('v1.device.setRoot', { id: invitation.deviceId, root: true });
    const pending = call('v1.device.topology');
    assert.equal(pending.devices.length, before.devices.length + 1);
    assert.equal(pending.devices.find(d => d.id === invitation.deviceId).root, true);
    assert.equal(pending.relationships.find(r => r.syncId === invitation.syncId).toDeviceId, invitation.deviceId);
    assert.throws(() => call('v1.device.remove', { id: invitation.deviceId }), /Cannot remove/);
    call('v1.device.setRoot', { id: invitation.deviceId, root: false });
    call('v1.device.remove', { id: invitation.deviceId });
    const after = call('v1.device.topology');
    assert.deepEqual(after.devices.map(d => d.id), before.devices.map(d => d.id));
    assert.deepEqual(after.relationships, before.relationships);
});

test('fixture relationship unlink preserves account identities and unrelated connections', () => {
    const { fixture, identity, tokens } = authenticatedFixture(createOnlineServicesFixture({ deviceScenario: true }));
    const call = (path, input) => fixture.dispatch(path, input, tokens.sessionToken);
    const peer = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey;
    const additional = call('v1.device.link', { publicKeyJWK: JSON.stringify(peer.export({ format: 'jwk' })) });
    const before = call('v1.device.topology');
    const selected = `e2e-sync-${identity.deviceId}`;
    const foreign = authenticatedFixture(fixture);
    assert.throws(() => fixture.dispatch('v1.device.breakLink', { syncId: selected }, foreign.tokens.sessionToken), /Relationship not found/);
    assert.deepEqual(call('v1.device.topology').relationships, before.relationships);
    assert.deepEqual(call('v1.device.topology').devices.map(device => device.id), before.devices.map(device => device.id));
    call('v1.device.breakLink', { syncId: selected });
    const after = call('v1.device.topology');
    assert.deepEqual(after.devices.map(device => device.id), before.devices.map(device => device.id));
    assert.deepEqual(after.relationships.map(relationship => relationship.syncId), [additional.syncId]);
    assert.equal(after.devices.find(device => device.id === `e2e-peer-${identity.deviceId}`).root, false);
    assert.throws(() => call('v1.device.breakLink', { syncId: selected }), /Relationship not found/);
    assert.deepEqual(call('v1.device.topology').devices.map(device => device.id), before.devices.map(device => device.id));
});

test('large device fixture seeds 100 registered identities with remote and isolated connections', () => {
    const { fixture, tokens } = authenticatedFixture(createOnlineServicesFixture({ deviceScenario: true, deviceCount: 100 }));
    const topology = fixture.dispatch('v1.device.topology', {}, tokens.sessionToken);
    assert.equal(topology.devices.length, 100);
    assert.equal(new Set(topology.devices.map(device => device.id)).size, 100);
    const current = topology.devices.find(device => device.current);
    const connectedIds = new Set(topology.relationships.flatMap(relationship => [relationship.fromDeviceId, relationship.toDeviceId]));
    assert.equal(topology.devices.filter(device => !connectedIds.has(device.id)).length, 25);
    assert.equal(topology.relationships.some(relationship => relationship.fromDeviceId !== current.id && relationship.toDeviceId !== current.id), true);
    for (const invalid of [2, 301, 3.5, NaN]) assert.throws(() => createOnlineServicesFixture({ deviceScenario: true, deviceCount: invalid }), /Device fixture count/);
});
