import Foundation

/// The parts of a WHATWG `new URL()` result that credential URL matching reads,
/// for http and https only.
struct WebURL: Equatable {
    let scheme: String
    let hostname: String
    /// Nil for no port or the scheme's default port, as `URL.port` is "".
    let port: Int?
    let pathname: String

    /// The WHATWG basic URL parser, reduced to http(s) URLs without a base.
    init?(_ input: String) {
        var scalars = Array(input.unicodeScalars)
        while let first = scalars.first, first.value <= 0x20 { scalars.removeFirst() }
        while let last = scalars.last, last.value <= 0x20 { scalars.removeLast() }
        scalars.removeAll { $0 == "\t" || $0 == "\n" || $0 == "\r" }
        guard let colon = scalars.firstIndex(of: ":"), colon > 0,
              Self.isASCIIAlpha(scalars[0]),
              scalars[1..<colon].allSatisfy({ Self.isASCIIAlphanumeric($0) || "+-.".unicodeScalars.contains($0) })
        else { return nil }
        let scheme = String(String.UnicodeScalarView(scalars[..<colon])).lowercased()
        guard scheme == "http" || scheme == "https" else { return nil }

        var rest = scalars[(colon + 1)...].drop { $0 == "/" || $0 == "\\" }
        let authorityEnd = rest.firstIndex { "/\\?#".unicodeScalars.contains($0) } ?? rest.endIndex
        var hostAndPort = rest[..<authorityEnd]
        rest = rest[authorityEnd...]
        if let at = hostAndPort.lastIndex(of: "@") {
            hostAndPort = hostAndPort[(at + 1)...]
        }
        guard !hostAndPort.isEmpty else { return nil }

        let hostname: String
        var portText = hostAndPort[hostAndPort.endIndex...]
        if hostAndPort.first == "[" {
            guard let close = hostAndPort.firstIndex(of: "]"),
                  let address = Self.parseIPv6(hostAndPort[(hostAndPort.startIndex + 1)..<close])
            else { return nil }
            let rest = hostAndPort[(close + 1)...]
            guard rest.isEmpty || rest.first == ":" else { return nil }
            portText = rest.dropFirst()
            hostname = "[\(address)]"
        } else {
            if let portColon = hostAndPort.firstIndex(of: ":") {
                portText = hostAndPort[(portColon + 1)...]
                hostAndPort = hostAndPort[..<portColon]
            }
            guard !hostAndPort.isEmpty,
                  let host = Self.parseHost(String(String.UnicodeScalarView(hostAndPort)))
            else { return nil }
            hostname = host
        }
        var port: Int?
        if !portText.isEmpty {
            var value = 0
            for scalar in portText {
                guard ("0"..."9").contains(scalar), value <= 65535 else { return nil }
                value = value * 10 + Int(scalar.value - 48)
            }
            guard value <= 65535 else { return nil }
            port = value == (scheme == "https" ? 443 : 80) ? nil : value
        }

        self.scheme = scheme
        self.hostname = hostname
        self.port = port
        self.pathname = Self.parsePath(rest.prefix { $0 != "?" && $0 != "#" })
    }

    private static func isASCIIAlpha(_ scalar: Unicode.Scalar) -> Bool {
        ("a"..."z").contains(scalar) || ("A"..."Z").contains(scalar)
    }

    private static func isASCIIAlphanumeric(_ scalar: Unicode.Scalar) -> Bool {
        isASCIIAlpha(scalar) || ("0"..."9").contains(scalar)
    }

    // MARK: Host

    private static let forbiddenDomainScalars = Set(" #%/:<>?@[\\]^|".unicodeScalars)

    private static func parseHost(_ input: String) -> String? {
        guard let decoded = String(bytes: percentDecode(input), encoding: .utf8),
              let ascii = domainToASCII(decoded), !ascii.isEmpty,
              !ascii.unicodeScalars.contains(where: {
                  $0.value < 0x20 || $0.value == 0x7F || forbiddenDomainScalars.contains($0)
              })
        else { return nil }
        return endsInANumber(ascii) ? parseIPv4(ascii) : ascii
    }

    private static func percentDecode(_ input: String) -> [UInt8] {
        let bytes = Array(input.utf8)
        var output: [UInt8] = []
        var index = 0
        while index < bytes.count {
            if bytes[index] == UInt8(ascii: "%"), index + 2 < bytes.count,
               let value = UInt8(String(decoding: bytes[(index + 1)...(index + 2)], as: UTF8.self), radix: 16) {
                output.append(value)
                index += 3
            } else {
                output.append(bytes[index])
                index += 1
            }
        }
        return output
    }

    /// UTS #46 ToASCII as browsers apply it. Foundation's URL does the same
    /// nontransitional processing from iOS 18, where it agrees with Node on the
    /// shared vectors. Earlier versions and anything Foundation can't convert
    /// fail, so such a login never matches a look-alike domain.
    private static func domainToASCII(_ domain: String) -> String? {
        if domain.unicodeScalars.allSatisfy(\.isASCII) { return domain.lowercased() }
        guard #available(iOS 18, macOS 15, *) else { return nil }
        var components = URLComponents()
        components.host = domain
        // Foundation percent-encodes what IDNA rejects.
        guard let ascii = components.encodedHost,
              ascii.unicodeScalars.allSatisfy({ $0.isASCII && $0 != "%" })
        else { return nil }
        return ascii
    }

    // MARK: IPv4

    private static func endsInANumber(_ host: String) -> Bool {
        var parts = host.split(separator: ".", omittingEmptySubsequences: false)
        if parts.last == "" {
            if parts.count == 1 { return false }
            parts.removeLast()
        }
        guard let last = parts.last else { return false }
        return (!last.isEmpty && last.allSatisfy { ("0"..."9").contains($0) }) || parseIPv4Number(last) != nil
    }

    private static func parseIPv4Number(_ input: Substring) -> UInt64? {
        guard !input.isEmpty else { return nil }
        var digits = input
        var radix = 10
        if digits.hasPrefix("0x") || digits.hasPrefix("0X") {
            digits = digits.dropFirst(2)
            radix = 16
        } else if digits.count > 1, digits.hasPrefix("0") {
            digits = digits.dropFirst()
            radix = 8
        }
        if digits.isEmpty { return 0 }
        guard digits.allSatisfy(\.isASCII) else { return nil }
        // Anything past 2^32 fails the range checks below, so cap the value there.
        var value: UInt64 = 0
        for character in digits {
            guard let digit = character.hexDigitValue, digit < radix else { return nil }
            value = min(value * UInt64(radix) + UInt64(digit), UInt64(1) << 33)
        }
        return value
    }

    private static func parseIPv4(_ host: String) -> String? {
        var parts = host.split(separator: ".", omittingEmptySubsequences: false)
        if parts.last == "", parts.count > 1 { parts.removeLast() }
        guard parts.count <= 4 else { return nil }
        let values = parts.compactMap(parseIPv4Number)
        guard values.count == parts.count,
              values.dropLast().allSatisfy({ $0 <= 255 }),
              let last = values.last, last < UInt64(1) << (8 * (5 - values.count))
        else { return nil }
        var address = last
        for (index, value) in values.dropLast().enumerated() {
            address += value << (8 * (3 - index))
        }
        return (0..<4).map { String((address >> (8 * (3 - $0))) & 0xFF) }.joined(separator: ".")
    }

    // MARK: IPv6

    /// The WHATWG IPv6 parser, for the text between the brackets, and its
    /// serializer.
    private static func parseIPv6(_ text: ArraySlice<Unicode.Scalar>) -> String? {
        let input = Array(text)
        let at = { (index: Int) in index < input.count ? input[index] : nil }
        var address = [Int](repeating: 0, count: 8)
        var pieceIndex = 0
        var compress: Int?
        var pointer = 0
        if at(0) == ":" {
            guard at(1) == ":" else { return nil }
            pointer = 2
            pieceIndex = 1
            compress = 1
        }
        while at(pointer) != nil {
            guard pieceIndex < 8 else { return nil }
            if at(pointer) == ":" {
                guard compress == nil else { return nil }
                pointer += 1
                pieceIndex += 1
                compress = pieceIndex
                continue
            }
            var value = 0
            var length = 0
            while length < 4, let digit = at(pointer).flatMap({ asciiDigit($0, radix: 16) }) {
                value = value * 16 + digit
                pointer += 1
                length += 1
            }
            if at(pointer) == "." {
                // An embedded IPv4 address fills the last two pieces.
                guard length > 0, pieceIndex <= 6 else { return nil }
                pointer -= length
                var numbersSeen = 0
                while at(pointer) != nil {
                    if numbersSeen > 0 {
                        guard at(pointer) == ".", numbersSeen < 4 else { return nil }
                        pointer += 1
                    }
                    var number: Int?
                    while let digit = at(pointer).flatMap({ asciiDigit($0, radix: 10) }) {
                        guard number != 0 else { return nil }
                        number = (number ?? 0) * 10 + digit
                        guard number! <= 255 else { return nil }
                        pointer += 1
                    }
                    guard let number else { return nil }
                    address[pieceIndex] = address[pieceIndex] * 0x100 + number
                    numbersSeen += 1
                    if numbersSeen == 2 || numbersSeen == 4 { pieceIndex += 1 }
                }
                guard numbersSeen == 4 else { return nil }
                break
            }
            if at(pointer) == ":" {
                pointer += 1
                guard at(pointer) != nil else { return nil }
            } else if at(pointer) != nil {
                return nil
            }
            address[pieceIndex] = value
            pieceIndex += 1
        }
        if let compress {
            var swaps = pieceIndex - compress
            pieceIndex = 7
            while pieceIndex != 0, swaps > 0 {
                address.swapAt(pieceIndex, compress + swaps - 1)
                pieceIndex -= 1
                swaps -= 1
            }
        } else if pieceIndex != 8 {
            return nil
        }

        // The first longest run of two or more zero pieces becomes "::".
        var zeros = 0..<0
        var start = 0
        while start < 8 {
            var end = start
            while end < 8, address[end] == 0 { end += 1 }
            if end - start > max(1, zeros.count) { zeros = start..<end }
            start = end + 1
        }
        var output = ""
        for index in 0..<8 {
            if zeros.contains(index) {
                if index == zeros.lowerBound { output += index == 0 ? "::" : ":" }
                continue
            }
            output += String(address[index], radix: 16)
            if index < 7 { output += ":" }
        }
        return output
    }

    private static func asciiDigit(_ scalar: Unicode.Scalar, radix: Int) -> Int? {
        guard scalar.isASCII, let value = Character(scalar).hexDigitValue, value < radix else { return nil }
        return value
    }

    // MARK: Path

    private static func parsePath(_ path: ArraySlice<Unicode.Scalar>) -> String {
        guard !path.isEmpty else { return "/" }
        let tokens = path.dropFirst().split(omittingEmptySubsequences: false) { $0 == "/" || $0 == "\\" }
        var segments: [String] = []
        for (index, token) in tokens.enumerated() {
            let segment = String(String.UnicodeScalarView(token))
            let lowered = segment.lowercased()
            let isLast = index == tokens.count - 1
            if ["..", ".%2e", "%2e.", "%2e%2e"].contains(lowered) {
                if !segments.isEmpty { segments.removeLast() }
                if isLast { segments.append("") }
            } else if lowered == "." || lowered == "%2e" {
                if isLast { segments.append("") }
            } else {
                segments.append(percentEncodePath(segment))
            }
        }
        return "/" + segments.joined(separator: "/")
    }

    private static func percentEncodePath(_ segment: String) -> String {
        var output = ""
        for scalar in segment.unicodeScalars {
            if scalar.value > 0x20, scalar.value < 0x7F, !"\"<>`{}".unicodeScalars.contains(scalar) {
                output.unicodeScalars.append(scalar)
            } else {
                for byte in String(scalar).utf8 { output += String(format: "%%%02X", byte) }
            }
        }
        return output
    }
}
