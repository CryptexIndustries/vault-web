import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import { err, ok, type Result } from "neverthrow";
import {
    base64ToUint8,
    uint8ToBase64,
} from "@cryptex-industries/vault-core/encoding";
import { vaultLog } from "@/utils/logging";

let enrollmentMutationTail: Promise<void> = Promise.resolve();
const pendingUnlocks = new Set<{
    vaultDbIndex: number;
    invalidated: boolean;
}>();

function mutateBiometricEnrollment<T>(
    vaultDbIndex: number,
    operation: () => Promise<T>,
): Promise<T> {
    for (const unlock of pendingUnlocks) {
        if (unlock.vaultDbIndex === vaultDbIndex) unlock.invalidated = true;
    }
    const result = enrollmentMutationTail.then(operation);
    enrollmentMutationTail = result.then(
        () => undefined,
        () => undefined,
    );
    return result;
}

export type BiometricUnlockError =
    | "BIOMETRIC_UNAVAILABLE"
    | "BIOMETRIC_CANCELLED"
    | "BIOMETRIC_NOT_ENROLLED"
    | "AUTH_KEY_FAILED"
    | "VAULT_KEY_EXPORT_FAILED"
    | "ENROLLMENT_SAVE_FAILED"
    | "BIOMETRIC_KEY_INVALIDATED"
    | "WRAP_FAILED"
    | "UNWRAP_FAILED"
    | "NOT_ENABLED";

type WrappedPayload = {
    iv: string;
    ciphertext: string;
};

function enrollmentStorage(vaultDbIndex: number) {
    if (!Number.isSafeInteger(vaultDbIndex) || vaultDbIndex <= 0) {
        throw new RangeError("Vault index must be a positive safe integer");
    }
    return {
        wrappedDek: `cryptex.biometric-wrapped-dek.${vaultDbIndex}`,
        wrapKey: `cryptex.biometric-device-wrap-key.${vaultDbIndex}`,
        options: {
            keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
            // Android shares native wrapping keys within each keychain service.
            keychainService: `cryptex.biometric.${vaultDbIndex}`,
        },
    };
}

type EnrollmentStorage = ReturnType<typeof enrollmentStorage>;

function toBufferSource(bytes: Uint8Array): ArrayBuffer {
    return bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
}

/**
 * Auth-gated AES wrap key. Ciphertext of DEK is stored separately without
 * requireAuthentication so unlock prompts once (not twice).
 */
async function readDeviceWrapKey(
    storage: EnrollmentStorage,
): Promise<CryptoKey | null> {
    const existing = await SecureStore.getItemAsync(storage.wrapKey, {
        requireAuthentication: true,
        authenticationPrompt: "Authenticate to access vault unlock key",
        ...storage.options,
    });

    if (existing) {
        const raw = base64ToUint8(existing);
        const importBytes = new Uint8Array(raw);
        try {
            return await crypto.subtle.importKey(
                "raw",
                importBytes,
                { name: "AES-GCM" },
                false,
                ["encrypt", "decrypt"],
            );
        } finally {
            raw.fill(0);
            importBytes.fill(0);
        }
    }

    return null;
}

async function createDeviceWrapKey(
    storage: EnrollmentStorage,
): Promise<CryptoKey> {
    const raw = crypto.getRandomValues(new Uint8Array(32));
    try {
        await SecureStore.setItemAsync(storage.wrapKey, uint8ToBase64(raw), {
            requireAuthentication: true,
            authenticationPrompt: "Authenticate to enable biometric unlock",
            ...storage.options,
        });
        return await crypto.subtle.importKey(
            "raw",
            raw,
            { name: "AES-GCM" },
            false,
            ["encrypt", "decrypt"],
        );
    } finally {
        raw.fill(0);
    }
}

async function exportDekRaw(dek: CryptoKey): Promise<Uint8Array<ArrayBuffer>> {
    return new Uint8Array(await crypto.subtle.exportKey("raw", dek));
}

async function importDekRaw(raw: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
    return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, [
        "encrypt",
        "decrypt",
    ]);
}

export async function isBiometricAvailable(): Promise<boolean> {
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    if (!hasHardware) return false;
    return LocalAuthentication.isEnrolledAsync();
}

async function enableBiometricUnlockDirect(
    dek: CryptoKey,
    storage: EnrollmentStorage,
): Promise<Result<void, BiometricUnlockError>> {
    let failure: BiometricUnlockError = "BIOMETRIC_UNAVAILABLE";
    let createdWrapKey = false;
    try {
        const hasHardware = await LocalAuthentication.hasHardwareAsync();
        const enrolled = await LocalAuthentication.isEnrolledAsync();
        if (!hasHardware) return err("BIOMETRIC_UNAVAILABLE");
        if (!enrolled) return err("BIOMETRIC_NOT_ENROLLED");

        failure = "AUTH_KEY_FAILED";
        let wrapKey = await readDeviceWrapKey(storage);
        if (!wrapKey) {
            createdWrapKey = true;
            wrapKey = await createDeviceWrapKey(storage);
        }
        const iv = crypto.getRandomValues(new Uint8Array(12));
        failure = "VAULT_KEY_EXPORT_FAILED";
        const rawDek = await exportDekRaw(dek);
        failure = "WRAP_FAILED";
        let ciphertext: Uint8Array;
        try {
            ciphertext = new Uint8Array(
                await crypto.subtle.encrypt(
                    { name: "AES-GCM", iv: toBufferSource(iv) },
                    wrapKey,
                    rawDek,
                ),
            );
        } finally {
            rawDek.fill(0);
        }

        const payload: WrappedPayload = {
            iv: uint8ToBase64(iv),
            ciphertext: uint8ToBase64(ciphertext),
        };

        failure = "ENROLLMENT_SAVE_FAILED";
        await SecureStore.setItemAsync(
            storage.wrappedDek,
            JSON.stringify(payload),
            storage.options,
        );

        return ok(undefined);
    } catch (cause) {
        if (createdWrapKey) {
            try {
                await clearBiometricUnlockDirect(storage);
            } catch {
                // Preserve the enrollment error if cleanup also fails.
            }
        }
        const message = cause instanceof Error ? cause.message : "";
        if (failure === "AUTH_KEY_FAILED") {
            if (/cancel(?:led|ed)|negative button/i.test(message)) {
                return err("BIOMETRIC_CANCELLED");
            }
            if (
                /permanently invalidated|KeyPermanentlyInvalidatedException/i.test(
                    message,
                )
            ) {
                failure = "BIOMETRIC_KEY_INVALIDATED";
            }
        }
        // Record only the stage and a native error code, never raw exceptions or keys.
        const nativeCode =
            typeof cause === "object" &&
            cause !== null &&
            "code" in cause &&
            typeof cause.code === "string" &&
            /^[A-Z_0-9]{1,80}$/.test(cause.code)
                ? cause.code
                : undefined;
        vaultLog.warn("Biometric enrollment failed", {
            stage: failure,
            nativeCode,
        });
        return err(failure);
    }
}

export function enableBiometricUnlock(
    dek: CryptoKey,
    vaultDbIndex: number,
): Promise<Result<void, BiometricUnlockError>> {
    const storage = enrollmentStorage(vaultDbIndex);
    return mutateBiometricEnrollment(vaultDbIndex, () =>
        enableBiometricUnlockDirect(dek, storage),
    );
}

export async function unlockWithBiometric(vaultDbIndex: number): Promise<
    Result<{ dek: CryptoKey; vaultDbIndex: number }, BiometricUnlockError>
> {
    const storage = enrollmentStorage(vaultDbIndex);
    const unlock = { vaultDbIndex, invalidated: false };
    pendingUnlocks.add(unlock);
    try {
        await enrollmentMutationTail;
        if (unlock.invalidated) return err("NOT_ENABLED");
        const hasHardware = await LocalAuthentication.hasHardwareAsync();
        const enrolled = await LocalAuthentication.isEnrolledAsync();
        if (!hasHardware) return err("BIOMETRIC_UNAVAILABLE");
        if (!enrolled) return err("BIOMETRIC_NOT_ENROLLED");

        const wrappedRaw = await SecureStore.getItemAsync(
            storage.wrappedDek,
            storage.options,
        );
        if (unlock.invalidated) return err("NOT_ENABLED");
        if (!wrappedRaw) return err("NOT_ENABLED");
        const wrapKey = await readDeviceWrapKey(storage);
        if (unlock.invalidated) return err("NOT_ENABLED");
        if (!wrapKey) return err("UNWRAP_FAILED");
        const payload = JSON.parse(wrappedRaw) as WrappedPayload;
        const iv = base64ToUint8(payload.iv);
        const ciphertext = base64ToUint8(payload.ciphertext);
        const rawDek = new Uint8Array(
            (await crypto.subtle.decrypt(
                { name: "AES-GCM", iv: toBufferSource(iv) },
                wrapKey,
                toBufferSource(ciphertext),
            )) as ArrayBuffer,
        );

        try {
            const dek = await importDekRaw(rawDek);
            if (unlock.invalidated) return err("NOT_ENABLED");
            return ok({
                dek,
                vaultDbIndex,
            });
        } finally {
            rawDek.fill(0);
        }
    } catch {
        return err(unlock.invalidated ? "NOT_ENABLED" : "UNWRAP_FAILED");
    } finally {
        pendingUnlocks.delete(unlock);
    }
}

async function clearBiometricUnlockDirect(
    storage: EnrollmentStorage,
): Promise<void> {
    try {
        await SecureStore.deleteItemAsync(storage.wrappedDek, storage.options);
    } finally {
        await SecureStore.deleteItemAsync(storage.wrapKey, storage.options);
    }
}

export async function isSecureDekEnrolled(
    vaultDbIndex: number,
): Promise<boolean> {
    const storage = enrollmentStorage(vaultDbIndex);
    await enrollmentMutationTail;
    const payload = await SecureStore.getItemAsync(
        storage.wrappedDek,
        storage.options,
    );
    return payload !== null;
}

export async function enrollSecureDek(
    vaultDbIndex: number,
    dek: CryptoKey,
): Promise<boolean> {
    const result = await enableBiometricUnlock(dek, vaultDbIndex);
    return result.isOk();
}

export async function unlockWithSecureDek(
    vaultDbIndex: number,
): Promise<CryptoKey | null> {
    const result = await unlockWithBiometric(vaultDbIndex);
    if (result.isErr()) return null;
    return result.value.dek;
}

export function clearSecureDek(vaultDbIndex: number): Promise<void> {
    const storage = enrollmentStorage(vaultDbIndex);
    return mutateBiometricEnrollment(vaultDbIndex, () =>
        clearBiometricUnlockDirect(storage),
    );
}
