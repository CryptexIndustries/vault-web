import { createWebCryptoEnvelopeCrypto } from "@cryptex-industries/vault-core/runtime";
import type {
    VaultEnvelopeCrypto,
    VaultHkdfKey,
    VaultKek,
} from "@cryptex-industries/vault-core/envelope-crypto";

/** Native WebCrypto, with a cached self-test and revocable, backend-owned handles. */
export function createMobileEnvelopeCrypto(): VaultEnvelopeCrypto {
    const native = createWebCryptoEnvelopeCrypto();
    const hkdfKeys = new WeakMap<VaultHkdfKey, VaultHkdfKey>();
    const keks = new WeakMap<VaultKek, VaultKek>();
    let readiness: Promise<void> | null = null;
    const ready = (): Promise<void> =>
        (readiness ??= native.selfTest().catch((cause: unknown) => {
            throw new Error("VAULT_PLATFORM_CRYPTO_UNAVAILABLE", { cause });
        }));

    const own = <T extends object>(keys: WeakMap<T, T>, key: T): T => {
        const handle = Object.freeze({}) as T;
        keys.set(handle, key);
        return handle;
    };
    const get = <T extends object>(
        keys: WeakMap<T, T>,
        handle: T,
        error: string,
    ): T => {
        const key = keys.get(handle);
        if (!key) throw new Error(error);
        return key;
    };
    const hkdfKey = (handle: VaultHkdfKey) =>
        get(hkdfKeys, handle, "VAULT_HKDF_KEY_BACKEND_MISMATCH");
    const kek = (handle: VaultKek) =>
        get(keks, handle, "VAULT_KEK_BACKEND_MISMATCH");

    return {
        backend: "quick-crypto-native",
        selfTest: ready,
        async importHkdfKey(raw) {
            await ready();
            return own(hkdfKeys, await native.importHkdfKey(raw));
        },
        async deriveKek(handle, salt, info) {
            await ready();
            return own(
                keks,
                await native.deriveKek(hkdfKey(handle), salt, info),
            );
        },
        async importKek(raw) {
            await ready();
            return own(keks, await native.importKek(raw));
        },
        async wrapDek(dek, handle) {
            await ready();
            if (
                dek.type !== "secret" ||
                dek.algorithm.name !== "AES-GCM" ||
                (dek.algorithm as AesKeyAlgorithm).length !== 256
            ) {
                throw new Error("VAULT_DEK_INVALID");
            }
            return native.wrapDek(dek, kek(handle));
        },
        async unwrapDek(wrapped, handle, extractable) {
            await ready();
            if (wrapped.byteLength !== 40) {
                throw new Error("VAULT_WRAPPED_DEK_INVALID");
            }
            return native.unwrapDek(wrapped, kek(handle), extractable);
        },
        // WebCrypto offers no key-destruction API. Remove our references and
        // reject subsequent use; native key reclamation belongs to the runtime.
        disposeHkdfKey(handle) {
            hkdfKeys.delete(handle);
        },
        disposeKek(handle) {
            keks.delete(handle);
        },
    };
}
