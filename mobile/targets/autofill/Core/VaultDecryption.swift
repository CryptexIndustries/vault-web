import CryptoKit
import Foundation

enum VaultDecryptionError: Error {
    case malformed
    /// A key does not open its ciphertext.
    case authenticationFailed
}

/// A decrypted vault and its DEK, which seals inbox entries for it.
struct OpenedVault {
    let vault: VaultUtilTypes_Vault
    let key: SymmetricKey
}

/// Opens a vault the way mobile/src/lib/secure-dek.ts and
/// vault-core's decryptWithDEK do: the device wrap key opens the wrapped
/// DEK, and the DEK opens the vault protobuf. Both use AES-256-GCM with a
/// 12-byte IV and the tag appended to the ciphertext.
enum VaultDecryption {
    private struct WrappedPayload: Decodable {
        let iv: String
        let ciphertext: String
    }

    /// - Parameters:
    ///   - storedMetadata: The MMKV value: base64 of a VaultMetadata protobuf.
    ///   - wrapKeyItem: The keychain item: UTF-8 base64 of the 32-byte wrap key.
    ///     Wiped before returning.
    ///   - wrappedKeyItem: The keychain item: JSON `{ iv, ciphertext }`.
    static func open(storedMetadata: String, wrapKeyItem: inout Data, wrappedKeyItem: Data) throws -> OpenedVault {
        defer { wipe(&wrapKeyItem) }
        guard var rawWrapKey = Data(base64Encoded: wrapKeyItem) else { throw VaultDecryptionError.malformed }
        defer { wipe(&rawWrapKey) }
        guard rawWrapKey.count == 32 else { throw VaultDecryptionError.malformed }

        guard let payload = try? JSONDecoder().decode(WrappedPayload.self, from: wrappedKeyItem),
              let wrapIV = Data(base64Encoded: payload.iv),
              let wrappedKey = Data(base64Encoded: payload.ciphertext)
        else { throw VaultDecryptionError.malformed }
        var rawKey = try openSealed(wrappedKey, iv: wrapIV, key: SymmetricKey(data: rawWrapKey))
        defer { wipe(&rawKey) }
        guard rawKey.count == 32 else { throw VaultDecryptionError.malformed }

        let key = SymmetricKey(data: rawKey)
        var plaintext = try openVault(storedMetadata: storedMetadata, key: key)
        defer { wipe(&plaintext) }
        guard let vault = try? VaultUtilTypes_Vault(serializedBytes: plaintext) else {
            throw VaultDecryptionError.malformed
        }
        return OpenedVault(vault: vault, key: key)
    }

    /// True when `key` still opens the vault as stored now. A data key
    /// rotation re-encrypts the vault in the same write that stores it, so
    /// this fails from then on, even if the app stops before it replaces the
    /// Face ID item.
    static func keyOpens(storedMetadata: String, key: SymmetricKey) -> Bool {
        guard var plaintext = try? openVault(storedMetadata: storedMetadata, key: key) else { return false }
        wipe(&plaintext)
        return true
    }

    private static func openVault(storedMetadata: String, key: SymmetricKey) throws -> Data {
        guard let metadataBytes = Data(base64Encoded: storedMetadata),
              let metadata = try? VaultUtilTypes_VaultMetadata(serializedBytes: metadataBytes),
              metadata.hasBlob,
              let vaultIV = Data(base64Encoded: metadata.blob.headerIv)
        else { throw VaultDecryptionError.malformed }
        return try openSealed(metadata.blob.blob, iv: vaultIV, key: key)
    }

    static func openSealed(_ sealed: Data, iv: Data, key: SymmetricKey, authenticating additionalData: Data = Data()) throws -> Data {
        guard iv.count == 12, sealed.count >= 16,
              let box = try? AES.GCM.SealedBox(
                  nonce: AES.GCM.Nonce(data: iv),
                  ciphertext: sealed.dropLast(16),
                  tag: sealed.suffix(16)
              )
        else { throw VaultDecryptionError.malformed }
        guard let plaintext = try? AES.GCM.open(box, using: key, authenticating: additionalData) else {
            throw VaultDecryptionError.authenticationFailed
        }
        return plaintext
    }

    static func wipe(_ data: inout Data) {
        data.resetBytes(in: 0..<data.count)
    }
}
