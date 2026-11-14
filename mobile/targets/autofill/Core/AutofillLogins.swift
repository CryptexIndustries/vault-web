import Foundation

/// Which Face ID-enabled vault the extension opens.
enum VaultChoice: Equatable {
    case none
    case open(Int)
    /// Several vaults: ask, with the last one picked offered first.
    case ask([Int])

    static func resolve(enabled: [Int], lastChoice: Int?) -> VaultChoice {
        guard enabled.count > 1 else { return enabled.first.map(VaultChoice.open) ?? .none }
        guard let lastChoice, enabled.contains(lastChoice) else { return .ask(enabled) }
        return .ask([lastChoice] + enabled.filter { $0 != lastChoice })
    }
}

/// Where the system wants a login: a page URL from Safari or a web view, or a
/// domain from an app's associated domains.
enum ServiceTarget: Equatable {
    case url(String)
    case domain(String)
}

struct AutofillLogin: Identifiable {
    let id: String
    let name: String
    let username: String
    let password: String
    /// Nil without a TOTP secret.
    let totp: VaultUtilTypes_TOTP?
    let rules: [CredentialURLRule]
    /// Saved through the inbox and not yet in the vault.
    var isPending = false
}

enum AutofillLogins {
    /// For passwords, the logins isAutofillCandidate in
    /// mobile/src/utils/android-autofill.ts accepts. For one-time codes, those
    /// with a TOTP secret, as AutofillIdentities registers them. For text
    /// insertion (nil), those with anything to insert. Pending inbox entries
    /// are applied first.
    static func candidates(
        in vault: VaultUtilTypes_Vault,
        for kind: AutofillIdentity.Kind?,
        pending: [(id: String, login: InboxLogin)] = []
    ) -> [AutofillLogin] {
        let logins = vault.credentials
            .filter { !$0.deleted && $0.type != .sshkey }
            .map {
                AutofillLogin(
                    id: $0.id,
                    name: $0.name,
                    username: $0.username,
                    password: $0.password,
                    totp: $0.hasTotp && !$0.totp.secret.isEmpty ? $0.totp : nil,
                    rules: CredentialURLMatching.rules(of: $0)
                )
            }
        return AutofillInbox.applyPending(pending, to: logins)
            .filter { login in
                switch kind {
                case .password: !login.password.isEmpty
                case .oneTimeCode: login.totp != nil
                case nil: !login.username.isEmpty || !login.password.isEmpty || login.totp != nil
                }
            }
            .sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
    }

    /// Logins matching any target, best match first.
    static func matching(_ logins: [AutofillLogin], targets: [ServiceTarget]) -> [AutofillLogin] {
        let ranked: [(login: AutofillLogin, priority: Int)] = logins.compactMap { login in
            targets.compactMap { priority(of: login, for: $0) }.max().map { (login, $0) }
        }
        return ranked
            .sorted { $0.priority != $1.priority ? $0.priority > $1.priority : $0.login.name.localizedStandardCompare($1.login.name) == .orderedAscending }
            .map(\.login)
    }

    private static func priority(of login: AutofillLogin, for target: ServiceTarget) -> Int? {
        switch target {
        case let .url(url):
            return CredentialURLMatching.matchPriority(login.rules, pageURL: url, ignorePort: false)
        // A domain carries no port, as Android's webDomain.
        case let .domain(domain):
            return CredentialURLMatching.matchPriority(login.rules, pageURL: "https://" + domain, ignorePort: true)
        }
    }

    static func search(_ logins: [AutofillLogin], query: String) -> [AutofillLogin] {
        let query = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return logins }
        return logins.filter { login in
            ([login.name, login.username] + login.rules.map(\.url)).contains {
                $0.range(of: query, options: [.caseInsensitive, .diacriticInsensitive]) != nil
            }
        }
    }

    /// The identity record identifier the app registers: "<vault index>:<credential ID>".
    static func parseRecordIdentifier(_ value: String) -> (vaultIndex: Int, credentialID: String)? {
        guard let colon = value.firstIndex(of: ":"),
              let vaultIndex = Int(value[..<colon]), vaultIndex > 0
        else { return nil }
        let credentialID = String(value[value.index(after: colon)...])
        return credentialID.isEmpty ? nil : (vaultIndex, credentialID)
    }
}

extension CredentialURLMatching {
    static func rules(of credential: VaultUtilTypes_Credential) -> [CredentialURLRule] {
        rules(
            [CredentialURLRule(url: credential.url, matchMode: .init(rawValue: credential.urlmatchMode.rawValue))]
                + credential.additionalUrls.map { CredentialURLRule(url: $0.url, matchMode: .init(rawValue: $0.matchMode.rawValue)) }
        )
    }
}

extension IdentityLogin {
    /// Nil for the logins the app never sends: deleted ones and SSH keys.
    init?(_ credential: VaultUtilTypes_Credential) {
        guard !credential.deleted, credential.type != .sshkey else { return nil }
        self.init(
            id: credential.id,
            name: credential.name,
            username: credential.username,
            hasPassword: !credential.password.isEmpty,
            hasTotp: credential.hasTotp && !credential.totp.secret.isEmpty,
            rules: CredentialURLMatching.rules(of: credential)
        )
    }

    /// A login as the extension just saved it.
    init(_ login: AutofillLogin) {
        self.init(
            id: login.id,
            name: login.name,
            username: login.username,
            hasPassword: !login.password.isEmpty,
            hasTotp: login.totp != nil,
            rules: login.rules
        )
    }
}
