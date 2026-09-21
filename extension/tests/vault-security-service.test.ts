/** @jest-environment node */
import { describe, expect, it, jest } from "@jest/globals";
import { ok } from "neverthrow";

import { AdditionalKeyProtectionKind } from "@cryptex-industries/vault-core/proto";
import type { VaultMetadata } from "@/app_lib/vault-utils/storage";
import {
    parseReconfigureVaultSecurityRequest,
    parseRotateVaultRecoveryCodeRequest,
    reconfigureExtensionVaultSecurity,
    rotateExtensionVaultRecoveryCode,
} from "../src/background/vault-security-service";

function metadata(kind = AdditionalKeyProtectionKind.NONE) {
    return {
        Blob: { Envelope: { PrimaryProtectionKind: kind } },
        reconfigureSecurity: jest.fn(async () =>
            ok({
                dataKeyRotated: true,
                recoveryCode: "new-code",
                additionalKeyProtectionKind:
                    AdditionalKeyProtectionKind.PROTECTION_PHRASE_128,
            }),
        ),
        resetRecoveryCode: jest.fn(async () =>
            ok({
                dataKeyRotated: false,
                recoveryCode: "new-code",
                additionalKeyProtectionKind: kind,
            }),
        ),
    } as unknown as VaultMetadata;
}

const reconfigureRequest = {
    currentMasterPassword: "current",
    newMasterPassword: "next",
    additionalKeyProtectionKind:
        AdditionalKeyProtectionKind.PROTECTION_PHRASE_128,
    kdf: { memLimit: 64, opsLimit: 3 },
    rotateDataKey: true,
    deleteOlderManagedBackups: false,
};

describe("extension vault-security request validation", () => {
    it("accepts a protection-phrase request and preserves explicit options", () => {
        expect(
            parseReconfigureVaultSecurityRequest(reconfigureRequest),
        ).toEqual({ ok: true, value: reconfigureRequest });
        expect(
            parseRotateVaultRecoveryCodeRequest({
                currentMasterPassword: "current",
                rotateDataKey: false,
                deleteOlderManagedBackups: true,
            }),
        ).toEqual({
            ok: true,
            value: {
                currentMasterPassword: "current",
                rotateDataKey: false,
                deleteOlderManagedBackups: true,
            },
        });
    });

    it("rejects WebAuthn enrollment and out-of-range KDF settings", () => {
        expect(
            parseReconfigureVaultSecurityRequest({
                ...reconfigureRequest,
                additionalKeyProtectionKind:
                    AdditionalKeyProtectionKind.WEBAUTHN_PRF,
            }),
        ).toEqual({ ok: false, error: "EXTENSION_WEBAUTHN_UNSUPPORTED" });
        expect(
            parseReconfigureVaultSecurityRequest({
                ...reconfigureRequest,
                kdf: { memLimit: 0, opsLimit: 99 },
            }),
        ).toEqual({ ok: false, error: "INVALID_KDF_CONFIG" });
    });
});

describe("extension vault-security service", () => {
    it("forwards a reconfiguration and optional DEK rotation to storage", async () => {
        const vaultMetadata = metadata();

        const result = await reconfigureExtensionVaultSecurity(
            vaultMetadata,
            reconfigureRequest,
        );

        expect(result).toMatchObject({
            ok: true,
            value: { dataKeyRotated: true, recoveryCode: "new-code" },
        });
        expect(vaultMetadata.reconfigureSecurity).toHaveBeenCalledWith(
            expect.objectContaining({
                currentMasterPassword: "current",
                newMasterPassword: "next",
                additionalKeyProtection: {
                    kind: AdditionalKeyProtectionKind.PROTECTION_PHRASE_128,
                },
                rotateDataKey: true,
                kdfConfig: expect.objectContaining({
                    memLimit: 64,
                    opsLimit: 3,
                }),
            }),
        );
    });

    it("forwards recovery-only rotation without changing the selected protection", async () => {
        const vaultMetadata = metadata(
            AdditionalKeyProtectionKind.PROTECTION_PHRASE_256,
        );
        const request = {
            currentMasterPassword: "current",
            currentProtectionPhrase: "phrase",
            rotateDataKey: false,
            deleteOlderManagedBackups: false,
        };

        const result = await rotateExtensionVaultRecoveryCode(
            vaultMetadata,
            request,
        );

        expect(result).toMatchObject({
            ok: true,
            value: { recoveryCode: "new-code", dataKeyRotated: false },
        });
        expect(vaultMetadata.resetRecoveryCode).toHaveBeenCalledWith({
            currentMasterPassword: "current",
            currentProtectionPhrase: "phrase",
            rotateDataKey: false,
        });
    });

    it("refuses to operate on WebAuthn-protected vaults", async () => {
        const vaultMetadata = metadata(
            AdditionalKeyProtectionKind.WEBAUTHN_PRF,
        );

        await expect(
            reconfigureExtensionVaultSecurity(
                vaultMetadata,
                reconfigureRequest,
            ),
        ).resolves.toEqual({
            ok: false,
            error: "EXTENSION_WEBAUTHN_UNSUPPORTED",
        });
        expect(vaultMetadata.reconfigureSecurity).not.toHaveBeenCalled();
    });
});
