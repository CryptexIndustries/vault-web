declare const vaultHkdfKeyBrand: unique symbol;
declare const vaultKekBrand: unique symbol;

/** Opaque HKDF input-key handle owned by the configured crypto backend. */
export type VaultHkdfKey = {
    readonly [vaultHkdfKeyBrand]: true;
};

/** Opaque AES-256-KW key-encryption-key handle. */
export type VaultKek = {
    readonly [vaultKekBrand]: true;
};

export type VaultEnvelopeCryptoBackend = "webcrypto" | "quick-crypto-native";

/**
 * Platform cryptography used by the vault envelope.
 *
 * Handles are backend-owned and intentionally expose no key material.
 */
export type VaultEnvelopeCrypto = {
    readonly backend: VaultEnvelopeCryptoBackend;
    importHkdfKey: (rawKeyMaterial: Uint8Array) => Promise<VaultHkdfKey>;
    disposeHkdfKey: (hkdfKey: VaultHkdfKey) => void;
    deriveKek: (
        hkdfKey: VaultHkdfKey,
        salt: Uint8Array,
        info: Uint8Array,
    ) => Promise<VaultKek>;
    importKek: (rawKeyMaterial: Uint8Array) => Promise<VaultKek>;
    disposeKek: (kek: VaultKek) => void;
    wrapDek: (dek: CryptoKey, kek: VaultKek) => Promise<Uint8Array>;
    unwrapDek: (
        wrappedDek: Uint8Array,
        kek: VaultKek,
        extractable: boolean,
    ) => Promise<CryptoKey>;
    selfTest: () => Promise<void>;
};
