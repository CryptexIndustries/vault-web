// Runs in Hermes with the installed native crypto, never with Jest mocks.
import { getEnvelopeCrypto } from "@cryptex-industries/vault-core/runtime";
import {
    KeySlotKind,
    AdditionalKeyProtectionKind,
} from "@cryptex-industries/vault-core/proto";
import { KeyDerivationConfig_Argon2ID } from "@cryptex-industries/vault-core/vault-utils/encryption";
import {
    encodeSlot,
    openPrimarySlot,
    decryptWithDEK,
} from "@cryptex-industries/vault-core/vault-utils/envelope-encryption";
import { openEnvelopeBlob } from "@cryptex-industries/vault-core/vault-utils/vault-envelope-ops";
import {
    createLinkMac,
    verifyLinkMac,
    deriveAeadKey,
    sealAead,
    openAead,
} from "@cryptex-industries/vault-core/vault-utils/sync-crypto";
import { uint8ToBase64 } from "@cryptex-industries/vault-core/encoding";
import { createMobileEnvelopeCrypto } from "../src/crypto/envelope-crypto";
import { createLinkedVaultEnvelope } from "../src/utils/linked-vault-envelope";
import { testSodiumCompatibility } from "./sodium-compatibility";
import { runNativeWebRTCTests } from "./native-webrtc-suite";

const bytes = (hex: string) =>
    Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16));
const hex = (value: ArrayBuffer | Uint8Array) =>
    Array.from(new Uint8Array(value), (b) =>
        b.toString(16).padStart(2, "0"),
    ).join("");
const utf8 = (s: string) => new TextEncoder().encode(s);
function check(value: unknown, message: string): asserts value {
    if (!value) throw new Error(message);
}
async function rejects(operation: () => Promise<unknown>, message: string) {
    try {
        await operation();
    } catch {
        return;
    }
    throw new Error(message);
}

export async function runNativeCryptoTests() {
    await testSodiumCompatibility();
    const port = getEnvelopeCrypto();
    await port.selfTest(); // The shared fixed HKDF + AES-256-KW vector.

    // Public fixture generated independently with Node crypto + libsodium WASM.
    // Argon2id: 19 MiB, 2 passes. DEK: 32 bytes of 03. AES-GCM IV: 12 bytes of 04.
    const password = "Cryptex public compatibility fixture";
    const plaintext = utf8("Existing vault payload ✓");
    const slot = encodeSlot(
        KeySlotKind.PRIMARY,
        AdditionalKeyProtectionKind.NONE,
        bytes(
            "41347817ce3b9bf2918339fd43fc543b09ee3bf875e1919fe75dbf28ad6cb0543c3cba83f50d53e7",
        ),
        new Uint8Array(16).fill(1),
        new KeyDerivationConfig_Argon2ID(19, 2),
        new Uint8Array(32).fill(2),
        "native-crypto-fixture",
    ) as Parameters<typeof openPrimarySlot>[0];
    const opened = await openPrimarySlot(
        slot,
        password,
        "native-crypto-fixture",
        null,
    );
    check(opened.isOk(), "Existing primary slot did not open");
    const dek = opened.value;
    await rejects(
        () => crypto.subtle.exportKey("raw", dek),
        "DEK extractability was ignored",
    );
    const ciphertext = bytes(
        "055f7abed9f76979b962e12b1d201900f005e30322a76700b4fb48421b7ef654536ab3686fb473ab70d2",
    );
    const iv = uint8ToBase64(new Uint8Array(12).fill(4));
    const decrypted = await decryptWithDEK(dek, ciphertext, iv);
    check(
        decrypted.isOk() && hex(decrypted.value) === hex(plaintext),
        "Existing ciphertext changed",
    );
    check(
        (
            await openPrimarySlot(
                slot,
                "wrong password",
                "native-crypto-fixture",
                null,
            )
        ).isErr(),
        "Wrong password accepted",
    );
    ciphertext[0] ^= 1;
    check(
        (await decryptWithDEK(dek, ciphertext, iv)).isErr(),
        "Tampered vault accepted",
    );
    slot.WrappedDEK[0] ^= 1;
    check(
        (
            await openPrimarySlot(slot, password, "native-crypto-fixture", null)
        ).isErr(),
        "Tampered wrapped key accepted",
    );

    // New vault/recovery round trip through the production envelope operations.
    const created = await createLinkedVaultEnvelope(plaintext, {
        vaultId: "native-crypto-fixture",
        masterPassword: password,
        kdfConfig: new KeyDerivationConfig_Argon2ID(19, 2),
    });
    const recovered = await openEnvelopeBlob(
        created.blob,
        "native-crypto-fixture",
        {
            masterPassword: "",
            useRecovery: true,
            recoveryCode: created.recoveryCode,
        },
    );
    check(
        recovered.isOk() && hex(recovered.value.plaintext) === hex(plaintext),
        "Recovery failed",
    );

    // Real link authentication and AEAD, including authenticated metadata rejection.
    const mac = await createLinkMac("public link fixture", utf8("transcript"));
    check(
        hex(mac) ===
            "468afb6897e77d8d0c33b2c3a4609aeaae9c9e2d512e245aa36b85179c99d100",
        "HMAC vector failed",
    );
    check(
        await verifyLinkMac("public link fixture", utf8("transcript"), mac),
        "Link MAC rejected",
    );
    mac[0] ^= 1;
    check(
        !(await verifyLinkMac("public link fixture", utf8("transcript"), mac)),
        "Bad MAC accepted",
    );
    const linkKey = await deriveAeadKey(
        new Uint8Array(32).fill(5),
        utf8("context"),
    );
    const sealed = await sealAead(linkKey, plaintext, utf8("aad"));
    check(
        hex(await openAead(linkKey, sealed, utf8("aad"))) === hex(plaintext),
        "Link encryption failed",
    );
    await rejects(
        () => openAead(linkKey, sealed, utf8("wrong aad")),
        "Bad AAD accepted",
    );

    // Legacy PBKDF2-HMAC-SHA256 known-answer vector, before AES-GCM import.
    const passwordKey = await crypto.subtle.importKey(
        "raw",
        utf8("password"),
        "PBKDF2",
        false,
        ["deriveBits"],
    );
    const derived = await crypto.subtle.deriveBits(
        { name: "PBKDF2", hash: "SHA-256", salt: utf8("salt"), iterations: 1 },
        passwordKey,
        256,
    );
    check(
        hex(derived) ===
            "120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b",
        "PBKDF2 vector failed",
    );

    // Passkey/device-signing JWK and raw ECDSA signature are also verified by Node.
    const pair = await crypto.subtle.generateKey(
        { name: "ECDSA", namedCurve: "P-256" },
        true,
        ["sign", "verify"],
    );
    const privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
    const publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
    const privateKey = await crypto.subtle.importKey(
        "jwk",
        privateJwk,
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["sign"],
    );
    const signature = await crypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        privateKey,
        utf8("public signature fixture"),
    );
    check(signature.byteLength === 64, "ECDSA signature is not IEEE P1363");
    check(
        await crypto.subtle.verify(
            { name: "ECDSA", hash: "SHA-256" },
            pair.publicKey,
            signature,
            utf8("public signature fixture"),
        ),
        "ECDSA verification failed",
    );
    await rejects(
        () => crypto.subtle.exportKey("jwk", privateKey),
        "Private-key extractability ignored",
    );
    const verifyOnly = await crypto.subtle.importKey(
        "raw",
        utf8("key"),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["verify"],
    );
    await rejects(
        () => crypto.subtle.sign("HMAC", verifyOnly, plaintext),
        "Key usage restriction ignored",
    );

    // Revocation and a broken native implementation must fail closed.
    const kek = await port.importKek(new Uint8Array(32));
    port.disposeKek(kek);
    await rejects(
        () => port.unwrapDek(new Uint8Array(40), kek, false),
        "Disposed KEK accepted",
    );
    const original = crypto.subtle.wrapKey;
    let calls = 0;
    crypto.subtle.wrapKey = async () => {
        calls++;
        throw new Error("test failure");
    };
    try {
        const broken = createMobileEnvelopeCrypto();
        await rejects(() => broken.selfTest(), "Broken self-test accepted");
        await rejects(
            () => broken.importKek(new Uint8Array(32)),
            "Failed backend used",
        );
        check(calls === 1, "Self-test failure was not cached");
    } finally {
        crypto.subtle.wrapKey = original;
    }
    const webrtc = await runNativeWebRTCTests();
    return { publicJwk, signature: hex(signature), webrtc };
}
