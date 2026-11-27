import Foundation

/// The Add login form's values, which follow Android's item editor
/// (mobile/src/components/vault/credential-form.tsx).
struct LoginDraft: Equatable {
    struct Website: Identifiable, Equatable {
        let id = UUID()
        var url = ""
        var matchMode = CredentialURLMatchMode.exactHost
    }

    struct Field: Identifiable, Equatable {
        enum Kind: Int, CaseIterable {
            case text = 0
            case hidden = 1
            case boolean = 2
            case date = 3
        }

        let id = UUID().uuidString.lowercased()
        var name = ""
        var kind = Kind.text
        var value = ""
    }

    struct Authenticator: Equatable {
        var label = ""
        var secret = ""
        var period = "30"
        var digits = "6"
        /// TOTPAlgorithm in vault.proto.
        var algorithm = 0
    }

    enum Problem: Error, Equatable {
        case nameRequired
        case nameTooLong
        case labelTooLong
        case websiteInvalid
    }

    var name = ""
    var username = ""
    var password = ""
    var website = Website()
    var additionalWebsites: [Website] = []
    var directoryId = ""
    var authenticator: Authenticator?
    var fields: [Field] = []
    var tags = ""
    var notes = ""

    /// handleSave's checks and clean-up, in its order.
    func credential() -> Result<InboxCredential, Problem> {
        let name = CredentialURLMatching.jsTrim(name)
        guard !name.isEmpty else { return .failure(.nameRequired) }
        // zod counts UTF-16 code units, as JavaScript strings do.
        guard name.utf16.count <= 255 else { return .failure(.nameTooLong) }
        let totp = authenticator.flatMap { authenticator -> InboxCredential.TOTP? in
            let secret = CredentialURLMatching.jsTrim(authenticator.secret)
            guard !secret.isEmpty else { return nil }
            let label = CredentialURLMatching.jsTrim(authenticator.label)
            return InboxCredential.TOTP(
                label: label.isEmpty ? name : label,
                secret: secret.components(separatedBy: .whitespacesAndNewlines).joined(),
                period: Int(authenticator.period).flatMap { $0 >= 1 ? $0 : nil } ?? 30,
                digits: Int(authenticator.digits).flatMap { $0 >= 1 ? $0 : nil } ?? 6,
                algorithm: authenticator.algorithm
            )
        }
        if let totp, totp.label.utf16.count > 255 { return .failure(.labelTooLong) }
        let websites = [website] + additionalWebsites
        guard websites.allSatisfy({ CredentialURLMatching.jsTrim($0.url).isEmpty || CredentialURLMatching.isValid(.init(url: $0.url, matchMode: $0.matchMode)) })
        else { return .failure(.websiteInvalid) }
        return .success(InboxCredential(
            name: name,
            username: username,
            password: password,
            url: website.url,
            urlMatchMode: website.matchMode.rawValue,
            additionalUrls: additionalWebsites.map { .init(url: $0.url, matchMode: $0.matchMode.rawValue) },
            directoryId: directoryId,
            totp: totp,
            // joinTags with CredentialConstants.TAG_SEPARATOR.
            tags: tags.split(separator: ",", omittingEmptySubsequences: false)
                .map { CredentialURLMatching.jsTrim(String($0)) }
                .filter { !$0.isEmpty }
                .joined(separator: ",|.|,"),
            notes: notes,
            customFields: fields
                .filter { !CredentialURLMatching.jsTrim($0.name).isEmpty && !CredentialURLMatching.jsTrim($0.value).isEmpty }
                .map { .init(id: $0.id, name: $0.name, type: $0.kind.rawValue, value: $0.value) }
        ))
    }

    /// applyTotpEditor: the key without spaces in upper case, or nil when it
    /// isn't base32 of at least 8 characters.
    static func setupKey(_ raw: String) -> String? {
        let key = raw.components(separatedBy: .whitespacesAndNewlines).joined().uppercased()
        return key.range(of: "^[A-Z2-7]{8,}={0,6}$", options: .regularExpression) != nil ? key : nil
    }

    /// booleanFieldValue: what a switch field stores.
    static func booleanValue(_ value: String) -> String {
        ["1", "true", "yes", "on"].contains(CredentialURLMatching.jsTrim(value).lowercased()) ? "true" : "false"
    }
}
