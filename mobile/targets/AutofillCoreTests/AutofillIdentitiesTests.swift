import Foundation
import SwiftProtobuf
import Testing
@testable import AutofillCore

/// Logins as the setup screen reads them from the vault. The app sends the
/// same fields, minus deleted logins and SSH keys.
private struct IdentityCase: CustomTestStringConvertible {
    let name: String
    let vaultIndex: Int
    let credentials: [VaultUtilTypes_Credential]
    let expected: [AutofillIdentity]
    var testDescription: String { name }

    static let all: [IdentityCase] = {
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent("Fixtures/identity-vectors.json")
        let file = try! JSONSerialization.jsonObject(with: Data(contentsOf: url)) as! [String: Any]
        return (file["cases"] as! [[String: Any]]).map { item in
            IdentityCase(
                name: item["name"] as! String,
                vaultIndex: item["vaultIndex"] as! Int,
                credentials: (item["credentials"] as! [[String: Any]]).map { fields in
                    let json = String(decoding: try! JSONSerialization.data(withJSONObject: fields), as: UTF8.self)
                    return try! VaultUtilTypes_Credential(jsonString: json)
                },
                expected: (item["expected"] as! [[String: String]]).map {
                    AutofillIdentity(
                        kind: .init(rawValue: $0["kind"]!)!,
                        recordIdentifier: $0["recordIdentifier"]!,
                        domain: $0["domain"]!,
                        user: $0["user"]!
                    )
                }
            )
        }
    }()
}

@Test(arguments: IdentityCase.all)
private func buildsTheAppsIdentities(_ vector: IdentityCase) {
    let logins = vector.credentials.compactMap(IdentityLogin.init)
    #expect(AutofillIdentities.build(vaultIndex: vector.vaultIndex, logins: logins) == vector.expected)
}
