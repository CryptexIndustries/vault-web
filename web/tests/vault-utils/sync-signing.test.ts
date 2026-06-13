import { describe, expect, it } from "@jest/globals";
import { TextEncoder } from "util";

import { LinkedDevices } from "../../src/app_lib/vault-utils/vault";
import {
    ensureSyncSigningKeypair,
    signSyncBytes,
    verifySyncBytes,
} from "../../src/app_lib/vault-utils/sync-signing";

describe("sync-signing", () => {
    it("generates ML-DSA keys only when missing", async () => {
        const linkedDevices = new LinkedDevices();

        expect(await ensureSyncSigningKeypair(linkedDevices)).toBe(true);
        const publicKey = linkedDevices.SyncSigningPublicKey;
        const privateKey = linkedDevices.SyncSigningPrivateKey;

        expect(publicKey).toMatch(/^[A-Za-z0-9_-]+$/);
        expect(privateKey).toMatch(/^[A-Za-z0-9_-]+$/);
        expect(await ensureSyncSigningKeypair(linkedDevices)).toBe(false);
        expect(linkedDevices.SyncSigningPublicKey).toBe(publicKey);
        expect(linkedDevices.SyncSigningPrivateKey).toBe(privateKey);
    });

    it("signs and verifies arbitrary transcript bytes", async () => {
        const signer = new LinkedDevices();
        const attacker = new LinkedDevices();
        await ensureSyncSigningKeypair(signer);
        await ensureSyncSigningKeypair(attacker);

        const transcript = new TextEncoder().encode("session transcript");
        const signature = await signSyncBytes(
            signer.SyncSigningPrivateKey,
            transcript,
        );

        await expect(
            verifySyncBytes(signer.SyncSigningPublicKey, signature, transcript),
        ).resolves.toBe(true);
        await expect(
            verifySyncBytes(
                attacker.SyncSigningPublicKey,
                signature,
                transcript,
            ),
        ).resolves.toBe(false);
        await expect(
            verifySyncBytes(
                signer.SyncSigningPublicKey,
                signature,
                new TextEncoder().encode("tampered"),
            ),
        ).resolves.toBe(false);
    });
});
