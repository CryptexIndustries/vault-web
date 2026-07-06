/**
 * @jest-environment node
 */
import { describe, expect, it, jest } from "@jest/globals";

import * as VaultUtilTypes from "@/app_lib/proto/vault";

import {
    createCachedSyncConfigLoader,
    createVaultOperations,
} from "../src/vault-operations";

const mockLinkedDevices = VaultUtilTypes.LinkedDevices.create({
    SyncSigningPublicKey: "sign-pub",
    SyncSigningPrivateKey: "sign-priv",
    SyncKemPublicKey: "kem-pub",
    SyncKemPrivateKey: "kem-priv",
    Devices: [
        VaultUtilTypes.LinkedDevice.create({
            ID: "peer-1",
            RemoteSyncPublicKey: "remote-sign-pub",
            RemoteSyncKemPublicKey: "remote-kem-pub",
        }),
    ],
});

describe("createCachedSyncConfigLoader", () => {
    it("coalesces concurrent config loads into one request", async () => {
        let calls = 0;
        const loader = createCachedSyncConfigLoader(async () => {
            calls += 1;
            await new Promise((resolve) => setTimeout(resolve, 5));
            return mockLinkedDevices;
        });

        const [signing, kem, remoteSign, remoteKem] = await Promise.all([
            loader().then((config) => config.SyncSigningPublicKey),
            loader().then((config) => config.SyncKemPublicKey),
            loader().then((config) => config.Devices[0]?.RemoteSyncPublicKey),
            loader().then(
                (config) => config.Devices[0]?.RemoteSyncKemPublicKey,
            ),
        ]);

        expect(calls).toBe(1);
        expect(signing).toBe("sign-pub");
        expect(kem).toBe("kem-pub");
        expect(remoteSign).toBe("remote-sign-pub");
        expect(remoteKem).toBe("remote-kem-pub");
    });
});

describe("createVaultOperations", () => {
    it("loads sync key material through one cached config fetch", async () => {
        const loadConfig = jest.fn(async () => mockLinkedDevices);
        const ops = createVaultOperations(
            {
                keyId: "kid",
                publicKeyJwk: { kty: "EC" },
            },
            undefined,
            { loadConfig },
        );

        const [signingPublic, signingPrivate, kemPublic, kemPrivate] =
            await Promise.all([
                ops.getSyncSigningPublicKey(),
                ops.getSyncSigningPrivateKey(),
                ops.getSyncKemPublicKey(),
                ops.getSyncKemPrivateKey(),
            ]);

        expect(loadConfig).toHaveBeenCalledTimes(1);
        expect(signingPublic).toBe("sign-pub");
        expect(signingPrivate).toBe("sign-priv");
        expect(kemPublic).toBe("kem-pub");
        expect(kemPrivate).toBe("kem-priv");

        const remote = await Promise.all([
            ops.getRemoteSyncPublicKey("peer-1"),
            ops.getRemoteSyncKemPublicKey("peer-1"),
        ]);
        expect(loadConfig).toHaveBeenCalledTimes(1);
        expect(remote).toEqual(["remote-sign-pub", "remote-kem-pub"]);
    });
});
