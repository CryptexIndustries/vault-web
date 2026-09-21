/** @jest-environment node */
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { webcrypto } from "node:crypto";
import { ok } from "neverthrow";

import { AdditionalKeyProtectionKind } from "@cryptex-industries/vault-core/proto";

Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: webcrypto,
});

const openPrimarySlotMock = jest.fn();
const resolveAdditionalKeyProtectionForUnlockMock = jest.fn();
const setDeviceAdditionalKeyProtectionKeyMock = jest.fn(async () => undefined);
const sessionSetMock = jest.fn(async () => undefined);
const sessionGetMock = jest.fn(async () => ({}));
const sessionRemoveMock = jest.fn(async () => undefined);
const setAccessLevelMock = jest.fn(async () => undefined);

jest.mock(
    "@cryptex-industries/vault-core/vault-utils/envelope-encryption",
    () => ({
        isEnvelopeBlob: () => true,
        openPrimarySlot: openPrimarySlotMock,
    }),
);

jest.mock(
    "@cryptex-industries/vault-core/vault-utils/additional-key-protection",
    () => ({
        resolveAdditionalKeyProtectionForUnlock:
            resolveAdditionalKeyProtectionForUnlockMock,
    }),
);

jest.mock("@/app_lib/vault-utils/vault-key-store", () => ({
    setDeviceAdditionalKeyProtectionKey:
        setDeviceAdditionalKeyProtectionKeyMock,
}));

Object.defineProperty(globalThis, "chrome", {
    configurable: true,
    value: {
        storage: {
            session: {
                set: sessionSetMock,
                get: sessionGetMock,
                remove: sessionRemoveMock,
                setAccessLevel: setAccessLevelMock,
            },
        },
    },
});

import { setSessionDEKFromVaultMetadata } from "../src/background/session-dek-store";

function metadata(kind: AdditionalKeyProtectionKind) {
    return {
        Blob: {
            Envelope: {
                VaultID: "vault-id",
                PrimaryProtectionKind: kind,
                Slots: [
                    {
                        Kind: 0,
                        ProtectionPhraseSalt: "protection-salt",
                        KDFConfigArgon2ID: { memLimit: 32, opsLimit: 2 },
                    },
                ],
            },
        },
    } as never;
}

describe("extension session DEK store", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("derives and caches a supplied protection phrase entirely in the service worker", async () => {
        const protectionKey = { type: "secret" } as CryptoKey;
        const dek = await webcrypto.subtle.generateKey(
            { name: "AES-GCM", length: 256 },
            true,
            ["encrypt", "decrypt"],
        );
        resolveAdditionalKeyProtectionForUnlockMock.mockResolvedValue(
            protectionKey,
        );
        openPrimarySlotMock.mockResolvedValue(ok(dek));

        await setSessionDEKFromVaultMetadata(
            7,
            metadata(AdditionalKeyProtectionKind.PROTECTION_PHRASE_128),
            {
                masterPassword: "password",
                protectionPhrase: "phrase words",
            },
        );

        expect(
            resolveAdditionalKeyProtectionForUnlockMock,
        ).toHaveBeenCalledWith(
            7,
            AdditionalKeyProtectionKind.PROTECTION_PHRASE_128,
            expect.objectContaining({
                protectionPhrase: "phrase words",
                protectionPhraseSaltB64: "protection-salt",
                protectionPhraseKdfConfig: expect.objectContaining({
                    memLimit: 32,
                    opsLimit: 2,
                }),
            }),
        );
        expect(setDeviceAdditionalKeyProtectionKeyMock).toHaveBeenCalledWith(
            7,
            protectionKey,
            AdditionalKeyProtectionKind.PROTECTION_PHRASE_128,
        );
        expect(openPrimarySlotMock).toHaveBeenCalledWith(
            expect.anything(),
            "password",
            "vault-id",
            protectionKey,
            true,
        );
        expect(sessionSetMock).toHaveBeenCalledWith(
            expect.objectContaining({
                "SESSION_DEK:7": expect.objectContaining({
                    v: 1,
                    alg: "AES-GCM-256",
                    rawB64: expect.any(String),
                }),
            }),
        );
    });

    it("uses the existing local protection without trying to persist it again", async () => {
        const protectionKey = { type: "secret" } as CryptoKey;
        const dek = await webcrypto.subtle.generateKey(
            { name: "AES-GCM", length: 256 },
            true,
            ["encrypt", "decrypt"],
        );
        resolveAdditionalKeyProtectionForUnlockMock.mockResolvedValue(
            protectionKey,
        );
        openPrimarySlotMock.mockResolvedValue(ok(dek));

        await setSessionDEKFromVaultMetadata(
            7,
            metadata(AdditionalKeyProtectionKind.PROTECTION_PHRASE_256),
            { masterPassword: "password" },
        );

        expect(setDeviceAdditionalKeyProtectionKeyMock).not.toHaveBeenCalled();
        expect(
            resolveAdditionalKeyProtectionForUnlockMock,
        ).toHaveBeenCalledWith(
            7,
            AdditionalKeyProtectionKind.PROTECTION_PHRASE_256,
            expect.objectContaining({ protectionPhrase: undefined }),
        );
    });

    it("keeps the unlocked session when caching an entered phrase fails", async () => {
        const protectionKey = { type: "secret" } as CryptoKey;
        const dek = await webcrypto.subtle.generateKey(
            { name: "AES-GCM", length: 256 },
            true,
            ["encrypt", "decrypt"],
        );
        resolveAdditionalKeyProtectionForUnlockMock.mockResolvedValue(
            protectionKey,
        );
        openPrimarySlotMock.mockResolvedValue(ok(dek));
        setDeviceAdditionalKeyProtectionKeyMock.mockRejectedValueOnce(
            new Error("IndexedDB unavailable") as never,
        );

        await expect(
            setSessionDEKFromVaultMetadata(
                7,
                metadata(AdditionalKeyProtectionKind.PROTECTION_PHRASE_128),
                {
                    masterPassword: "password",
                    protectionPhrase: "phrase words",
                },
            ),
        ).resolves.toBeUndefined();
        expect(sessionSetMock).toHaveBeenCalledTimes(1);
    });

    it("rejects WebAuthn PRF in the extension", async () => {
        await expect(
            setSessionDEKFromVaultMetadata(
                7,
                metadata(AdditionalKeyProtectionKind.WEBAUTHN_PRF),
                { masterPassword: "password" },
            ),
        ).rejects.toThrow("EXTENSION_WEBAUTHN_UNSUPPORTED");
        expect(openPrimarySlotMock).not.toHaveBeenCalled();
    });
});
