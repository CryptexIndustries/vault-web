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
import type { VaultHkdfKey } from "@cryptex-industries/vault-core/envelope-crypto";
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

const mockStoredProtections = new Map<
    number,
    {
        key: VaultHkdfKey | null;
        kind: number;
        credentialId?: string;
        prfSalt?: string;
    }
>();

const mockSetDeviceAdditionalKeyProtectionKey = jest.fn(
    async (
        index: number,
        key: VaultHkdfKey | null,
        kind: number,
        credentialId?: string,
        prfSalt?: string,
    ) => {
        mockStoredProtections.set(index, { key, kind, credentialId, prfSalt });
    },
);
const mockGetDeviceAdditionalKeyProtectionKey = jest.fn(
    async (index: number) => mockStoredProtections.get(index)?.key ?? null,
);

jest.mock("../../src/app_lib/vault-utils/vault-key-store", () => ({
    setDeviceAdditionalKeyProtectionKey: (
        ...args: Parameters<typeof mockSetDeviceAdditionalKeyProtectionKey>
    ) => mockSetDeviceAdditionalKeyProtectionKey(...args),
    getDeviceAdditionalKeyProtectionKey: (
        ...args: Parameters<typeof mockGetDeviceAdditionalKeyProtectionKey>
    ) => mockGetDeviceAdditionalKeyProtectionKey(...args),
}));

import {
    configureVaultCoreRuntime,
    createWebCryptoEnvelopeCrypto,
} from "@cryptex-industries/vault-core/runtime";

configureVaultCoreRuntime({
    envelopeCrypto: createWebCryptoEnvelopeCrypto(),
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
    additionalKeyProtectionStore: {
        setDeviceAdditionalKeyProtectionKey:
            mockSetDeviceAdditionalKeyProtectionKey,
        getDeviceAdditionalKeyProtectionKey:
            mockGetDeviceAdditionalKeyProtectionKey,
    },
});

import sodium from "libsodium-wrappers-sumo";
import * as VaultUtilTypes from "@cryptex-industries/vault-core/proto";
import { KeyDerivationConfig_Argon2ID } from "@cryptex-industries/vault-core/vault-utils/encryption";
import {
    deriveProtectionPhraseKey,
    enrollAdditionalKeyProtection,
    makeWebAuthnUnlockFromSlot,
    resolveAdditionalKeyProtectionForUnlock,
    unlockWebAuthnPrf,
} from "@cryptex-industries/vault-core/vault-utils/additional-key-protection";

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

describe("additional key protection", () => {
    beforeAll(async () => {
        await sodium.ready;
    });

    beforeEach(() => {
        jest.clearAllMocks();
        mockStoredProtections.clear();
        MockPublicKeyCredential.capabilities = { "extension:prf": true };
        delete (globalThis as { window?: unknown }).window;
        delete (globalThis as { navigator?: unknown }).navigator;
        delete (globalThis as { PublicKeyCredential?: unknown })
            .PublicKeyCredential;
    });

    it("returns a null key for NONE enrollment and unlock", async () => {
        await expect(
            enrollAdditionalKeyProtection(
                { kind: VaultUtilTypes.AdditionalKeyProtectionKind.NONE },
                "vault-1",
                undefined,
                kdf,
            ),
        ).resolves.toEqual({
            kind: VaultUtilTypes.AdditionalKeyProtectionKind.NONE,
            hkdfBaseKey: null,
        });

        await expect(
            resolveAdditionalKeyProtectionForUnlock(
                undefined,
                VaultUtilTypes.AdditionalKeyProtectionKind.NONE,
            ),
        ).resolves.toBeNull();
    });

    it("enrolls protection phrases and persists device keys only for valid DB ids", async () => {
        const enrolled = await enrollAdditionalKeyProtection(
            {
                kind: VaultUtilTypes.AdditionalKeyProtectionKind
                    .PROTECTION_PHRASE_128,
            },
            "vault-1",
            7,
            kdf,
        );

        expect(enrolled.kind).toBe(
            VaultUtilTypes.AdditionalKeyProtectionKind.PROTECTION_PHRASE_128,
        );
        expect(enrolled.protectionPhrase).toBeTruthy();
        expect(enrolled.protectionPhraseSalt).toBeTruthy();
        expect(enrolled.hkdfBaseKey).toBeTruthy();
        expect(mockSetDeviceAdditionalKeyProtectionKey).toHaveBeenCalledWith(
            7,
            enrolled.hkdfBaseKey,
            VaultUtilTypes.AdditionalKeyProtectionKind.PROTECTION_PHRASE_128,
        );

        await enrollAdditionalKeyProtection(
            {
                kind: VaultUtilTypes.AdditionalKeyProtectionKind
                    .PROTECTION_PHRASE_256,
            },
            "vault-1",
            -1,
            kdf,
        );
        expect(mockSetDeviceAdditionalKeyProtectionKey).toHaveBeenCalledTimes(
            1,
        );
    });

    it("derives protection-phrase keys or falls back to device storage", async () => {
        const enrolled = await enrollAdditionalKeyProtection(
            {
                kind: VaultUtilTypes.AdditionalKeyProtectionKind
                    .PROTECTION_PHRASE_128,
            },
            "vault-1",
            2,
            kdf,
        );

        const fromProtectionPhrase =
            await resolveAdditionalKeyProtectionForUnlock(
                undefined,
                VaultUtilTypes.AdditionalKeyProtectionKind
                    .PROTECTION_PHRASE_128,
                {
                    protectionPhrase: enrolled.protectionPhrase,
                    protectionPhraseSaltB64: enrolled.protectionPhraseSalt,
                    protectionPhraseKdfConfig: kdf,
                },
            );
        const direct = await deriveProtectionPhraseKey(
            enrolled.protectionPhrase!,
            enrolled.protectionPhraseSalt!,
            kdf,
        );
        const stored = await resolveAdditionalKeyProtectionForUnlock(
            2,
            VaultUtilTypes.AdditionalKeyProtectionKind.PROTECTION_PHRASE_128,
        );

        expect(fromProtectionPhrase).toBeInstanceOf(CryptoKey);
        expect(direct).toBeInstanceOf(CryptoKey);
        expect(stored).toBe(enrolled.hkdfBaseKey);
    });

    it("requires a DB id for cached protection-phrase unlocks", async () => {
        await expect(
            resolveAdditionalKeyProtectionForUnlock(
                undefined,
                VaultUtilTypes.AdditionalKeyProtectionKind
                    .PROTECTION_PHRASE_128,
            ),
        ).rejects.toThrow("VAULT_DB_INDEX_MISSING");
        await expect(
            resolveAdditionalKeyProtectionForUnlock(
                -1,
                VaultUtilTypes.AdditionalKeyProtectionKind
                    .PROTECTION_PHRASE_128,
            ),
        ).rejects.toThrow("VAULT_DB_INDEX_MISSING");
    });

    it("enrolls WebAuthn PRF using create-time PRF output", async () => {
        const prf = crypto.getRandomValues(new Uint8Array(32));
        const credentials = installWebAuthnMocks({ createPrf: prf });

        const enrolled = await enrollAdditionalKeyProtection(
            { kind: VaultUtilTypes.AdditionalKeyProtectionKind.WEBAUTHN_PRF },
            "vault-1",
            undefined,
            kdf,
        );

        expect(enrolled.kind).toBe(
            VaultUtilTypes.AdditionalKeyProtectionKind.WEBAUTHN_PRF,
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

        const enrolled = await enrollAdditionalKeyProtection(
            { kind: VaultUtilTypes.AdditionalKeyProtectionKind.WEBAUTHN_PRF },
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
            enrollAdditionalKeyProtection(
                {
                    kind: VaultUtilTypes.AdditionalKeyProtectionKind
                        .WEBAUTHN_PRF,
                },
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
            enrollAdditionalKeyProtection(
                {
                    kind: VaultUtilTypes.AdditionalKeyProtectionKind
                        .WEBAUTHN_PRF,
                },
                "vault-1",
                undefined,
                kdf,
            ),
        ).rejects.toThrow("WEBAUTHN_PRF_UNSUPPORTED");

        MockPublicKeyCredential.capabilities = { "extension:prf": true };
        installWebAuthnMocks({ createCredential: null });
        await expect(
            enrollAdditionalKeyProtection(
                {
                    kind: VaultUtilTypes.AdditionalKeyProtectionKind
                        .WEBAUTHN_PRF,
                },
                "vault-1",
                undefined,
                kdf,
            ),
        ).rejects.toThrow("WEBAUTHN_ENROLL_FAILED");

        installWebAuthnMocks({ getCredential: null });
        await expect(
            enrollAdditionalKeyProtection(
                {
                    kind: VaultUtilTypes.AdditionalKeyProtectionKind
                        .WEBAUTHN_PRF,
                },
                "vault-1",
                undefined,
                kdf,
            ),
        ).rejects.toThrow("WEBAUTHN_PRF_GET_FAILED");

        installWebAuthnMocks();
        await expect(
            enrollAdditionalKeyProtection(
                {
                    kind: VaultUtilTypes.AdditionalKeyProtectionKind
                        .WEBAUTHN_PRF,
                },
                "vault-1",
                undefined,
                kdf,
            ),
        ).rejects.toThrow("WEBAUTHN_PRF_NO_OUTPUT");
    });

    it("unlocks WebAuthn PRF protections from metadata", async () => {
        const prf = crypto.getRandomValues(new Uint8Array(32));
        const credentials = installWebAuthnMocks({ getPrf: prf });
        const credentialId = Buffer.from([9, 8, 7]).toString("base64");
        const prfSalt = Buffer.from([6, 5, 4]).toString("base64");

        const direct = await unlockWebAuthnPrf(credentialId, prfSalt);
        const fromSlot = await makeWebAuthnUnlockFromSlot(
            credentialId,
            prfSalt,
        )();
        const resolved = await resolveAdditionalKeyProtectionForUnlock(
            undefined,
            VaultUtilTypes.AdditionalKeyProtectionKind.WEBAUTHN_PRF,
            { webAuthnUnlock: async () => fromSlot },
        );

        expect(direct).toBeInstanceOf(CryptoKey);
        expect(fromSlot).toBeInstanceOf(CryptoKey);
        expect(resolved).toBe(fromSlot);
        expect(credentials.get).toHaveBeenCalledTimes(2);
    });

    it("requires WebAuthn callback and PRF output during unlock", async () => {
        await expect(
            resolveAdditionalKeyProtectionForUnlock(
                undefined,
                VaultUtilTypes.AdditionalKeyProtectionKind.WEBAUTHN_PRF,
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

    it("rejects unknown additional key protection kinds", async () => {
        await expect(
            enrollAdditionalKeyProtection(
                { kind: 999 } as never,
                "vault-1",
                undefined,
                kdf,
            ),
        ).rejects.toThrow("ADDITIONAL_KEY_PROTECTION_UNSUPPORTED");
        await expect(
            resolveAdditionalKeyProtectionForUnlock(undefined, 999 as never),
        ).rejects.toThrow("ADDITIONAL_KEY_PROTECTION_UNSUPPORTED");
    });
});
