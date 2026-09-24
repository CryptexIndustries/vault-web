/**
 * @jest-environment node
 */
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    jest,
} from "@jest/globals";
import { err } from "neverthrow";

jest.mock("../src/utils/session-utils", () => ({
    createEncryptedEnvelope: jest.fn(async () => ({})),
    isEncryptedEnvelope: jest.fn(() => true),
    decryptResponseEnvelope: jest.fn(),
}));

import {
    decryptResponseEnvelope,
    isEncryptedEnvelope,
} from "../src/utils/session-utils";

import * as VaultUtilTypes from "@cryptex-industries/vault-core/proto";

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

describe("sync save acknowledgement", () => {
    const originalChrome = Object.getOwnPropertyDescriptor(
        globalThis,
        "chrome",
    );
    const updated = jest.fn();
    const ops = () =>
        createVaultOperations(
            { keyId: "kid", publicKeyJwk: { kty: "EC" } },
            updated,
        );

    beforeEach(() => {
        jest.clearAllMocks();
        Object.defineProperty(globalThis, "chrome", {
            configurable: true,
            value: {
                runtime: {
                    sendMessage: jest.fn(async () => ({ payload: {} })),
                },
            },
        });
        jest.mocked(isEncryptedEnvelope).mockReturnValue(true);
        jest.mocked(decryptResponseEnvelope).mockResolvedValue({
            ok: true,
            payload: { ok: true },
        });
        jest.spyOn(console, "error").mockImplementation(() => undefined);
    });

    afterEach(() => {
        jest.restoreAllMocks();
        if (originalChrome) {
            Object.defineProperty(globalThis, "chrome", originalChrome);
        } else {
            Reflect.deleteProperty(globalThis, "chrome");
        }
    });

    it("rejects background save failure without refreshing credentials", async () => {
        jest.mocked(decryptResponseEnvelope).mockResolvedValueOnce({
            ok: true,
            payload: { ok: false, error: "SAVE_FAILED" },
        });
        await expect(ops().updateItems([], [])).rejects.toThrow("SAVE_FAILED");
        expect(updated).not.toHaveBeenCalled();
    });

    it("rejects an unauthenticated response", async () => {
        jest.mocked(decryptResponseEnvelope).mockResolvedValueOnce({
            ok: false,
            error: err("DECRYPTION_FAILED"),
        });
        await expect(ops().updateItems([], [])).rejects.toThrow("authenticate");
        expect(updated).not.toHaveBeenCalled();
    });

    it("rejects a plaintext response", async () => {
        jest.mocked(isEncryptedEnvelope).mockReturnValueOnce(false);
        await expect(ops().updateItems([], [])).rejects.toThrow("encrypted");
        expect(updated).not.toHaveBeenCalled();
    });

    it("refreshes credentials after a successful save", async () => {
        await ops().updateItems([], []);
        expect(updated).toHaveBeenCalledTimes(1);
    });
});
