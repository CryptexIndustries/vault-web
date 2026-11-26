import CryptoKit
import Foundation
import Testing
@testable import AutofillCore

/// A passkey as mobile/src/utils/android-passkeys.ts stores it, with WebCrypto's JWK export.
private func appPasskey() -> VaultUtilTypes_PasskeyData {
    var passkey = VaultUtilTypes_PasskeyData()
    passkey.credentialID = "AQIDBA"
    passkey.rpid = "example.com"
    passkey.userHandle = "dXNlcg"
    passkey.userName = "pat"
    passkey.privateKey = #"{"key_ops":["sign"],"ext":true,"kty":"EC","x":"45hySFgs3R4nms9EG2yziwTR96cIysJZBoygarxH38k","y":"kNz-hJfirJJ4Rj_4Att-Mk0PhN9_y3N17eRD8CKmtb8","crv":"P-256","d":"8Fwnhoy-E_FkOufNfyMaxyvQZ48NrMWuEDLtbrM17wU"}"#
    passkey.algorithm = -7
    return passkey
}

private let appPublicKey = Data([0x04])
    + Data(base64URL: "45hySFgs3R4nms9EG2yziwTR96cIysJZBoygarxH38k")!
    + Data(base64URL: "kNz-hJfirJJ4Rj_4Att-Mk0PhN9_y3N17eRD8CKmtb8")!

private let clientDataHash = Data(SHA256.hash(data: Data("client data".utf8)))

@Test func signsWithTheAppsPasskeys() throws {
    let assertion = try Passkeys.assert(appPasskey(), rpID: "Example.com", clientDataHash: clientDataHash)
    #expect(assertion.credentialID == Data([1, 2, 3, 4]))
    #expect(assertion.userHandle == Data("user".utf8))
    // The RP ID hash, user present and verified, backup eligible and backed up, and a zero counter.
    #expect(assertion.authenticatorData == Data(SHA256.hash(data: Data("Example.com".utf8))) + Data([0x1D, 0, 0, 0, 0]))
    let key = try P256.Signing.PublicKey(x963Representation: appPublicKey)
    let signature = try P256.Signing.ECDSASignature(derRepresentation: assertion.signature)
    #expect(key.isValidSignature(signature, for: assertion.authenticatorData + clientDataHash))
}

@Test func refusesAnotherWebsiteOrAlgorithm() {
    #expect(throws: PasskeyError.invalidPasskey) {
        try Passkeys.assert(appPasskey(), rpID: "example.org", clientDataHash: clientDataHash)
    }
    var rs256 = appPasskey()
    rs256.algorithm = -257
    #expect(throws: PasskeyError.invalidPasskey) {
        try Passkeys.assert(rs256, rpID: "example.com", clientDataHash: clientDataHash)
    }
    #expect(throws: PasskeyError.invalidRequest) {
        try Passkeys.assert(appPasskey(), rpID: "example.com", clientDataHash: Data([1]))
    }
}

@Test func createsPasskeysTheAppCanUse() throws {
    let created = try Passkeys.register(rpID: "Example.com", userName: "pat", userHandle: Data("user".utf8))
    #expect(created.passkey.rpID == "example.com")
    #expect(created.passkey.userHandle == "dXNlcg")
    #expect(created.credentialID.count == 32)
    #expect(Data(base64URL: created.passkey.credentialID) == created.credentialID)

    let object = created.attestationObject
    // {"fmt": "none", "attStmt": {}, "authData": <164 bytes>} in CBOR.
    let header = Data([
        0xA3, 0x63, 0x66, 0x6D, 0x74, 0x64, 0x6E, 0x6F, 0x6E, 0x65, 0x67, 0x61, 0x74, 0x74, 0x53, 0x74, 0x6D, 0x74,
        0xA0, 0x68, 0x61, 0x75, 0x74, 0x68, 0x44, 0x61, 0x74, 0x61, 0x58, 0xA4,
    ])
    #expect(object.prefix(header.count) == header)
    let authData = object.dropFirst(header.count)
    #expect(authData.count == 164)
    #expect(authData.prefix(32) == Data(SHA256.hash(data: Data("example.com".utf8))))
    #expect(Array(authData.dropFirst(32).prefix(5)) == [0x5D, 0, 0, 0, 0])
    #expect(authData.dropFirst(55).prefix(32) == created.credentialID)

    // The stored key signs, and its public half is the attested one.
    var stored = VaultUtilTypes_PasskeyData()
    stored.credentialID = created.passkey.credentialID
    stored.rpid = created.passkey.rpID
    stored.userHandle = created.passkey.userHandle
    stored.privateKey = created.passkey.privateKey
    stored.algorithm = Int32(created.passkey.algorithm)
    let assertion = try Passkeys.assert(stored, rpID: "example.com", clientDataHash: clientDataHash)
    let cose = authData.suffix(77)
    let key = try P256.Signing.PublicKey(x963Representation: Data([0x04]) + cose.dropFirst(10).prefix(32) + cose.suffix(32))
    let signature = try P256.Signing.ECDSASignature(derRepresentation: assertion.signature)
    #expect(key.isValidSignature(signature, for: assertion.authenticatorData + clientDataHash))
    #expect(!created.passkey.publicKey.contains("\"d\""))
}

@Test func refusesAMissingOrLongUserHandle() {
    for handle in [Data(), Data(count: 65)] {
        #expect(throws: PasskeyError.invalidRequest) {
            try Passkeys.register(rpID: "example.com", userName: "pat", userHandle: handle)
        }
    }
}

@Test func findsTheWebsitesAllowedPasskeys() {
    func login(_ id: String, rpID: String) -> AutofillLogin {
        var passkey = VaultUtilTypes_PasskeyData()
        passkey.credentialID = id
        passkey.rpid = rpID
        return AutofillLogin(id: id, name: rpID, username: "", password: "", totp: nil, passkey: passkey, rules: [])
    }
    let logins = [
        login("a", rpID: "example.com"),
        login("b", rpID: "Example.com"),
        login("c", rpID: "example.org"),
        AutofillLogin(id: "d", name: "example.com", username: "", password: "x", totp: nil, rules: []),
    ]
    #expect(AutofillLogins.passkeys(logins, rpID: "example.com", allowed: []).map(\.id) == ["a", "b"])
    #expect(AutofillLogins.passkeys(logins, rpID: "example.com", allowed: ["b", "c"]).map(\.id) == ["b"])
}

@Test func registersPasskeysWithIOS() {
    let passkey = IdentityPasskey(credentialID: "AQIDBA", rpID: "Example.com", userHandle: "dXNlcg", userName: "pat")
    let login = IdentityLogin(id: "p", name: "Example", username: "pat", hasPassword: false, hasTotp: false, passkey: passkey, rules: [])
    #expect(AutofillIdentities.build(vaultIndex: 2, logins: [login]) == [AutofillIdentity(
        kind: .passkey,
        recordIdentifier: "2:p",
        domain: "example.com",
        user: "pat",
        credentialID: Data([1, 2, 3, 4]),
        userHandle: Data("user".utf8)
    )])
}
