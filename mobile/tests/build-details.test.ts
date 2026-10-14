import { describe, it, expect } from '@jest/globals';
import { getBuildDetails } from '../src/lib/build-details';

describe('installed build details', () => {
    it('shows useful embedded metadata when a development binary has no updates module', () => {
        expect(getBuildDetails({ version: '1.2.3', android: { versionCode: 42 }, extra: { buildDetails: { profile: 'preprod', sourceRevision: 'abc123' } } })).toMatchObject({ profile: 'preprod', revision: 'abc123', version: '1.2.3', build: 42, update: 'embedded', runtime: 'unavailable', ota: 'disabled' });
    });
    it('shows the installed native runtime and downloaded update rather than build-time placeholders', () => {
        expect(getBuildDetails({ version: '1.2.3', extra: { buildDetails: { profile: 'production' } } }, { isEnabled: true, updateId: 'update-uuid', runtimeVersion: 'native-fingerprint', channel: 'production' })).toMatchObject({ ota: 'enabled', update: 'update-uuid', runtime: 'native-fingerprint', channel: 'production' });
    });
});
