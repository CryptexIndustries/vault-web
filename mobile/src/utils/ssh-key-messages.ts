import { i18n } from "@lingui/core";
import { t } from "@lingui/core/macro";
import type {
    SSHKeyErrorCode,
    SSHKeyErrorParams,
} from "@cryptex-industries/vault-core/vault-utils/ssh-key";

/** Mobile wording for an SSH key import or export error from vault-core. */
export function sshKeyErrorText(error: {
    code: SSHKeyErrorCode | "internal";
    message: string;
    params?: SSHKeyErrorParams;
}): string {
    const { name, scheme, unit } = error.params ?? {};
    switch (error.code) {
        case "empty":
            return t`Paste a private key or choose a key file.`;
        case "invalid":
            return t`This doesn't look like an SSH private key.`;
        case "public-key-only":
            return t`This is a public key. Use the private key file instead, for example id_ed25519 rather than id_ed25519.pub.`;
        case "public-key-invalid":
            return t`The public key isn't a valid SSH public key.`;
        case "public-key-mismatch":
            return t`The public key doesn't belong to this private key.`;
        case "passphrase-required":
            return t`This key is protected with a passphrase. Enter it to import the key.`;
        case "wrong-passphrase":
            return t`The passphrase is incorrect.`;
        case "dsa":
            return t`DSA keys aren't supported because OpenSSH no longer accepts them. Generate a new Ed25519 key instead.`;
        case "rsa-too-small":
            return t`This RSA key is shorter than 1024 bits, which OpenSSH refuses to use. Generate a new Ed25519 key instead.`;
        case "security-key":
            return t`This key needs a hardware security key to sign, so it can't be stored in the vault.`;
        case "putty":
            return t`PuTTY key files aren't supported. In PuTTYgen, choose Conversions > Export OpenSSH key and import that file.`;
        case "multiple-keys":
            return t`This file holds more than one key. Split it into one file per key.`;
        case "unsupported-cipher":
            switch (scheme) {
                case "legacy-pkcs8":
                    return t`This key is encrypted with a legacy PKCS#8 scheme, which isn't supported. Re-encrypt it with "ssh-keygen -p -f <file>" and import it again.`;
                case "non-pbkdf2-kdf":
                    return t`This key is encrypted with a key derivation other than PBKDF2, which isn't supported. Re-encrypt it with "ssh-keygen -p -f <file>" and import it again.`;
                case "pbkdf2-hash":
                    return t`This key is encrypted with this PBKDF2 hash, which isn't supported. Re-encrypt it with "ssh-keygen -p -f <file>" and import it again.`;
                case "pkcs8-cipher":
                    return t`This key is encrypted with this PKCS#8 cipher, which isn't supported. Re-encrypt it with "ssh-keygen -p -f <file>" and import it again.`;
                case "unknown-cipher":
                    return t`This key is encrypted with an unknown cipher, which isn't supported. Re-encrypt it with "ssh-keygen -p -f <file>" and import it again.`;
            }
            if (name === undefined) break;
            return t`This key is encrypted with ${name}, which isn't supported. Re-encrypt it with "ssh-keygen -p -f <file>" and import it again.`;
        case "unsupported-key-type":
            if (scheme === "elliptic-curve")
                return t`This elliptic curve keys aren't supported. Supported types are Ed25519, ECDSA and RSA.`;
            if (name === undefined) break;
            return t`${name} keys aren't supported. Supported types are Ed25519, ECDSA and RSA.`;
        case "kdf-too-expensive": {
            const count = error.params?.count?.toLocaleString(i18n.locale);
            const max = error.params?.max?.toLocaleString(i18n.locale);
            if (!count || !max) break;
            if (unit === "rounds")
                return t`This key's passphrase protection uses ${count} rounds, more than the ${max} Cryptex Vault accepts. Re-encrypt it with "ssh-keygen -p -a 100 -f <file>" and import it again.`;
            if (unit === "iterations")
                return t`This key's passphrase protection uses ${count} iterations, more than the ${max} Cryptex Vault accepts. Re-encrypt it with "ssh-keygen -p -a 100 -f <file>" and import it again.`;
            break;
        }
        case "internal":
            return t`Something went wrong while reading this key. Try again.`;
    }
    return error.message;
}
