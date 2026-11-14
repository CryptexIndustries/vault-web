import Foundation
import Testing
@testable import AutofillCore

@Test func savesTheFormLikeAndroidsEditor() throws {
    var draft = LoginDraft(name: "  Example  ", username: "erin", password: "secret")
    draft.website.url = "https://example.com"
    draft.additionalWebsites = [.init(url: "", matchMode: .domain), .init(url: "login.example.org", matchMode: .domain)]
    draft.authenticator = .init(label: " ", secret: " JBSW Y3DP EHPK3PXP ", period: "", digits: "0", algorithm: 2)
    draft.fields = [.init(name: "PIN", kind: .hidden, value: "1234"), .init(name: "Empty", value: " "), .init(name: " ", value: "orphan")]
    draft.tags = " work, ,personal,"
    let credential = try draft.credential().get()
    #expect(credential.name == "Example")
    #expect(credential.additionalUrls == [.init(url: "", matchMode: 1), .init(url: "login.example.org", matchMode: 1)])
    #expect(credential.totp == .init(label: "Example", secret: "JBSWY3DPEHPK3PXP", period: 30, digits: 6, algorithm: 2))
    #expect(credential.customFields.map(\.name) == ["PIN"])
    #expect(credential.tags == "work,|.|,personal")
    #expect(LoginDraft(name: "x", authenticator: .init(secret: "  ")).credential().map(\.totp) == .success(nil))
}

@Test func refusesWhatTheAppsSchemaRefuses() {
    #expect(LoginDraft(name: " ").credential() == .failure(.nameRequired))
    #expect(LoginDraft(name: String(repeating: "é", count: 256)).credential() == .failure(.nameTooLong))
    #expect(LoginDraft(name: "x", authenticator: .init(label: String(repeating: "a", count: 256), secret: "JBSWY3DPEHPK3PXP")).credential() == .failure(.labelTooLong))
    #expect(LoginDraft(name: "x", website: .init(url: "ftp://example.com")).credential() == .failure(.websiteInvalid))
    #expect(LoginDraft(name: "x", additionalWebsites: [.init(url: "androidapp://com.example.app", matchMode: .domain)]).credential() == .failure(.websiteInvalid))
}

@Test func normalizesSetupKeys() {
    #expect(LoginDraft.setupKey(" jbsw y3dp ") == "JBSWY3DP")
    #expect(LoginDraft.setupKey("JBSWY3D") == nil)
    #expect(LoginDraft.setupKey("JBSWY3D1") == nil)
}

private func login(for url: String) -> AutofillLogin {
    AutofillLogin(id: url, name: url, username: "", password: "x", totp: nil, rules: [CredentialURLRule(url: url, matchMode: .exactHost)])
}

@Test func reviewsFillsLikeAndroid() throws {
    let https = try #require(FillDestination([.url("https://Login.Example.com:8443/sign-in")], fallbackName: "New login"))
    #expect(https.name == "login.example.com:8443")
    #expect(https.url == "https://login.example.com:8443")
    #expect(!https.needsReview(login(for: "https://login.example.com:8443")))
    #expect(!https.canAssociate(login(for: "https://login.example.com:8443")))
    #expect(https.needsReview(login(for: "https://example.com")))
    #expect(https.canAssociate(login(for: "https://example.com")))

    let http = try #require(FillDestination([.url("http://example.com/")], fallbackName: "New login"))
    #expect(http.needsReview(login(for: "http://example.com")))
    #expect(!http.canAssociate(login(for: "https://other.example")))

    // Only the first website counts, as Android's single target.
    let app = try #require(FillDestination([.domain("example.com"), .url("http://other.example")], fallbackName: "New login"))
    #expect(app.url == "https://example.com")
    #expect(app.needsReview(login(for: "http://other.example")))
    #expect(FillDestination([], fallbackName: "New login") == nil)
}
