import { AdditionalKeyProtectionKind } from "@cryptex-industries/vault-core/proto";
import { KeyDerivationConfig_Argon2ID } from "@cryptex-industries/vault-core/vault-utils/encryption";

import type {
    VaultMetadata,
    VaultSecurityUpdate,
} from "@/app_lib/vault-utils/storage";
import type {
    ExtensionVaultAdditionalKeyProtectionKind,
    ReconfigureVaultSecurityRequest,
    RotateVaultRecoveryCodeRequest,
} from "../types/sw-messaging";

type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

const isBoundedSecret = (value: unknown, allowEmpty = false): value is string =>
    typeof value === "string" &&
    value.length <= 8_192 &&
    (allowEmpty || value.length > 0);

function parseAuthorization(value: Record<string, unknown>): ParseResult<{
    currentMasterPassword: string;
    currentProtectionPhrase?: string;
}> {
    if (!isBoundedSecret(value.currentMasterPassword)) {
        return { ok: false, error: "INVALID_CURRENT_MASTER_PASSWORD" };
    }
    if (
        value.currentProtectionPhrase !== undefined &&
        !isBoundedSecret(value.currentProtectionPhrase)
    ) {
        return { ok: false, error: "INVALID_CURRENT_PROTECTION_PHRASE" };
    }
    return {
        ok: true,
        value: {
            currentMasterPassword: value.currentMasterPassword,
            ...(typeof value.currentProtectionPhrase === "string"
                ? {
                      currentProtectionPhrase: value.currentProtectionPhrase,
                  }
                : {}),
        },
    };
}

function isExtensionProtectionKind(
    value: unknown,
): value is ExtensionVaultAdditionalKeyProtectionKind {
    return (
        value === AdditionalKeyProtectionKind.NONE ||
        value === AdditionalKeyProtectionKind.PROTECTION_PHRASE_128 ||
        value === AdditionalKeyProtectionKind.PROTECTION_PHRASE_256
    );
}

function parseBoolean(value: unknown): value is boolean {
    return typeof value === "boolean";
}

export function parseReconfigureVaultSecurityRequest(
    payload: unknown,
): ParseResult<ReconfigureVaultSecurityRequest> {
    if (!isRecord(payload)) {
        return { ok: false, error: "INVALID_SECURITY_REQUEST" };
    }
    const auth = parseAuthorization(payload);
    if (!auth.ok) return auth;
    if (
        payload.newMasterPassword !== undefined &&
        !isBoundedSecret(payload.newMasterPassword)
    ) {
        return { ok: false, error: "INVALID_NEW_MASTER_PASSWORD" };
    }
    if (!isExtensionProtectionKind(payload.additionalKeyProtectionKind)) {
        return { ok: false, error: "EXTENSION_WEBAUTHN_UNSUPPORTED" };
    }
    if (!isRecord(payload.kdf)) {
        return { ok: false, error: "INVALID_KDF_CONFIG" };
    }
    const memLimit = payload.kdf.memLimit;
    const opsLimit = payload.kdf.opsLimit;
    if (
        !Number.isInteger(memLimit) ||
        !Number.isInteger(opsLimit) ||
        (memLimit as number) < KeyDerivationConfig_Argon2ID.MIN_MEM_LIMIT ||
        (memLimit as number) > KeyDerivationConfig_Argon2ID.MAX_MEM_LIMIT ||
        (opsLimit as number) < KeyDerivationConfig_Argon2ID.MIN_OPS_LIMIT ||
        (opsLimit as number) > KeyDerivationConfig_Argon2ID.MAX_OPS_LIMIT
    ) {
        return { ok: false, error: "INVALID_KDF_CONFIG" };
    }
    if (
        !parseBoolean(payload.rotateDataKey) ||
        !parseBoolean(payload.deleteOlderManagedBackups)
    ) {
        return { ok: false, error: "INVALID_SECURITY_OPTIONS" };
    }

    return {
        ok: true,
        value: {
            ...auth.value,
            ...(typeof payload.newMasterPassword === "string"
                ? { newMasterPassword: payload.newMasterPassword }
                : {}),
            additionalKeyProtectionKind: payload.additionalKeyProtectionKind,
            kdf: {
                memLimit: memLimit as number,
                opsLimit: opsLimit as number,
            },
            rotateDataKey: payload.rotateDataKey,
            deleteOlderManagedBackups: payload.deleteOlderManagedBackups,
        },
    };
}

export function parseRotateVaultRecoveryCodeRequest(
    payload: unknown,
): ParseResult<RotateVaultRecoveryCodeRequest> {
    if (!isRecord(payload)) {
        return { ok: false, error: "INVALID_RECOVERY_ROTATION_REQUEST" };
    }
    const auth = parseAuthorization(payload);
    if (!auth.ok) return auth;
    if (
        !parseBoolean(payload.rotateDataKey) ||
        !parseBoolean(payload.deleteOlderManagedBackups)
    ) {
        return { ok: false, error: "INVALID_SECURITY_OPTIONS" };
    }
    return {
        ok: true,
        value: {
            ...auth.value,
            rotateDataKey: payload.rotateDataKey,
            deleteOlderManagedBackups: payload.deleteOlderManagedBackups,
        },
    };
}

function currentProtectionIsSupported(metadata: VaultMetadata): boolean {
    return (
        metadata.Blob?.Envelope?.PrimaryProtectionKind !==
        AdditionalKeyProtectionKind.WEBAUTHN_PRF
    );
}

export async function reconfigureExtensionVaultSecurity(
    metadata: VaultMetadata,
    request: ReconfigureVaultSecurityRequest,
): Promise<ParseResult<VaultSecurityUpdate>> {
    if (!currentProtectionIsSupported(metadata)) {
        return { ok: false, error: "EXTENSION_WEBAUTHN_UNSUPPORTED" };
    }
    const result = await metadata.reconfigureSecurity({
        currentMasterPassword: request.currentMasterPassword,
        currentProtectionPhrase: request.currentProtectionPhrase,
        newMasterPassword: request.newMasterPassword,
        additionalKeyProtection: { kind: request.additionalKeyProtectionKind },
        kdfConfig: new KeyDerivationConfig_Argon2ID(
            request.kdf.memLimit,
            request.kdf.opsLimit,
        ),
        rotateDataKey: request.rotateDataKey,
    });
    return result.isOk()
        ? { ok: true, value: result.value }
        : { ok: false, error: result.error };
}

export async function rotateExtensionVaultRecoveryCode(
    metadata: VaultMetadata,
    request: RotateVaultRecoveryCodeRequest,
): Promise<ParseResult<VaultSecurityUpdate>> {
    if (!currentProtectionIsSupported(metadata)) {
        return { ok: false, error: "EXTENSION_WEBAUTHN_UNSUPPORTED" };
    }
    const result = await metadata.resetRecoveryCode({
        currentMasterPassword: request.currentMasterPassword,
        currentProtectionPhrase: request.currentProtectionPhrase,
        rotateDataKey: request.rotateDataKey,
    });
    return result.isOk()
        ? { ok: true, value: result.value }
        : { ok: false, error: result.error };
}
