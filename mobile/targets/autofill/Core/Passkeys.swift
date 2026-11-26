import CryptoKit
import Foundation

enum PasskeyError: Error {
    case invalidRequest
    case invalidPasskey
}

/// WebAuthn for the vault's passkeys, as mobile/src/utils/android-passkeys.ts
/// creates and uses them: ES256 keys stored as JWK, none attestation, the same
/// AAGUID, user presence and verification, backup eligible and backed up, and
/// a counter of zero. iOS always supplies the client data hash.
enum Passkeys {
    static let es256 = -7

    private static let aaguid = Data([
        0xBE, 0xC1, 0x41, 0x8F, 0xA8, 0xC4, 0x4C, 0x38, 0xAC, 0x6F, 0x3E, 0x3E, 0x1F, 0x9A, 0xD0, 0xC0,
    ])

    struct Registration {
        let passkey: InboxCredential.Passkey
        let credentialID: Data
        let attestationObject: Data
    }

    struct Assertion {
        let credentialID: Data
        let userHandle: Data
        let authenticatorData: Data
        /// DER, as WebAuthn expects for ES256.
        let signature: Data
    }

    private struct JWK: Codable {
        var kty = "EC"
        var crv = "P-256"
        let x: String
        let y: String
        var d: String?
    }

    static func register(rpID: String, userName: String, userHandle: Data) throws -> Registration {
        let rpID = rpID.lowercased()
        guard !rpID.isEmpty, (1...64).contains(userHandle.count) else { throw PasskeyError.invalidRequest }
        let key = P256.Signing.PrivateKey()
        let credentialID = Data((0..<32).map { _ in UInt8.random(in: .min ... .max) })
        // x963 is 0x04 followed by the 32-byte x and y coordinates.
        let point = key.publicKey.x963Representation
        let x = point[1...32], y = point[33...64]
        let publicKey = JWK(x: Data(x).base64URLEncodedString, y: Data(y).base64URLEncodedString)
        var privateKey = publicKey
        privateKey.d = key.rawRepresentation.base64URLEncodedString
        // Flags: user present and verified, backup eligible and backed up, and
        // attested credential data. Then a zero counter.
        var authenticatorData = Data(SHA256.hash(data: Data(rpID.utf8)))
        authenticatorData.append(contentsOf: [0x5D, 0, 0, 0, 0])
        authenticatorData.append(aaguid)
        authenticatorData.append(contentsOf: [0, UInt8(credentialID.count)])
        authenticatorData.append(credentialID)
        // Canonical COSE EC2 key: {1: 2, 3: -7, -1: 1, -2: x, -3: y}.
        authenticatorData.append(contentsOf: [0xA5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20])
        authenticatorData.append(x)
        authenticatorData.append(contentsOf: [0x22, 0x58, 0x20])
        authenticatorData.append(y)
        // CBOR {"fmt": "none", "attStmt": {}, "authData": authenticatorData}.
        var attestationObject = Data([0xA3, 0x63])
        attestationObject.append(Data("fmt".utf8))
        attestationObject.append(0x64)
        attestationObject.append(Data("none".utf8))
        attestationObject.append(0x67)
        attestationObject.append(Data("attStmt".utf8))
        attestationObject.append(contentsOf: [0xA0, 0x68])
        attestationObject.append(Data("authData".utf8))
        attestationObject.append(contentsOf: [0x58, UInt8(authenticatorData.count)])
        attestationObject.append(authenticatorData)
        let encoder = JSONEncoder()
        encoder.outputFormatting = .sortedKeys
        return Registration(
            passkey: InboxCredential.Passkey(
                credentialID: credentialID.base64URLEncodedString,
                rpID: rpID,
                userHandle: userHandle.base64URLEncodedString,
                userName: userName,
                publicKey: String(decoding: try encoder.encode(publicKey), as: UTF8.self),
                privateKey: String(decoding: try encoder.encode(privateKey), as: UTF8.self)
            ),
            credentialID: credentialID,
            attestationObject: attestationObject
        )
    }

    static func assert(_ passkey: VaultUtilTypes_PasskeyData, rpID: String, clientDataHash: Data) throws -> Assertion {
        guard passkey.algorithm == es256, passkey.rpid.lowercased() == rpID.lowercased(),
              let credentialID = Data(base64URL: passkey.credentialID), !credentialID.isEmpty,
              let userHandle = Data(base64URL: passkey.userHandle),
              let jwk = try? JSONDecoder().decode(JWK.self, from: Data(passkey.privateKey.utf8)),
              let d = jwk.d.flatMap { Data(base64URL: $0) },
              let key = try? P256.Signing.PrivateKey(rawRepresentation: d)
        else { throw PasskeyError.invalidPasskey }
        guard clientDataHash.count == 32 else { throw PasskeyError.invalidRequest }
        // The registration's flags without attested credential data.
        var authenticatorData = Data(SHA256.hash(data: Data(rpID.utf8)))
        authenticatorData.append(contentsOf: [0x1D, 0, 0, 0, 0])
        let signature = try key.signature(for: authenticatorData + clientDataHash)
        return Assertion(
            credentialID: credentialID,
            userHandle: userHandle,
            authenticatorData: authenticatorData,
            signature: signature.derRepresentation
        )
    }
}
