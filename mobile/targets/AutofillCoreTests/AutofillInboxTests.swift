import CryptoKit
import Foundation
import Testing
@testable import AutofillCore

private let fixtureURL = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
    .appendingPathComponent("Fixtures/inbox.json")

/// Entries the app's merge test (mobile/tests/ios-autofill-inbox.test.ts)
/// decrypts with its own code.
private struct InboxFixture: Codable {
    let key: String
    let vaultIndex: Int
    let entries: [InboxEntry]
}

private func login(_ decision: InboxLogin.Decision, target: String? = nil, username: String, password: String) -> InboxLogin {
    InboxLogin(
        decision: decision,
        targetId: target,
        credential: InboxCredential(name: "example.com", username: username, password: password, url: "https://example.com")
    )
}

private func association(_ target: String, url: String) -> InboxLogin {
    InboxLogin(decision: .associate, targetId: target, credential: InboxCredential(url: url))
}

/// Every field Add login fills.
private let fullLogin = InboxLogin(decision: .new, targetId: nil, credential: InboxCredential(
    name: "Example",
    username: "erin",
    password: "full-password",
    url: "https://example.com",
    urlMatchMode: 1,
    additionalUrls: [.init(url: "https://login.example.org", matchMode: 0)],
    directoryId: "dir-1",
    totp: .init(label: "Example:erin", secret: "JBSWY3DPEHPK3PXP", period: 30, digits: 6, algorithm: 1),
    tags: "work,|.|,personal",
    notes: "A note",
    customFields: [.init(id: "field-1", name: "PIN", type: 1, value: "1234")]
))

/// Writes the fixture: CRYPTEX_WRITE_INBOX_FIXTURE=1 swift test --filter writesTheInboxFixture
@Test(.enabled(if: ProcessInfo.processInfo.environment["CRYPTEX_WRITE_INBOX_FIXTURE"] != nil))
func writesTheInboxFixture() throws {
    let key = SymmetricKey(size: .bits256)
    func seal(_ id: String, _ login: InboxLogin, vault: Int = 3, at milliseconds: Double) throws -> InboxEntry {
        try AutofillInbox.seal(login, id: id, vaultIndex: vault, createdAt: Date(timeIntervalSince1970: milliseconds / 1000), key: key)
    }
    let tampered = try seal("entry-tampered", login(.new, username: "eve", password: "tampered"), at: 4000)
    var ciphertext = Data(base64Encoded: tampered.ciphertext)!
    ciphertext[0] ^= 1
    let fixture = InboxFixture(
        key: key.withUnsafeBytes { Data($0).base64EncodedString() },
        vaultIndex: 3,
        entries: [
            try seal("entry-new", login(.new, username: "alice", password: "s3cret ✓"), at: 1000),
            try seal("entry-update", login(.update, target: "existing", username: "bob", password: "new-password"), at: 2000),
            try seal("entry-update-new", login(.update, target: "entry-new", username: "alice", password: "changed"), at: 3000),
            InboxEntry(id: tampered.id, vaultIndex: 3, createdAt: tampered.createdAt, iv: tampered.iv, ciphertext: ciphertext.base64EncodedString()),
            try seal("entry-missing-target", login(.update, target: "missing", username: "carol", password: "lost"), at: 5000),
            try seal("entry-other-vault", login(.new, username: "dave", password: "elsewhere"), vault: 4, at: 6000),
            try seal("entry-full", fullLogin, at: 7000),
            try seal("entry-associate", association("existing", url: "https://bank.example.com"), at: 8000),
            try seal("entry-associate-missing", association("missing", url: "https://bank.example.com"), at: 9000),
            // The app's CredentialFormSchema refuses a login without a name.
            try seal("entry-invalid", InboxLogin(decision: .new, targetId: nil, credential: InboxCredential(password: "x")), at: 10000),
        ]
    )
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    try encoder.encode(fixture).write(to: fixtureURL)
}

@Test func opensTheFixturesEntries() throws {
    let fixture = try JSONDecoder().decode(InboxFixture.self, from: Data(contentsOf: fixtureURL))
    let key = SymmetricKey(data: Data(base64Encoded: fixture.key)!)
    let opened = fixture.entries.map { entry in (entry.id, Result { try AutofillInbox.open(entry, key: key) }) }
    #expect(try opened.first { $0.0 == "entry-new" }!.1.get() == login(.new, username: "alice", password: "s3cret ✓"))
    #expect(throws: VaultDecryptionError.authenticationFailed) { try opened.first { $0.0 == "entry-tampered" }!.1.get() }
}

@Test func bindsEntriesToTheirVaultAndID() throws {
    let key = SymmetricKey(size: .bits256)
    let saved = login(.new, username: "alice", password: "secret")
    let entry = try AutofillInbox.seal(saved, id: "a", vaultIndex: 1, createdAt: Date(), key: key)
    #expect(try AutofillInbox.open(entry, key: key) == saved)
    #expect(!entry.ciphertext.contains("secret"))
    for moved in [
        InboxEntry(id: "b", vaultIndex: 1, createdAt: entry.createdAt, iv: entry.iv, ciphertext: entry.ciphertext),
        InboxEntry(id: "a", vaultIndex: 2, createdAt: entry.createdAt, iv: entry.iv, ciphertext: entry.ciphertext),
    ] {
        #expect(throws: VaultDecryptionError.authenticationFailed) { try AutofillInbox.open(moved, key: key) }
    }
    #expect(throws: VaultDecryptionError.authenticationFailed) {
        try AutofillInbox.open(entry, key: SymmetricKey(size: .bits256))
    }
}

@Test func showsPendingEntriesInTheLists() {
    let existing = AutofillLogin(id: "existing", name: "Bank", username: "bob", password: "old", totp: nil, rules: [])
    let logins = AutofillInbox.applyPending(
        [
            ("entry-new", login(.new, username: "alice", password: "first")),
            ("entry-update", login(.update, target: "existing", username: "bob", password: "new")),
            ("entry-update-new", login(.update, target: "entry-new", username: "alice", password: "second")),
            ("entry-missing", login(.update, target: "missing", username: "x", password: "y")),
            ("entry-associate", association("existing", url: "https://bank.example.com")),
            ("entry-full", fullLogin),
        ],
        to: [existing]
    )
    #expect(logins.map { [$0.id, $0.name, $0.username, $0.password] } == [
        ["existing", "Bank", "bob", "new"],
        ["entry-new", "example.com", "alice", "second"],
        ["entry-full", "Example", "erin", "full-password"],
    ])
    #expect(logins.allSatisfy { $0.isPending })
    #expect(logins[0].rules == [CredentialURLRule(url: "https://bank.example.com", matchMode: .exactHost)])
    #expect(logins[1].rules == [CredentialURLRule(url: "https://example.com", matchMode: .exactHost)])
    #expect(logins[2].rules == [
        CredentialURLRule(url: "https://example.com", matchMode: .domain),
        CredentialURLRule(url: "https://login.example.org", matchMode: .exactHost),
    ])
    #expect(logins[2].totp?.secret == "JBSWY3DPEHPK3PXP")
    #expect(logins[2].totp?.algorithm == .sha256)
}
