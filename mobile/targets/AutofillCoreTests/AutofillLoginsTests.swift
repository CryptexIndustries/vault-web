import Testing
@testable import AutofillCore

@Test func vaultChoice() {
    #expect(VaultChoice.resolve(enabled: [], lastChoice: 2) == .none)
    #expect(VaultChoice.resolve(enabled: [3], lastChoice: nil) == .open(3))
    #expect(VaultChoice.resolve(enabled: [3], lastChoice: 1) == .open(3))
    #expect(VaultChoice.resolve(enabled: [1, 2, 3], lastChoice: nil) == .ask([1, 2, 3]))
    #expect(VaultChoice.resolve(enabled: [1, 2, 3], lastChoice: 2) == .ask([2, 1, 3]))
    #expect(VaultChoice.resolve(enabled: [1, 2, 3], lastChoice: 9) == .ask([1, 2, 3]))
}

@Test func recordIdentifiers() {
    #expect(AutofillLogins.parseRecordIdentifier("12:01J:ABC")! == (12, "01J:ABC"))
    #expect(AutofillLogins.parseRecordIdentifier("0:id") == nil)
    #expect(AutofillLogins.parseRecordIdentifier("x:id") == nil)
    #expect(AutofillLogins.parseRecordIdentifier("3:") == nil)
    #expect(AutofillLogins.parseRecordIdentifier("3") == nil)
}

private func login(_ id: String, _ url: String, _ mode: CredentialURLMatchMode = .exactHost) -> AutofillLogin {
    AutofillLogin(id: id, name: id, username: "\(id)-user", password: "", totp: nil, rules: [CredentialURLRule(url: url, matchMode: mode)])
}

@Test func ranksMatchesForTheRequest() {
    let logins = [
        login("domain", "example.com", .domain),
        login("other", "other.test"),
        login("exact", "https://login.example.com"),
        login("port", "login.example.com:8443"),
    ]
    #expect(AutofillLogins.matching(logins, targets: [.url("https://login.example.com/sign-in")]).map(\.id) == ["exact", "domain"])
    // A domain from an app's associated domains carries no port.
    #expect(AutofillLogins.matching(logins, targets: [.domain("login.example.com")]).map(\.id) == ["exact", "port", "domain"])
    #expect(AutofillLogins.matching(logins, targets: []).isEmpty)
}

@Test func searchesNamesUsernamesAndURLs() {
    let logins = [login("Bank", "bank.example"), login("Mail", "mail.test")]
    #expect(AutofillLogins.search(logins, query: "  ").map(\.id) == ["Bank", "Mail"])
    #expect(AutofillLogins.search(logins, query: "BÄNK").map(\.id) == ["Bank"])
    #expect(AutofillLogins.search(logins, query: "mail-user").map(\.id) == ["Mail"])
    #expect(AutofillLogins.search(logins, query: "mail.test").map(\.id) == ["Mail"])
}

@Test func offersOneTimeCodesFromLoginsWithASecret() {
    var vault = VaultUtilTypes_Vault()
    vault.credentials = [("code", "SECRET", false), ("empty", "", false), ("deleted", "SECRET", true)].map { id, secret, deleted in
        var credential = VaultUtilTypes_Credential()
        credential.id = id
        credential.name = id
        credential.totp.secret = secret
        credential.deleted = deleted
        return credential
    }
    #expect(AutofillLogins.candidates(in: vault, for: .oneTimeCode).map(\.id) == ["code"])
    #expect(AutofillLogins.candidates(in: vault, for: .password).isEmpty)
}
