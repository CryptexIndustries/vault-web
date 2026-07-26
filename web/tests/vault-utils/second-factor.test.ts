/**
 * @jest-environment node
 */
import {
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    jest,
} from "@jest/globals";
import { webcrypto } from "crypto";
import { TextDecoder, TextEncoder } from "util";

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

if (!("fromBase64" in Uint8Array)) {
    Object.defineProperty(Uint8Array, "fromBase64", {
        value: (value: string) => new Uint8Array(Buffer.from(value, "base64")),
        configurable: true,
    });
}

jest.mock(
    "@/lib/utils",
    () => ({
        base64ToUint8: (value: string): Uint8Array =>
            new Uint8Array(Buffer.from(value, "base64")),
        uint8ToBase64: (value: Uint8Array): string =>
            Buffer.from(value).toString("base64"),
        base64UrlToUint8: (value: string): Uint8Array =>
            new Uint8Array(Buffer.from(value, "base64url")),
        uint8ToBase64Url: (value: Uint8Array): string =>
            Buffer.from(value).toString("base64url"),
    }),
    { virtual: true },
);

const mockStoredFactors = new Map<
    number,
    {
        key: CryptoKey | null;
        kind: number;
        credentialId?: string;
        prfSalt?: string;
    }
>();

const mockSetDeviceSecondFactorKey = jest.fn(
    async (
        index: number,
        key: CryptoKey | null,
        kind: number,
        credentialId?: string,
        prfSalt?: string,
    ) => {
        mockStoredFactors.set(index, { key, kind, credentialId, prfSalt });
    },
);
const mockGetDeviceSecondFactorKey = jest.fn(
    async (index: number) => mockStoredFactors.get(index)?.key ?? null,
);

jest.mock("../../src/app_lib/vault-utils/vault-key-store", () => ({
    setDeviceSecondFactorKey: (
        ...args: Parameters<typeof mockSetDeviceSecondFactorKey>
    ) => mockSetDeviceSecondFactorKey(...args),
    getDeviceSecondFactorKey: (
        ...args: Parameters<typeof mockGetDeviceSecondFactorKey>
    ) => mockGetDeviceSecondFactorKey(...args),
}));

import { configureVaultCoreRuntime } from "@cryptex-industries/vault-core/runtime";

configureVaultCoreRuntime({
    env: {
        NEXT_PUBLIC_PUSHER_APP_KEY: "test-key",
        NEXT_PUBLIC_PUSHER_APP_HOST: "localhost",
        NEXT_PUBLIC_PUSHER_APP_PORT: "6001",
        NEXT_PUBLIC_PUSHER_APP_TLS: false,
    },
    onlineServicesSessionPort: {
        ensureFresh: async () => true,
        forceReauthenticate: async () => false,
    },
    onlineServicesApi: {
        getTurnCredentials: async () => ({ iceServers: [], expiresAt: 0 }),
        authorizeSignalingChannel: async () => ({ auth: "" }),
    },
    syncLog: { debug() {}, info() {}, warn() {}, error() {} },
    signalingLog: { debug() {}, info() {}, warn() {}, error() {} },
    webrtcLog: { debug() {}, info() {}, warn() {}, error() {} },
    secondFactorStore: {
        setDeviceSecondFactorKey: mockSetDeviceSecondFactorKey,
        getDeviceSecondFactorKey: mockGetDeviceSecondFactorKey,
    },
});

import sodium from "libsodium-wrappers-sumo";
import * as VaultUtilTypes from "@cryptex-industries/vault-core/proto";
import { KeyDerivationConfig_Argon2ID } from "@cryptex-industries/vault-core/vault-utils/encryption";
import {
    derivePassphraseSecondFactorKey,
    enrollSecondFactor,
    makeWebAuthnUnlockFromSlot,
    resolveSecondFactorForUnlock,
    unlockWebAuthnPrf,
} from "@cryptex-industries/vault-core/vault-utils/second-factor";

const kdf = new KeyDerivationConfig_Argon2ID(8, 1);

class MockPublicKeyCredential {
    public static capabilities: Record<string, boolean> = {
        "extension:prf": true,
    };

    public static async getClientCapabilities() {
        return MockPublicKeyCredential.capabilities;
    }

    public rawId: Uint8Array;
    private prfOut?: Uint8Array;

    constructor(rawId: Uint8Array, prfOut?: Uint8Array) {
        this.rawId = rawId;
        this.prfOut = prfOut;
    }

    public getClientExtensionResults() {
        return this.prfOut
            ? { prf: { results: { first: this.prfOut.buffer } } }
            : {};
    }
}

function installWebAuthnMocks(options?: {
    createPrf?: Uint8Array;
    getPrf?: Uint8Array;
    createCredential?: unknown;
    getCredential?: unknown;
}) {
    const createCredential =
        options && "createCredential" in options
            ? options.createCredential
            : new MockPublicKeyCredential(
                  new Uint8Array([1, 2, 3]),
                  options?.createPrf,
              );
    const getCredential =
        options && "getCredential" in options
            ? options.getCredential
            : new MockPublicKeyCredential(
                  new Uint8Array([1, 2, 3]),
                  options?.getPrf,
              );
    const credentials = {
        create: jest.fn(async () => createCredential),
        get: jest.fn(async () => getCredential),
    };

    Object.defineProperty(globalThis, "PublicKeyCredential", {
        value: MockPublicKeyCredential,
        configurable: true,
    });
    Object.defineProperty(globalThis, "window", {
        value: {
            PublicKeyCredential: MockPublicKeyCredential,
            location: { hostname: "vault.example.test" },
        },
        configurable: true,
    });
    Object.defineProperty(globalThis, "navigator", {
        value: { credentials },
        configurable: true,
    });

    return credentials;
}

describe("second-factor", () => {
    beforeAll(async () => {
        await sodium.ready;
    });

    beforeEach(() => {
        jest.clearAllMocks();
        mockStoredFactors.clear();
        MockPublicKeyCredential.capabilities = { "extension:prf": true };
        delete (globalThis as { window?: unknown }).window;
        delete (globalThis as { navigator?: unknown }).navigator;
        delete (globalThis as { PublicKeyCredential?: unknown })
            .PublicKeyCredential;
    });

    it("returns a null key for NONE enrollment and unlock", async () => {
        await expect(
            enrollSecondFactor(
                { kind: VaultUtilTypes.SecondFactorKind.NONE },
                "vault-1",
                undefined,
                kdf,
            ),
        ).resolves.toEqual({
            kind: VaultUtilTypes.SecondFactorKind.NONE,
            hkdfBaseKey: null,
        });

        await expect(
            resolveSecondFactorForUnlock(
                undefined,
                VaultUtilTypes.SecondFactorKind.NONE,
            ),
        ).resolves.toBeNull();
    });

    it("enrolls passphrase factors and persists device key only for valid DB ids", async () => {
        const enrolled = await enrollSecondFactor(
            { kind: VaultUtilTypes.SecondFactorKind.PASSPHRASE_128 },
            "vault-1",
            7,
            kdf,
        );

        expect(enrolled.kind).toBe(
            VaultUtilTypes.SecondFactorKind.PASSPHRASE_128,
        );
        expect(enrolled.displaySecret).toBeTruthy();
        expect(enrolled.passphraseSalt).toBeTruthy();
        expect(enrolled.hkdfBaseKey).toBeTruthy();
        expect(mockSetDeviceSecondFactorKey).toHaveBeenCalledWith(
            7,
            enrolled.hkdfBaseKey,
            VaultUtilTypes.SecondFactorKind.PASSPHRASE_128,
        );

        await enrollSecondFactor(
            { kind: VaultUtilTypes.SecondFactorKind.PASSPHRASE_256 },
            "vault-1",
            -1,
            kdf,
        );
        expect(mockSetDeviceSecondFactorKey).toHaveBeenCalledTimes(1);
    });

    it("derives passphrase unlock keys from entered secret or falls back to device storage", async () => {
        const enrolled = await enrollSecondFactor(
            { kind: VaultUtilTypes.SecondFactorKind.PASSPHRASE_128 },
            "vault-1",
            2,
            kdf,
        );

        const fromPassphrase = await resolveSecondFactorForUnlock(
            undefined,
            VaultUtilTypes.SecondFactorKind.PASSPHRASE_128,
            {
                passphrase: enrolled.displaySecret,
                passphraseSaltB64: enrolled.passphraseSalt,
                passphraseKdfConfig: kdf,
            },
        );
        const direct = await derivePassphraseSecondFactorKey(
            enrolled.displaySecret!,
            enrolled.passphraseSalt!,
            kdf,
        );
        const stored = await resolveSecondFactorForUnlock(
            2,
            VaultUtilTypes.SecondFactorKind.PASSPHRASE_128,
        );

        expect(fromPassphrase).toBeInstanceOf(CryptoKey);
        expect(direct).toBeInstanceOf(CryptoKey);
        expect(stored).toBe(enrolled.hkdfBaseKey);
    });

    it("requires a DB id for stored passphrase unlocks", async () => {
        await expect(
            resolveSecondFactorForUnlock(
                undefined,
                VaultUtilTypes.SecondFactorKind.PASSPHRASE_128,
            ),
        ).rejects.toThrow("VAULT_DB_INDEX_MISSING");
        await expect(
            resolveSecondFactorForUnlock(
                -1,
                VaultUtilTypes.SecondFactorKind.PASSPHRASE_128,
            ),
        ).rejects.toThrow("VAULT_DB_INDEX_MISSING");
    });

    it("enrolls WebAuthn PRF using create-time PRF output", async () => {
        const prf = crypto.getRandomValues(new Uint8Array(32));
        const credentials = installWebAuthnMocks({ createPrf: prf });

        const enrolled = await enrollSecondFactor(
            { kind: VaultUtilTypes.SecondFactorKind.WEBAUTHN_PRF },
            "vault-1",
            undefined,
            kdf,
        );

        expect(enrolled.kind).toBe(
            VaultUtilTypes.SecondFactorKind.WEBAUTHN_PRF,
        );
        expect(enrolled.hkdfBaseKey).toBeInstanceOf(CryptoKey);
        expect(enrolled.webauthnCredentialId).toBe(
            Buffer.from([1, 2, 3]).toString("base64"),
        );
        expect(enrolled.webauthnPrfSalt).toBeTruthy();
        expect(credentials.create).toHaveBeenCalledTimes(1);
        expect(credentials.get).not.toHaveBeenCalled();
    });

    it("falls back to assertion when WebAuthn create omits PRF output", async () => {
        const prf = crypto.getRandomValues(new Uint8Array(32));
        const credentials = installWebAuthnMocks({ getPrf: prf });

        const enrolled = await enrollSecondFactor(
            { kind: VaultUtilTypes.SecondFactorKind.WEBAUTHN_PRF },
            "vault-2",
            undefined,
            kdf,
        );

        expect(enrolled.hkdfBaseKey).toBeInstanceOf(CryptoKey);
        expect(credentials.create).toHaveBeenCalledTimes(1);
        expect(credentials.get).toHaveBeenCalledTimes(1);
    });

    it("surfaces WebAuthn enrollment availability and PRF errors", async () => {
        await expect(
            enrollSecondFactor(
                { kind: VaultUtilTypes.SecondFactorKind.WEBAUTHN_PRF },
                "vault-1",
                undefined,
                kdf,
            ),
        ).rejects.toThrow("WEBAUTHN_UNAVAILABLE");

        installWebAuthnMocks({
            createPrf: crypto.getRandomValues(new Uint8Array(32)),
        });
        MockPublicKeyCredential.capabilities = { "extension:prf": false };
        await expect(
            enrollSecondFactor(
                { kind: VaultUtilTypes.SecondFactorKind.WEBAUTHN_PRF },
                "vault-1",
                undefined,
                kdf,
            ),
        ).rejects.toThrow("WEBAUTHN_PRF_UNSUPPORTED");

        MockPublicKeyCredential.capabilities = { "extension:prf": true };
        installWebAuthnMocks({ createCredential: null });
        await expect(
            enrollSecondFactor(
                { kind: VaultUtilTypes.SecondFactorKind.WEBAUTHN_PRF },
                "vault-1",
                undefined,
                kdf,
            ),
        ).rejects.toThrow("WEBAUTHN_ENROLL_FAILED");

        installWebAuthnMocks({ getCredential: null });
        await expect(
            enrollSecondFactor(
                { kind: VaultUtilTypes.SecondFactorKind.WEBAUTHN_PRF },
                "vault-1",
                undefined,
                kdf,
            ),
        ).rejects.toThrow("WEBAUTHN_PRF_GET_FAILED");

        installWebAuthnMocks();
        await expect(
            enrollSecondFactor(
                { kind: VaultUtilTypes.SecondFactorKind.WEBAUTHN_PRF },
                "vault-1",
                undefined,
                kdf,
            ),
        ).rejects.toThrow("WEBAUTHN_PRF_NO_OUTPUT");
    });

    it("unlocks WebAuthn PRF factors from metadata", async () => {
        const prf = crypto.getRandomValues(new Uint8Array(32));
        const credentials = installWebAuthnMocks({ getPrf: prf });
        const credentialId = Buffer.from([9, 8, 7]).toString("base64");
        const prfSalt = Buffer.from([6, 5, 4]).toString("base64");

        const direct = await unlockWebAuthnPrf(credentialId, prfSalt);
        const fromSlot = await makeWebAuthnUnlockFromSlot(
            credentialId,
            prfSalt,
        )();
        const resolved = await resolveSecondFactorForUnlock(
            undefined,
            VaultUtilTypes.SecondFactorKind.WEBAUTHN_PRF,
            { webAuthnUnlock: async () => fromSlot },
        );

        expect(direct).toBeInstanceOf(CryptoKey);
        expect(fromSlot).toBeInstanceOf(CryptoKey);
        expect(resolved).toBe(fromSlot);
        expect(credentials.get).toHaveBeenCalledTimes(2);
    });

    it("requires WebAuthn callback and PRF output during unlock", async () => {
        await expect(
            resolveSecondFactorForUnlock(
                undefined,
                VaultUtilTypes.SecondFactorKind.WEBAUTHN_PRF,
            ),
        ).rejects.toThrow("WEBAUTHN_UNLOCK_REQUIRED");

        installWebAuthnMocks({ getCredential: null });
        await expect(
            unlockWebAuthnPrf(
                Buffer.from([1]).toString("base64"),
                Buffer.from([2]).toString("base64"),
            ),
        ).rejects.toThrow("WEBAUTHN_ASSERT_FAILED");

        installWebAuthnMocks();
        await expect(
            unlockWebAuthnPrf(
                Buffer.from([1]).toString("base64"),
                Buffer.from([2]).toString("base64"),
            ),
        ).rejects.toThrow("WEBAUTHN_PRF_NO_OUTPUT");
    });

    it("returns null for unknown second-factor kinds", async () => {
        await expect(
            resolveSecondFactorForUnlock(undefined, 999 as never),
        ).resolves.toBeNull();
    });
});
