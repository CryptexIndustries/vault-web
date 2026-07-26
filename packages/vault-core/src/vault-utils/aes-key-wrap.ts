import { aeskw } from "@noble/ciphers/aes";

const portableAesKwMaterial = new WeakMap<object, Uint8Array>();

const toBufferSource = (bytes: Uint8Array): BufferSource =>
    new Uint8Array(bytes);

function hasNativeAesKeyWrap(): boolean {
    return (
        typeof crypto.subtle.wrapKey === "function" &&
        typeof crypto.subtle.unwrapKey === "function"
    );
}

export function wrapRawKeyWithAesKw(
    rawKey: Uint8Array,
    rawWrappingKey: Uint8Array,
): Uint8Array {
    return new Uint8Array(
        aeskw(new Uint8Array(rawWrappingKey)).encrypt(new Uint8Array(rawKey)),
    );
}

export function unwrapRawKeyWithAesKw(
    wrappedKey: Uint8Array,
    rawWrappingKey: Uint8Array,
): Uint8Array {
    return new Uint8Array(
        aeskw(new Uint8Array(rawWrappingKey)).decrypt(
            new Uint8Array(wrappedKey),
        ),
    );
}

export async function importPortableAesKwKey(
    rawKeyMaterial: Uint8Array,
    extractable: boolean,
): Promise<CryptoKey> {
    if (hasNativeAesKeyWrap()) {
        return crypto.subtle.importKey(
            "raw",
            toBufferSource(rawKeyMaterial),
            { name: "AES-KW" },
            extractable,
            ["wrapKey", "unwrapKey"],
        );
    }

    const handle = Object.freeze({
        type: "secret",
        extractable,
        algorithm: Object.freeze({ name: "AES-KW", length: 256 }),
        usages: Object.freeze(["wrapKey", "unwrapKey"]),
    }) as unknown as CryptoKey;
    portableAesKwMaterial.set(handle, new Uint8Array(rawKeyMaterial));
    return handle;
}

export async function wrapKeyWithAesKw(
    keyToWrap: CryptoKey,
    wrappingKey: CryptoKey,
): Promise<Uint8Array> {
    const portableMaterial = portableAesKwMaterial.get(wrappingKey);
    if (!portableMaterial) {
        const wrapped = await crypto.subtle.wrapKey(
            "raw",
            keyToWrap,
            wrappingKey,
            "AES-KW",
        );
        return new Uint8Array(wrapped);
    }

    const rawKey = await crypto.subtle.exportKey("raw", keyToWrap);
    return wrapRawKeyWithAesKw(new Uint8Array(rawKey), portableMaterial);
}

export async function unwrapKeyWithAesKw(
    wrappedKey: Uint8Array,
    wrappingKey: CryptoKey,
    extractable: boolean,
): Promise<CryptoKey> {
    const portableMaterial = portableAesKwMaterial.get(wrappingKey);
    if (!portableMaterial) {
        return crypto.subtle.unwrapKey(
            "raw",
            toBufferSource(wrappedKey),
            wrappingKey,
            "AES-KW",
            { name: "AES-GCM", length: 256 },
            extractable,
            ["encrypt", "decrypt"],
        );
    }

    const rawKey = unwrapRawKeyWithAesKw(wrappedKey, portableMaterial);
    return crypto.subtle.importKey(
        "raw",
        toBufferSource(rawKey),
        { name: "AES-GCM", length: 256 },
        extractable,
        ["encrypt", "decrypt"],
    );
}
