import { beforeAll, describe, expect, it } from "@jest/globals";
import { webcrypto } from "node:crypto";
import { TextDecoder, TextEncoder } from "util";

import { VaultItemSynchronizationMessageCommand } from "../../src/app_lib/proto/vault";
import {
    encodeLinkSyncKeyMessage,
    ensureSyncSigningKeypair,
    parseLinkSyncKeyMessage,
    signSyncEnvelopeFields,
    verifySyncEnvelopeFields,
} from "../../src/app_lib/vault-utils/sync-signing";
import { LinkedDevices } from "../../src/app_lib/vault-utils/vault";

beforeAll(() => {
    Object.defineProperty(globalThis, "crypto", {
        value: webcrypto,
        writable: true,
    });
    Object.defineProperty(globalThis, "TextEncoder", {
        value: TextEncoder,
        writable: true,
    });
    Object.defineProperty(globalThis, "TextDecoder", {
        value: TextDecoder,
        writable: true,
    });
    if (!globalThis.btoa) {
        Object.defineProperty(globalThis, "btoa", {
            value: (value: string) => Buffer.from(value, "binary").toString("base64"),
            writable: true,
        });
    }
    if (!globalThis.atob) {
        Object.defineProperty(globalThis, "atob", {
            value: (value: string) => Buffer.from(value, "base64").toString("binary"),
            writable: true,
        });
    }
});

const asArrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
    bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;

describe("sync signing", () => {
    it("generates ML-DSA key material and verifies a signed envelope payload", async () => {
        const linkedDevices = new LinkedDevices();

        expect(await ensureSyncSigningKeypair(linkedDevices)).toBe(true);
        expect(await ensureSyncSigningKeypair(linkedDevices)).toBe(false);
        expect(linkedDevices.SyncSigningPublicKey).toMatch(/^[A-Za-z0-9_-]+$/);
        expect(linkedDevices.SyncSigningPrivateKey).toMatch(/^[A-Za-z0-9_-]+$/);

        const payload = new TextEncoder().encode("payload");
        const signature = await signSyncEnvelopeFields(
            linkedDevices.SyncSigningPrivateKey,
            "envelope-id",
            VaultItemSynchronizationMessageCommand.SyncHello,
            payload,
        );

        await expect(
            verifySyncEnvelopeFields(
                linkedDevices.SyncSigningPublicKey,
                "envelope-id",
                VaultItemSynchronizationMessageCommand.SyncHello,
                payload,
                signature,
            ),
        ).resolves.toBe(true);
    });

    it("rejects tampered payloads and wrong ML-DSA public keys", async () => {
        const signer = new LinkedDevices();
        const attacker = new LinkedDevices();
        await ensureSyncSigningKeypair(signer);
        await ensureSyncSigningKeypair(attacker);

        const payload = new TextEncoder().encode("payload");
        const signature = await signSyncEnvelopeFields(
            signer.SyncSigningPrivateKey,
            "envelope-id",
            VaultItemSynchronizationMessageCommand.SyncDataRequest,
            payload,
        );

        await expect(
            verifySyncEnvelopeFields(
                signer.SyncSigningPublicKey,
                "envelope-id",
                VaultItemSynchronizationMessageCommand.SyncDataRequest,
                new TextEncoder().encode("tampered"),
                signature,
            ),
        ).resolves.toBe(false);
        await expect(
            verifySyncEnvelopeFields(
                attacker.SyncSigningPublicKey,
                "envelope-id",
                VaultItemSynchronizationMessageCommand.SyncDataRequest,
                payload,
                signature,
            ),
        ).resolves.toBe(false);
    });

    it("replaces stale non-ML-DSA key material during keypair ensure", async () => {
        const linkedDevices = new LinkedDevices();
        linkedDevices.SyncSigningPublicKey = JSON.stringify({
            kty: "EC",
            crv: "P-256",
        });
        linkedDevices.SyncSigningPrivateKey = JSON.stringify({
            kty: "EC",
            crv: "P-256",
        });

        expect(await ensureSyncSigningKeypair(linkedDevices)).toBe(true);
        expect(linkedDevices.SyncSigningPublicKey).toMatch(/^[A-Za-z0-9_-]+$/);
        expect(linkedDevices.SyncSigningPrivateKey).toMatch(/^[A-Za-z0-9_-]+$/);
        expect(linkedDevices.SyncSigningPublicKey).not.toContain('"kty"');
    });

    it("exchanges sync public keys with the algorithm-neutral publicKey field", () => {
        const encoded = encodeLinkSyncKeyMessage("sync-public-key");
        const parsed = JSON.parse(new TextDecoder().decode(encoded)) as {
            publicKey?: string;
            publicKeyJWK?: string;
        };

        expect(parsed.publicKey).toBe("sync-public-key");
        expect(parsed.publicKeyJWK).toBeUndefined();
        expect(parseLinkSyncKeyMessage(asArrayBuffer(encoded))).toBe(
            "sync-public-key",
        );
        expect(
            parseLinkSyncKeyMessage(
                asArrayBuffer(
                    new TextEncoder().encode(
                        JSON.stringify({
                            type: "sync-signing-public-key",
                            publicKeyJWK: "legacy-key",
                        }),
                    ),
                ),
            ),
        ).toBeNull();
    });
});
