import CryptoKit
import Foundation

/// Port of vault-core's calculateTOTP and parseTOTPURI, which use otpauth's
/// TOTP.generate and URI.parse. Both read
/// packages/vault-core/src/tests/fixtures/totp-vectors.json in their tests, so
/// change them together.
enum OneTimeCode {
    private static let alphabet = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZ234567")

    /// Nil for a secret that isn't base32, a period otpauth can't turn into a
    /// code, or a digit count no authenticator uses.
    static func code(for totp: VaultUtilTypes_TOTP, at date: Date = Date()) -> String? {
        guard (1...64).contains(totp.digits), totp.period > 0,
              var secret = base32Decode(totp.secret)
        else { return nil }
        let key = SymmetricKey(data: secret)
        VaultDecryption.wipe(&secret)
        let counter = UInt64(max(0, (date.timeIntervalSince1970 / Double(totp.period)).rounded(.down)))
        let message = withUnsafeBytes(of: counter.bigEndian) { Data($0) }
        let digest: [UInt8]
        switch totp.algorithm {
        case .sha256: digest = Array(HMAC<SHA256>.authenticationCode(for: message, using: key))
        case .sha512: digest = Array(HMAC<SHA512>.authenticationCode(for: message, using: key))
        // An unknown algorithm reads as SHA-1, otpauth's default.
        default: digest = Array(HMAC<Insecure.SHA1>.authenticationCode(for: message, using: key))
        }
        let offset = Int(digest[digest.count - 1] & 0x0F)
        let binary = UInt64(digest[offset] & 0x7F) << 24 | UInt64(digest[offset + 1]) << 16
            | UInt64(digest[offset + 2]) << 8 | UInt64(digest[offset + 3])
        // The 31-bit value has at most 10 digits; otpauth pads longer codes with zeros.
        let modulus = (0..<min(totp.digits, 10)).reduce(UInt64(1)) { value, _ in value * 10 }
        let code = String(binary % modulus)
        return String(repeating: "0", count: max(0, Int(totp.digits) - code.count)) + code
    }

    private static let uriPattern = try! NSRegularExpression(
        pattern: "^otpauth://([ht]otp)/(.+)\\?([A-Z0-9.~_-]+=[^?&]*(?:&[A-Z0-9.~_-]+=[^?&]*)*)$",
        options: .caseInsensitive
    )
    private static let issuerPattern = try! NSRegularExpression(pattern: "(?::|%3A) *(.+)", options: .caseInsensitive)
    private static let positiveInteger = "^\\+?[1-9][0-9]*$"

    /// parseTOTPURI: the authenticator an otpauth://totp link sets up, with
    /// the issuer in the label. Nil for anything else.
    static func parseURI(_ uri: String) -> InboxCredential.TOTP? {
        let range = NSRange(uri.startIndex..., in: uri)
        guard let match = uriPattern.firstMatch(in: uri, range: range),
              let type = Range(match.range(at: 1), in: uri).map({ uri[$0].lowercased() }), type == "totp",
              let rawLabel = Range(match.range(at: 2), in: uri).map({ String(uri[$0]) }),
              let rawParams = Range(match.range(at: 3), in: uri).map({ uri[$0] })
        else { return nil }

        var params: [String: String] = [:]
        for pair in rawParams.split(separator: "&", omittingEmptySubsequences: false) {
            let parts = pair.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
            guard let key = parts[0].removingPercentEncoding,
                  let value = (parts.count > 1 ? parts[1] : "").removingPercentEncoding
            else { return nil }
            params[key.lowercased()] = value
        }

        var issuer = params["issuer"] ?? ""
        let label: String
        let labelRange = NSRange(rawLabel.startIndex..., in: rawLabel)
        if let split = issuerPattern.firstMatch(in: rawLabel, range: labelRange),
           let before = Range(NSRange(location: 0, length: split.range.location), in: rawLabel),
           let after = Range(split.range(at: 1), in: rawLabel) {
            guard let prefix = rawLabel[before].removingPercentEncoding,
                  let name = rawLabel[after].removingPercentEncoding
            else { return nil }
            label = name
            if issuer.isEmpty { issuer = prefix }
        } else {
            guard let name = rawLabel.removingPercentEncoding else { return nil }
            label = name
        }

        func positive(_ key: String, default value: Int) -> Int? {
            guard let raw = params[key] else { return value }
            guard raw.range(of: positiveInteger, options: .regularExpression) != nil else { return nil }
            // parseInt of a long number loses precision rather than failing.
            return Int(raw.drop { $0 == "+" }) ?? Int.max
        }
        guard let period = positive("period", default: 30),
              let digits = positive("digits", default: 6),
              let secret = params["secret"],
              secret.range(of: "^[2-7A-Z]+=*$", options: [.regularExpression, .caseInsensitive]) != nil,
              let bytes = base32Decode(secret)
        else { return nil }

        // otpauth keeps only the algorithms the vault can store; others read as SHA-1.
        var algorithm = 0
        if let name = params["algorithm"] {
            guard name.range(of: "^SHA(?:1|224|256|384|512|3-224|3-256|3-384|3-512)$", options: [.regularExpression, .caseInsensitive]) != nil
            else { return nil }
            algorithm = ["SHA256": 1, "SHA512": 2][name.uppercased()] ?? 0
        }
        return InboxCredential.TOTP(
            label: issuer.isEmpty ? label : "\(issuer):\(label)",
            secret: base32Encode(bytes),
            period: period,
            digits: digits,
            algorithm: algorithm
        )
    }

    private static func base32Encode(_ bytes: Data) -> String {
        var output = ""
        var value: UInt32 = 0
        var bits = 0
        for byte in bytes {
            value = (value << 8 | UInt32(byte)) & 0xFFFF
            bits += 8
            while bits >= 5 {
                bits -= 5
                output.append(alphabet[Int(value >> UInt32(bits) & 31)])
            }
        }
        if bits > 0 { output.append(alphabet[Int(value << UInt32(5 - bits) & 31)]) }
        return output
    }

    /// otpauth's base32Decode: spaces and trailing padding are ignored, case
    /// doesn't matter, and leftover bits are dropped.
    private static func base32Decode(_ input: String) -> Data? {
        var text = input.replacingOccurrences(of: " ", with: "")
        while text.hasSuffix("=") { text.removeLast() }
        var output = Data()
        var value: UInt32 = 0
        var bits = 0
        for character in text.uppercased() {
            guard let index = alphabet.firstIndex(of: character) else { return nil }
            value = (value << 5 | UInt32(index)) & 0xFFFF
            bits += 5
            if bits >= 8 {
                bits -= 8
                output.append(UInt8(truncatingIfNeeded: value >> UInt32(bits)))
            }
        }
        return output
    }
}
