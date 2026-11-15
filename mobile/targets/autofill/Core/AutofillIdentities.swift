import Foundation

/// What iOS gets for its suggestions above the keyboard: a website and a
/// username or label, and for a passkey its IDs, never a password, TOTP
/// secret or private key. The app's iOS module
/// (from the logins the app sends) and the setup screen (from the vault) both
/// build identities here. Tested with AutofillCoreTests/Fixtures/identity-vectors.json.
struct AutofillIdentity: Equatable {
    enum Kind: String {
        case password
        case oneTimeCode
        case passkey
    }

    let kind: Kind
    /// "<vault index>:<credential ID>", which parseRecordIdentifier reads.
    let recordIdentifier: String
    let domain: String
    /// The username, or for a one-time code the label iOS shows.
    let user: String
    /// A passkey's credential ID and user handle. Its domain is the RP ID.
    var credentialID = Data()
    var userHandle = Data()
}

/// What a passkey's identity needs, without its private key.
struct IdentityPasskey: Equatable {
    let credentialID: String
    let rpID: String
    let userHandle: String
    let userName: String
}

/// A login that is neither deleted nor an SSH key, without its secrets.
struct IdentityLogin {
    let id: String
    let name: String
    let username: String
    let hasPassword: Bool
    let hasTotp: Bool
    let passkey: IdentityPasskey?
    let rules: [CredentialURLRule]
}

enum AutofillIdentities {
    static func build(vaultIndex: Int, logins: [IdentityLogin]) -> [AutofillIdentity] {
        logins.flatMap { login -> [AutofillIdentity] in
            var domains: [String] = []
            for domain in CredentialURLMatching.rules(login.rules).compactMap(identityDomain)
            where !domains.contains(domain) {
                domains.append(domain)
            }
            let identities = { (kind: AutofillIdentity.Kind, user: String) in
                domains.map {
                    AutofillIdentity(kind: kind, recordIdentifier: "\(vaultIndex):\(login.id)", domain: $0, user: user)
                }
            }
            return (login.hasPassword && !login.username.isEmpty ? identities(.password, login.username) : [])
                + (login.hasTotp ? identities(.oneTimeCode, login.username.isEmpty ? login.name : login.username) : [])
                + passkeyIdentities(vaultIndex: vaultIndex, login: login)
        }
    }

    private static func passkeyIdentities(vaultIndex: Int, login: IdentityLogin) -> [AutofillIdentity] {
        guard let passkey = login.passkey, !passkey.rpID.isEmpty,
              let credentialID = Data(base64URL: passkey.credentialID), !credentialID.isEmpty,
              let userHandle = Data(base64URL: passkey.userHandle)
        else { return [] }
        return [AutofillIdentity(
            kind: .passkey,
            recordIdentifier: "\(vaultIndex):\(login.id)",
            domain: passkey.rpID.lowercased(),
            user: passkey.userName,
            credentialID: credentialID,
            userHandle: userHandle
        )]
    }

    /// The narrowest domain every page the rule matches shares.
    private static func identityDomain(_ rule: CredentialURLRule) -> String? {
        guard let url = CredentialURLMatching.normalize(rule.url) else { return nil }
        let hostname = CredentialURLMatching.normalizedHostname(url)
        let labels = hostname.split(separator: ".", omittingEmptySubsequences: false)
        if rule.matchMode == .wildcard {
            guard CredentialURLMatching.isValid(rule),
                  let last = labels.lastIndex(where: CredentialURLMatching.isWildcardLabel)
            else { return nil }
            return labels[(last + 1)...].joined(separator: ".")
        }
        // psl reads IPv4 addresses as domains such as "1.1".
        if rule.matchMode == .exactHost || hostname.allSatisfy({ $0 == "." || ("0"..."9").contains($0) }) {
            return hostname
        }
        return PublicSuffix.registrableDomain(hostname) ?? hostname
    }
}
