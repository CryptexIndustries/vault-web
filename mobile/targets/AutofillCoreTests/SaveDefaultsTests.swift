import Foundation
import Testing
@testable import AutofillCore

/// The vectors the app's Android save rules also run (tests/autofill-save-vectors.test.ts).
private struct SaveVectors: Decodable {
    struct Source: Decodable {
        let webDomain: String?
        let webScheme: String?
        let applicationLabel: String?
        let packageName: String?
        let comparesPort: Bool?
        var save: SaveSource {
            SaveSource(
                webDomain: webDomain, webScheme: webScheme, applicationLabel: applicationLabel,
                packageName: packageName, comparesPort: comparesPort ?? false
            )
        }
    }

    struct Default: Decodable, CustomTestStringConvertible {
        let name: String
        let source: Source
        let expectedName: String
        let expectedUrl: String
        var testDescription: String { name }
    }

    struct Login: Decodable {
        let ID: String
        let Username: String
        let Password: String
        let URL: String
        let URLMatchMode: Int
    }

    struct Candidate: Decodable, CustomTestStringConvertible {
        let name: String
        let source: Source
        let username: String
        let expectedIds: [String]
        var testDescription: String { name }
    }

    let defaults: [Default]
    let logins: [Login]
    let candidates: [Candidate]

    static let shared: SaveVectors = {
        let url = Foundation.URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent("Fixtures/save-vectors.json")
        return try! JSONDecoder().decode(SaveVectors.self, from: Data(contentsOf: url))
    }()
}

@Test(arguments: SaveVectors.shared.defaults)
private func namesAndAddressesLikeAndroid(_ vector: SaveVectors.Default) {
    #expect(SaveDefaults.name(vector.source.save, fallback: "New login") == vector.expectedName)
    #expect(SaveDefaults.url(vector.source.save) == vector.expectedUrl)
}

@Test(arguments: SaveVectors.shared.candidates)
private func offersTheLoginsAndroidWouldUpdate(_ vector: SaveVectors.Candidate) {
    let logins = SaveVectors.shared.logins.map {
        AutofillLogin(
            id: $0.ID, name: $0.ID, username: $0.Username, password: $0.Password, totp: nil,
            rules: [CredentialURLRule(url: $0.URL, matchMode: .init(rawValue: $0.URLMatchMode))]
        )
    }
    #expect(SaveDefaults.candidates(logins, source: vector.source.save, username: vector.username).map(\.id) == vector.expectedIds)
}
