import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import { webcrypto } from "crypto";
import { err, ok, type Result } from "neverthrow";
import { TextDecoder, TextEncoder } from "util";

Object.defineProperty(globalThis, "TextEncoder", {
    value: TextEncoder,
    writable: true,
});

Object.defineProperty(globalThis, "TextDecoder", {
    value: TextDecoder,
    writable: true,
});

Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    writable: true,
});

import * as VaultUtilTypes from "../../src/app_lib/proto/vault";

const uint8ToBase64 = (value: Uint8Array): string =>
    Buffer.from(value).toString("base64");
const utf8Bytes = (value: string): Uint8Array => new TextEncoder().encode(value);

const mockGenerateMnemonic: jest.MockedFunction<
    (wordlist: string[], strength: number) => string
> = jest.fn();
const mockHashSecret: jest.MockedFunction<
    (secret: string) => Promise<Uint8Array>
> = jest.fn();

type EncryptDataBlobFn = (
    blob: Uint8Array,
    secret: Uint8Array,
    algorithm: VaultUtilTypes.EncryptionAlgorithm,
    keyDerivationFunction: VaultUtilTypes.KeyDerivationFunction,
    kdfConfigArgon2ID: VaultUtilTypes.KeyDerivationConfigArgon2ID,
    kdfConfigPBKDF2: VaultUtilTypes.KeyDerivationConfigPBKDF2,
) => Promise<{ Blob: Uint8Array; Salt: string; HeaderIV: string }>;

type DecryptDataBlobFn = (
    blob: VaultUtilTypes.EncryptedBlob,
    secret: Uint8Array,
    algorithm: VaultUtilTypes.EncryptionAlgorithm,
    keyDerivationFunction: VaultUtilTypes.KeyDerivationFunction,
    configuration:
        | VaultUtilTypes.KeyDerivationConfigArgon2ID
        | VaultUtilTypes.KeyDerivationConfigPBKDF2,
) => Promise<Result<Uint8Array, string>>;

const mockEncryptDataBlob: jest.MockedFunction<
    EncryptDataBlobFn
> = jest.fn();
const mockDecryptDataBlob: jest.MockedFunction<
    DecryptDataBlobFn
> = jest.fn();

jest.mock(
    "@/lib/utils",
    () => ({
        base64ToUint8: (value: string) => new Uint8Array(Buffer.from(value, "base64")),
        uint8ToBase64: (value: Uint8Array) => Buffer.from(value).toString("base64"),
    }),
    { virtual: true },
);

jest.mock("@scure/bip39", () => ({
    __esModule: true,
    generateMnemonic: mockGenerateMnemonic,
}));

jest.mock("../../src/app_lib/vault-utils/encryption", () => {
    const actual = jest.requireActual("../../src/app_lib/vault-utils/encryption") as object;
    return {
        __esModule: true,
        ...actual,
        hashSecret: (secret: string) => mockHashSecret(secret),
        EncryptDataBlob: (...args: Parameters<EncryptDataBlobFn>) =>
            mockEncryptDataBlob(...args),
        DecryptDataBlob: (...args: Parameters<DecryptDataBlobFn>) =>
            mockDecryptDataBlob(...args),
    };
});

// Prevent import-time dependency complexity from synchronization helpers.
jest.mock("../../src/app_lib/synchronization", () => ({
    initPusherInstance: jest.fn(),
    initWebRTC: jest.fn(),
}));

jest.mock("../../src/app_lib/online-services", () => ({
    constructLinkPresenceChannelName: jest.fn((id: string) => `presence-${id}`),
}));

jest.mock("pusher-js", () => ({
    __esModule: true,
    default: class {},
}));

import { LinkingPackage } from "../../src/app_lib/vault-utils/linking";

describe("vault-utils/linking", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockGenerateMnemonic.mockReturnValue(
            "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu",
        );
        mockHashSecret.mockResolvedValue(new Uint8Array([3, 3, 3]));
        mockEncryptDataBlob.mockResolvedValue({
            Blob: new Uint8Array([10, 20]),
            Salt: "salt-b64",
            HeaderIV: "header-b64",
        });
        mockDecryptDataBlob.mockResolvedValue(
            ok(
                VaultUtilTypes.LinkingPackageBlob.encode({
                    SyncID: "sync-1",
                    OnlineServices: undefined,
                    STUNServers: [],
                    TURNServers: [],
                    SignalingServer: undefined,
                    SyncSigningPublicKey: "sync-public-key",
                }).finish(),
            ),
        );
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("creates encrypted linking package and returns mnemonic", async () => {
        const sourceBlob = VaultUtilTypes.LinkingPackageBlob.create({
            SyncID: "source-sync",
            OnlineServices: undefined,
            STUNServers: [],
            TURNServers: [],
            SignalingServer: undefined,
            SyncSigningPublicKey: "source-sync-public-key",
        });

        const result = await LinkingPackage.createNewPackage(sourceBlob);

        expect(result.mnemonic).toContain("alpha beta");
        expect(result.linkingPackage).toBeInstanceOf(LinkingPackage);
        expect(result.linkingPackage.Salt).toBe("salt-b64");
        expect(mockHashSecret).not.toHaveBeenCalled();
        expect(mockEncryptDataBlob).toHaveBeenCalledTimes(1);
        expect(mockEncryptDataBlob.mock.calls[0]?.[1]).toEqual(
            utf8Bytes(result.mnemonic),
        );
        expect(mockEncryptDataBlob.mock.calls[0]?.[0]).toEqual(
            VaultUtilTypes.LinkingPackageBlob.encode(sourceBlob).finish(),
        );
    });

    it("decrypts package back to LinkingPackageBlob payload", async () => {
        const pkg = new LinkingPackage(new Uint8Array([1, 2]), "salt", "header");

        const res = await pkg.decryptPackage("mnemonic words");

        expect(res.isOk()).toBe(true);
        if (res.isOk()) {
            expect(res.value.SyncID).toBe("sync-1");
        }
        expect(mockHashSecret).not.toHaveBeenCalled();
        expect(mockDecryptDataBlob.mock.calls[0]?.[1]).toEqual(
            utf8Bytes("mnemonic words"),
        );
    });

    it("propagates decryption errors", async () => {
        mockDecryptDataBlob.mockResolvedValueOnce(err("DECRYPTION_FAILED"));
        const pkg = new LinkingPackage(new Uint8Array([1]), "salt", "header");

        const res = await pkg.decryptPackage("bad words");

        expect(res.isErr()).toBe(true);
        if (res.isErr()) {
            expect(res.error).toBe("DECRYPTION_FAILED");
        }
    });

    it("serializes and deserializes package via binary and base64", () => {
        const pkg = new LinkingPackage(new Uint8Array([9, 8, 7]), "salt", "header");

        const binary = pkg.toBinary();
        const parsedFromBinary = LinkingPackage.fromBinary(binary);
        const b64 = pkg.toBase64();
        const parsedFromBase64 = LinkingPackage.fromBase64(b64);

        expect(parsedFromBinary.Blob).toEqual(new Uint8Array([9, 8, 7]));
        expect(parsedFromBinary.Salt).toBe("salt");
        expect(parsedFromBinary.HeaderIV).toBe("header");

        expect(parsedFromBase64.isOk()).toBe(true);
        if (parsedFromBase64.isOk()) {
            expect(parsedFromBase64.value.Salt).toBe("salt");
        }
    });

    it("returns DATA_INVALID when fromBase64 input is empty", () => {
        const result = LinkingPackage.fromBase64("");
        expect(result.isErr()).toBe(true);
        if (result.isErr()) {
            expect(result.error).toBe("DATA_INVALID");
        }
    });

    it("can parse from raw base64 generated externally", () => {
        const raw = VaultUtilTypes.LinkingPackage.encode({
            Blob: new Uint8Array([5, 6]),
            Salt: "s",
            HeaderIV: "h",
        }).finish();
        const result = LinkingPackage.fromBase64(uint8ToBase64(raw));

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
            expect(Array.from(result.value.Blob)).toEqual([5, 6]);
        }
    });
});
