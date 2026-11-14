import CryptoKit
import Foundation
import LocalAuthentication
import MMKVAppExtension
import Security

enum SharedVaultError: Error {
    case unavailable
    /// Face ID was canceled or did not recognize the user.
    case notAuthenticated
    /// iOS refused to show Face ID because the extension isn't on screen yet.
    case notInteractive
    /// The Face ID key is gone, for example after a change to enrolled faces.
    case keyInvalidated
    case unreadable
}

/// What the app shares through the App Group: the vault store
/// (src/app_lib/vault-utils/storage.ts) and the Face ID unlock items
/// (src/lib/secure-dek.ts), which the extension only reads, and the inbox of
/// saved logins (src/utils/ios-autofill-inbox.ts), which both write.
struct SharedVault {
    struct Summary: Identifiable {
        let id: Int
        let name: String
    }

    private static let storeID = "cryptex-vault-db"
    private static let inboxID = "cryptex-autofill-inbox"
    private static let inboxPrefix = "entry:"
    private static let lastVaultKey = "autofill.lastVaultIndex"

    private let appGroup: String
    private let store: MMKV
    private let inbox: MMKV

    init?() {
        guard let appGroup = Bundle.main.object(forInfoDictionaryKey: "AppGroup") as? String,
              let directory = FileManager.default
                  .containerURL(forSecurityApplicationGroupIdentifier: appGroup)?.path,
              // A missing file would make MMKV return nil from a non-null initializer.
              FileManager.default.fileExists(atPath: (directory as NSString).appendingPathComponent(Self.storeID))
        else { return nil }
        MMKV.initialize(rootDir: directory, logLevel: .none)
        self.appGroup = appGroup
        store = MMKV(mmapID: Self.storeID, cryptKey: nil, rootPath: directory, mode: MMKVMode(rawValue: MMKVMode.multiProcess.rawValue | MMKVMode.readOnly.rawValue)!, expectedCapacity: 0)
        inbox = MMKV(mmapID: Self.inboxID, cryptKey: nil, rootPath: directory, mode: .multiProcess, expectedCapacity: 0)
    }

    /// This vault's saved logins that the app hasn't added yet, oldest first.
    /// Entries that don't open are left for the app to report.
    func pendingLogins(vaultIndex: Int, key: SymmetricKey) -> [(id: String, login: InboxLogin)] {
        inbox.allKeys().compactMap { $0 as? String }
            .filter { $0.hasPrefix(Self.inboxPrefix) }
            .compactMap { inbox.string(forKey: $0)?.data(using: .utf8) }
            .compactMap { try? JSONDecoder().decode(InboxEntry.self, from: $0) }
            .filter { $0.vaultIndex == vaultIndex }
            .sorted { $0.createdAt < $1.createdAt }
            .compactMap { entry in (try? AutofillInbox.open(entry, key: key)).map { (entry.id, $0) } }
    }

    /// True when `key` still opens the vault as the app stored it last.
    func keyOpensStoredVault(_ index: Int, key: SymmetricKey) -> Bool {
        storedMetadata(index).map { VaultDecryption.keyOpens(storedMetadata: $0, key: key) } ?? false
    }

    func addToInbox(_ entry: InboxEntry) throws {
        let json = String(decoding: try JSONEncoder().encode(entry), as: UTF8.self)
        guard inbox.set(json, forKey: Self.inboxPrefix + entry.id) else { throw SharedVaultError.unreadable }
    }

    /// Vaults with Face ID unlock turned on, in the app's order.
    func faceIDVaults() -> [Summary] {
        guard let ids = store.string(forKey: "vaults:ids")?.data(using: .utf8),
              let indexes = try? JSONDecoder().decode([Int].self, from: ids)
        else { return [] }
        return indexes.compactMap { index in
            guard index > 0, readItem(wrappedKeyItem(index)) != nil,
                  let stored = storedMetadata(index),
                  let bytes = Data(base64Encoded: stored),
                  let metadata = try? VaultUtilTypes_VaultMetadata(serializedBytes: bytes)
            else { return nil }
            return Summary(id: index, name: metadata.name)
        }
    }

    /// The app's "Copy verification codes" setting.
    var autoCopyTotp: Bool {
        UserDefaults(suiteName: appGroup)?.bool(forKey: "autofill.autoCopyTotp") ?? false
    }

    var lastVaultIndex: Int? {
        get { UserDefaults(suiteName: appGroup)?.object(forKey: Self.lastVaultKey) as? Int }
        nonmutating set { UserDefaults(suiteName: appGroup)?.set(newValue, forKey: Self.lastVaultKey) }
    }

    /// "Touch ID" on the iPhones that have it, otherwise "Face ID".
    static var biometryName: String {
        let context = LAContext()
        _ = context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)
        return context.biometryType == .touchID ? "Touch ID" : "Face ID"
    }

    /// Asks for Face ID and decrypts the vault. Blocks while the prompt is up.
    func unlock(_ index: Int, reason: String) throws -> OpenedVault {
        guard let stored = storedMetadata(index), let wrappedKey = readItem(wrappedKeyItem(index)) else {
            throw SharedVaultError.unavailable
        }
        let context = LAContext()
        context.localizedReason = reason
        // There is no fallback, so no "Enter Password" button after a failed match.
        context.localizedFallbackTitle = ""
        // Ask explicitly rather than rely on the item's access control alone: the
        // Simulator keychain doesn't enforce it, and on a device the keychain
        // reuses this authenticated context, so there is still one prompt.
        let evaluated = DispatchSemaphore(value: 0)
        var authenticated = false
        var failure: LAError.Code?
        context.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: reason) { success, error in
            authenticated = success
            failure = (error as? LAError)?.code
            evaluated.signal()
        }
        evaluated.wait()
        if failure == .notInteractive { throw SharedVaultError.notInteractive }
        guard authenticated else { throw SharedVaultError.notAuthenticated }
        var query = wrapKeyItem(index)
        query[kSecUseAuthenticationContext as String] = context
        var result: CFTypeRef?
        switch SecItemCopyMatching(readQuery(query) as CFDictionary, &result) {
        case errSecSuccess:
            break
        case errSecUserCanceled, errSecAuthFailed:
            throw SharedVaultError.notAuthenticated
        case errSecItemNotFound:
            throw SharedVaultError.keyInvalidated
        default:
            throw SharedVaultError.unreadable
        }
        guard var wrapKey = result as? Data else { throw SharedVaultError.unreadable }
        do {
            return try VaultDecryption.open(storedMetadata: stored, wrapKeyItem: &wrapKey, wrappedKeyItem: wrappedKey)
        } catch {
            throw SharedVaultError.unreadable
        }
    }

    private func storedMetadata(_ index: Int) -> String? {
        store.string(forKey: "vault:data:\(index)")
    }

    // expo-secure-store's query: the service carries the authentication
    // suffix, and the key is both the account and the generic attribute.
    private func item(service: String, key: String) -> [String: Any] {
        let key = Data(key.utf8)
        return [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrGeneric as String: key,
            kSecAttrAccount as String: key,
            kSecAttrAccessGroup as String: appGroup,
        ]
    }

    private func wrappedKeyItem(_ index: Int) -> [String: Any] {
        item(service: "cryptex.biometric.\(index):no-auth", key: "cryptex.biometric-wrapped-dek.\(index)")
    }

    private func wrapKeyItem(_ index: Int) -> [String: Any] {
        item(service: "cryptex.biometric.\(index):auth", key: "cryptex.biometric-device-wrap-key.\(index)")
    }

    private func readQuery(_ query: [String: Any]) -> [String: Any] {
        query.merging([kSecMatchLimit as String: kSecMatchLimitOne, kSecReturnData as String: true]) { $1 }
    }

    private func readItem(_ query: [String: Any]) -> Data? {
        var result: CFTypeRef?
        guard SecItemCopyMatching(readQuery(query) as CFDictionary, &result) == errSecSuccess else { return nil }
        return result as? Data
    }
}
