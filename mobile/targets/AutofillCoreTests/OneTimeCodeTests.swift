import Foundation
import Testing
@testable import AutofillCore

/// The vectors vault-core's calculateTOTP and parseTOTPURI tests also run.
private struct TOTPVectors: Decodable {
    struct CodeCase: Decodable, CustomTestStringConvertible {
        struct Config: Decodable {
            let Secret: String
            let Algorithm: Int
            let Digits: Int32
            let Period: Int32
        }

        let name: String
        let totp: Config
        let timestamp: Double
        let expected: String?
        var testDescription: String { name }
    }

    struct URICase: Decodable, CustomTestStringConvertible {
        let uri: String
        let expected: InboxCredential.TOTP?
        var testDescription: String { uri }
    }

    let totp: [CodeCase]
    let uris: [URICase]

    static let shared: TOTPVectors = {
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent("../../../packages/vault-core/src/tests/fixtures/totp-vectors.json")
        return try! JSONDecoder().decode(TOTPVectors.self, from: Data(contentsOf: url))
    }()
}

@Test(arguments: TOTPVectors.shared.totp)
private func generatesCodesLikeCalculateTOTP(_ vector: TOTPVectors.CodeCase) {
    var totp = VaultUtilTypes_TOTP()
    totp.secret = vector.totp.Secret
    totp.algorithm = .init(rawValue: vector.totp.Algorithm)!
    totp.digits = vector.totp.Digits
    totp.period = vector.totp.Period
    #expect(OneTimeCode.code(for: totp, at: Date(timeIntervalSince1970: vector.timestamp)) == vector.expected)
}

@Test(arguments: TOTPVectors.shared.uris)
private func parsesLinksLikeParseTOTPURI(_ vector: TOTPVectors.URICase) {
    #expect(OneTimeCode.parseURI(vector.uri) == vector.expected)
}
