import CryptoKit
import Foundation

/// A change the AutoFill extension saved for the app to make to the vault the
/// next time it unlocks it (mobile/src/utils/ios-autofill-inbox.ts).
struct InboxLogin: Codable, Equatable {
    enum Decision: String, Codable {
        case new
        case update
        /// Adds the credential's URL to the target's websites.
        case associate
    }

    let decision: Decision
    /// For an update or association, the credential to change: a vault login
    /// or an earlier entry's new login, whose ID is that entry's ID.
    let targetId: String?
    /// A new login uses every field and an association only its URL. An
    /// update uses the username and password, and also the name and URL when
    /// the target was deleted.
    let credential: InboxCredential
}

/// CredentialFormSchema in vault-core, without the fields the app sets itself.
struct InboxCredential: Codable, Equatable {
    struct Rule: Codable, Equatable {
        var url: String
        var matchMode: Int

        enum CodingKeys: String, CodingKey {
            case url = "URL"
            case matchMode = "MatchMode"
        }
    }

    struct TOTP: Codable, Equatable {
        var label: String
        var secret: String
        var period: Int
        var digits: Int
        var algorithm: Int

        enum CodingKeys: String, CodingKey {
            case label = "Label"
            case secret = "Secret"
            case period = "Period"
            case digits = "Digits"
            case algorithm = "Algorithm"
        }
    }

    struct CustomField: Codable, Equatable {
        var id: String
        var name: String
        var type: Int
        var value: String

        enum CodingKeys: String, CodingKey {
            case id = "ID"
            case name = "Name"
            case type = "Type"
            case value = "Value"
        }
    }

    var name = ""
    var username = ""
    var password = ""
    var url = ""
    var urlMatchMode = 0
    var additionalUrls: [Rule] = []
    var directoryId = ""
    var totp: TOTP?
    var tags = ""
    var notes = ""
    var customFields: [CustomField] = []

    enum CodingKeys: String, CodingKey {
        case name = "Name"
        case username = "Username"
        case password = "Password"
        case url = "URL"
        case urlMatchMode = "URLMatchMode"
        case additionalUrls = "AdditionalURLs"
        case directoryId = "DirectoryID"
        case totp = "TOTP"
        case tags = "Tags"
        case notes = "Notes"
        case customFields = "CustomFields"
    }

    var rules: [CredentialURLRule] {
        CredentialURLMatching.rules(
            [CredentialURLRule(url: url, matchMode: .init(rawValue: urlMatchMode))]
                + additionalUrls.map { CredentialURLRule(url: $0.url, matchMode: .init(rawValue: $0.matchMode)) }
        )
    }

    /// Nil without a secret, as candidates reads a vault login's.
    var vaultTotp: VaultUtilTypes_TOTP? {
        guard let totp, !totp.secret.isEmpty else { return nil }
        var vaultTotp = VaultUtilTypes_TOTP()
        vaultTotp.label = totp.label
        vaultTotp.secret = totp.secret
        vaultTotp.period = Int32(clamping: totp.period)
        vaultTotp.digits = Int32(clamping: totp.digits)
        vaultTotp.algorithm = .init(rawValue: totp.algorithm) ?? .sha1
        return vaultTotp
    }
}

/// One stored entry. Only the ciphertext holds anything secret.
struct InboxEntry: Codable, Equatable {
    /// Also the new login's credential ID, which makes adding it idempotent.
    let id: String
    let vaultIndex: Int
    /// Milliseconds since 1970; entries apply in this order.
    let createdAt: Int64
    /// Base64 of the 12-byte IV.
    let iv: String
    /// Base64 of the AES-GCM-256 ciphertext and tag, under the vault's DEK.
    let ciphertext: String
}

enum AutofillInbox {
    /// Binds the ciphertext to its vault and entry, so it can't be moved to
    /// another vault or replayed under another ID.
    static func additionalData(id: String, vaultIndex: Int) -> Data {
        Data("cryptex-autofill-inbox/v1|\(vaultIndex)|\(id)".utf8)
    }

    static func seal(_ login: InboxLogin, id: String, vaultIndex: Int, createdAt: Date, key: SymmetricKey) throws -> InboxEntry {
        var plaintext = try JSONEncoder().encode(login)
        defer { VaultDecryption.wipe(&plaintext) }
        let box = try AES.GCM.seal(
            plaintext,
            using: key,
            nonce: AES.GCM.Nonce(),
            authenticating: additionalData(id: id, vaultIndex: vaultIndex)
        )
        return InboxEntry(
            id: id,
            vaultIndex: vaultIndex,
            createdAt: Int64((createdAt.timeIntervalSince1970 * 1000).rounded(.down)),
            iv: Data(box.nonce).base64EncodedString(),
            ciphertext: (box.ciphertext + box.tag).base64EncodedString()
        )
    }

    static func open(_ entry: InboxEntry, key: SymmetricKey) throws -> InboxLogin {
        guard let iv = Data(base64Encoded: entry.iv), let sealed = Data(base64Encoded: entry.ciphertext) else {
            throw VaultDecryptionError.malformed
        }
        var plaintext = try VaultDecryption.openSealed(
            sealed,
            iv: iv,
            key: key,
            authenticating: additionalData(id: entry.id, vaultIndex: entry.vaultIndex)
        )
        defer { VaultDecryption.wipe(&plaintext) }
        guard let login = try? JSONDecoder().decode(InboxLogin.self, from: plaintext) else {
            throw VaultDecryptionError.malformed
        }
        return login
    }

    /// The vault's logins as they will be once the app adds the pending
    /// entries: new logins appended, updates and associations applied to
    /// their target.
    static func applyPending(_ pending: [(id: String, login: InboxLogin)], to logins: [AutofillLogin]) -> [AutofillLogin] {
        var result = logins
        for (id, entry) in pending {
            let credential = entry.credential
            if entry.decision == .new {
                guard !result.contains(where: { $0.id == id }) else { continue }
                result.append(AutofillLogin(
                    id: id,
                    name: credential.name,
                    username: credential.username,
                    password: credential.password,
                    totp: credential.vaultTotp,
                    rules: credential.rules,
                    isPending: true
                ))
                continue
            }
            guard let index = result.firstIndex(where: { $0.id == entry.targetId }) else { continue }
            let target = result[index]
            let update = entry.decision == .update
            result[index] = AutofillLogin(
                id: target.id,
                name: target.name,
                username: update ? credential.username : target.username,
                password: update ? credential.password : target.password,
                totp: target.totp,
                rules: update ? target.rules : target.rules + [CredentialURLRule(url: credential.url, matchMode: .exactHost)],
                isPending: true
            )
        }
        return result
    }
}
