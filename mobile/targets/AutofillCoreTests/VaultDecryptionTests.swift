import CryptoKit
import Foundation
import Testing
@testable import AutofillCore

/// Written by targets/scripts/generate.mjs with the app's own vault and
/// biometric enrollment code.
private struct Fixture: Decodable {
    struct Credential: Decodable, Equatable {
        let ID: String
        let Name: String
        let Username: String
        let Password: String
    }

    let storedMetadata: String
    let wrapKeyItem: String
    let wrappedKeyItem: String
    let credentials: [Credential]
    let candidateIDs: [String]

    static let shared: Fixture = {
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("Fixtures/vault.json")
        return try! JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
    }()

    func open(storedMetadata: String? = nil, wrapKeyItem: String? = nil) throws -> VaultUtilTypes_Vault {
        try openWithKey(storedMetadata: storedMetadata, wrapKeyItem: wrapKeyItem).vault
    }

    func openWithKey(storedMetadata: String? = nil, wrapKeyItem: String? = nil) throws -> OpenedVault {
        var wrapKey = Data((wrapKeyItem ?? self.wrapKeyItem).utf8)
        return try VaultDecryption.open(
            storedMetadata: storedMetadata ?? self.storedMetadata,
            wrapKeyItem: &wrapKey,
            wrappedKeyItem: Data(wrappedKeyItem.utf8)
        )
    }
}

@Test func opensTheAppsVault() throws {
    let fixture = Fixture.shared
    let vault = try fixture.open()
    #expect(vault.credentials.map { Fixture.Credential(ID: $0.id, Name: $0.name, Username: $0.username, Password: $0.password) } == fixture.credentials)
    #expect(Set(AutofillLogins.candidates(in: vault, for: .password).map(\.id)) == Set(fixture.candidateIDs))
}

@Test func wipesTheWrapKey() throws {
    var wrapKey = Data(Fixture.shared.wrapKeyItem.utf8)
    _ = try VaultDecryption.open(
        storedMetadata: Fixture.shared.storedMetadata,
        wrapKeyItem: &wrapKey,
        wrappedKeyItem: Data(Fixture.shared.wrappedKeyItem.utf8)
    )
    #expect(wrapKey.allSatisfy { $0 == 0 })
}

@Test func rejectsAnotherWrapKey() {
    let other = SymmetricKey(size: .bits256).withUnsafeBytes { Data($0).base64EncodedString() }
    #expect(throws: VaultDecryptionError.authenticationFailed) { try Fixture.shared.open(wrapKeyItem: other) }
}

@Test func rejectsAChangedVault() throws {
    var bytes = try #require(Data(base64Encoded: Fixture.shared.storedMetadata))
    var metadata = try VaultUtilTypes_VaultMetadata(serializedBytes: bytes)
    metadata.blob.blob[metadata.blob.blob.startIndex] ^= 1
    bytes = try metadata.serializedData()
    #expect(throws: VaultDecryptionError.authenticationFailed) {
        try Fixture.shared.open(storedMetadata: bytes.base64EncodedString())
    }
}

/// The app stored the rotated vault, then stopped before it replaced the Face
/// ID item, so the extension still unwraps the old key.
@Test func aRotatedVaultRejectsTheOldKey() throws {
    let old = try Fixture.shared.openWithKey().key
    var metadata = try VaultUtilTypes_VaultMetadata(serializedBytes: try #require(Data(base64Encoded: Fixture.shared.storedMetadata)))
    let rotated = SymmetricKey(size: .bits256)
    let sealed = try AES.GCM.seal(Data("rotated vault".utf8), using: rotated)
    metadata.blob.headerIv = Data(sealed.nonce).base64EncodedString()
    metadata.blob.blob = sealed.ciphertext + sealed.tag
    let stored = try metadata.serializedData().base64EncodedString()
    #expect(VaultDecryption.keyOpens(storedMetadata: Fixture.shared.storedMetadata, key: old))
    #expect(!VaultDecryption.keyOpens(storedMetadata: stored, key: old))
    #expect(VaultDecryption.keyOpens(storedMetadata: stored, key: rotated))
}

@Test func rejectsMalformedItems() {
    #expect(throws: VaultDecryptionError.malformed) { try Fixture.shared.open(wrapKeyItem: "not base64") }
    #expect(throws: VaultDecryptionError.malformed) { try Fixture.shared.open(storedMetadata: "AAAA") }
}
