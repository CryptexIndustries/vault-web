import type {
    VaultEnvelopeCrypto,
    VaultHkdfKey,
    VaultKek,
} from "../envelope-crypto";

const AES_256_KEY_BYTES = 32;
const AES_256_WRAPPED_KEY_BYTES = 40;

const toBufferSource = (bytes: Uint8Array): BufferSource =>
    new Uint8Array(bytes);

const ascii = (value: string): Uint8Array =>
    Uint8Array.from(value, (character) => character.charCodeAt(0));

const hex = (value: string): Uint8Array =>
    Uint8Array.from(value.match(/.{2}/g) ?? [], (byte) =>
        Number.parseInt(byte, 16),
    );

function assertLength(
    value: Uint8Array,
    expected: number,
    errorCode: string,
): void {
    if (value.byteLength !== expected) {
        throw new Error(errorCode);
    }
}

function nativeHkdfKey(handle: VaultHkdfKey): CryptoKey {
    const key = handle as unknown as CryptoKey;
    if (
        key?.type !== "secret" ||
        key.algorithm?.name !== "HKDF" ||
        !key.usages?.includes("deriveKey")
    ) {
        throw new Error("VAULT_HKDF_KEY_BACKEND_MISMATCH");
    }
    return key;
}

function nativeKek(handle: VaultKek): CryptoKey {
    const key = handle as unknown as CryptoKey;
    const algorithm = key?.algorithm as AesKeyAlgorithm | undefined;
    if (
        key?.type !== "secret" ||
        algorithm?.name !== "AES-KW" ||
        algorithm.length !== 256
    ) {
        throw new Error("VAULT_KEK_BACKEND_MISMATCH");
    }
    return key;
}

async function runSelfTest(cryptoPort: VaultEnvelopeCrypto): Promise<void> {
    const ikm = hex(
        "000102030405060708090a0b0c0d0e0f" + "101112131415161718191a1b1c1d1e1f",
    );
    const salt = hex(
        "f0e0d0c0b0a090807060504030201000" + "ffeeddccbbaa99887766554433221100",
    );
    const rawDek = hex(
        "00112233445566778899aabbccddeeff" + "000102030405060708090a0b0c0d0e0f",
    );
    const expectedWrapped =
        "9ba053cbe0619b996a04ccd77700c40d" +
        "e2d7b9921bc566637a40e1dc585db184" +
        "2914956b9627efbe";

    let hkdfKey: VaultHkdfKey | null = null;
    let kek: VaultKek | null = null;
    let unwrappedRaw: Uint8Array | null = null;
    try {
        hkdfKey = await cryptoPort.importHkdfKey(ikm);
        kek = await cryptoPort.deriveKek(
            hkdfKey,
            salt,
            ascii("cryptex/kek/v1|01J00000000000000000000000"),
        );
        const dek = await crypto.subtle.importKey(
            "raw",
            toBufferSource(rawDek),
            { name: "AES-GCM", length: 256 },
            true,
            ["encrypt", "decrypt"],
        );
        const wrapped = await cryptoPort.wrapDek(dek, kek);

        if (
            wrapped.byteLength !== AES_256_WRAPPED_KEY_BYTES ||
            Array.from(wrapped, (byte) =>
                byte.toString(16).padStart(2, "0"),
            ).join("") !== expectedWrapped
        ) {
            throw new Error("VAULT_CRYPTO_SELF_TEST_FAILED");
        }

        const unwrapped = await cryptoPort.unwrapDek(wrapped, kek, true);
        unwrappedRaw = new Uint8Array(
            await crypto.subtle.exportKey("raw", unwrapped),
        );
        if (
            unwrappedRaw.byteLength !== rawDek.byteLength ||
            !unwrappedRaw.every((byte, index) => byte === rawDek[index])
        ) {
            throw new Error("VAULT_CRYPTO_SELF_TEST_FAILED");
        }
    } finally {
        if (kek) cryptoPort.disposeKek(kek);
        if (hkdfKey) cryptoPort.disposeHkdfKey(hkdfKey);
        ikm.fill(0);
        rawDek.fill(0);
        unwrappedRaw?.fill(0);
    }
}

export function createWebCryptoEnvelopeCrypto(): VaultEnvelopeCrypto {
    const port: VaultEnvelopeCrypto = {
        backend: "webcrypto",

        async importHkdfKey(rawKeyMaterial) {
            assertLength(
                rawKeyMaterial,
                AES_256_KEY_BYTES,
                "VAULT_HKDF_IKM_INVALID",
            );
            const importBytes = new Uint8Array(rawKeyMaterial);
            try {
                const key = await crypto.subtle.importKey(
                    "raw",
                    importBytes,
                    { name: "HKDF" },
                    false,
                    ["deriveKey"],
                );
                return key as unknown as VaultHkdfKey;
            } finally {
                importBytes.fill(0);
            }
        },

        // Web Crypto exposes non-extractable keys but no destruction primitive.
        // Dropping application references leaves key lifetime to the user agent.
        disposeHkdfKey() {},

        async deriveKek(hkdfKey, salt, info) {
            if (info.byteLength === 0) {
                throw new Error("VAULT_HKDF_INFO_REQUIRED");
            }
            const saltBytes = new Uint8Array(salt);
            try {
                const key = await crypto.subtle.deriveKey(
                    {
                        name: "HKDF",
                        hash: "SHA-256",
                        salt: saltBytes,
                        info: toBufferSource(info),
                    },
                    nativeHkdfKey(hkdfKey),
                    { name: "AES-KW", length: 256 },
                    false,
                    ["wrapKey", "unwrapKey"],
                );
                return key as unknown as VaultKek;
            } finally {
                saltBytes.fill(0);
            }
        },

        async importKek(rawKeyMaterial) {
            assertLength(
                rawKeyMaterial,
                AES_256_KEY_BYTES,
                "VAULT_KEK_MATERIAL_INVALID",
            );
            const importBytes = new Uint8Array(rawKeyMaterial);
            try {
                const key = await crypto.subtle.importKey(
                    "raw",
                    importBytes,
                    { name: "AES-KW", length: 256 },
                    false,
                    ["wrapKey", "unwrapKey"],
                );
                return key as unknown as VaultKek;
            } finally {
                importBytes.fill(0);
            }
        },

        disposeKek() {},

        async wrapDek(dek, kek) {
            const wrapped = await crypto.subtle.wrapKey(
                "raw",
                dek,
                nativeKek(kek),
                "AES-KW",
            );
            return new Uint8Array(wrapped);
        },

        async unwrapDek(wrappedDek, kek, extractable) {
            return crypto.subtle.unwrapKey(
                "raw",
                toBufferSource(wrappedDek),
                nativeKek(kek),
                "AES-KW",
                { name: "AES-GCM", length: 256 },
                extractable,
                ["encrypt", "decrypt"],
            );
        },

        async selfTest() {
            await runSelfTest(port);
        },
    };
    return port;
}
