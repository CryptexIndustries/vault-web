import Foundation

/// A website's password rules in Apple's format, for example
/// "required: upper; required: digit; allowed: [-_]; minlength: 12;", which
/// iOS passes with a request to generate a password.
struct PasswordRules {
    /// Each needs at least one character of its set.
    var required: [Set<Character>] = []
    var allowed = Set<Character>()
    var minLength: Int?
    var maxLength: Int?
    var maxConsecutive: Int?

    private static let upper = Set("ABCDEFGHIJKLMNOPQRSTUVWXYZ")
    private static let lower = Set("abcdefghijklmnopqrstuvwxyz")
    private static let digit = Set("0123456789")
    /// Apple's special characters without the space, which sites often reject.
    private static let special = Set("-~!@#$%^&*_+=`|(){}[:;\"'<>,.?]")

    /// Repeated limits keep the strictest, as Apple's rules say.
    init(_ text: String) {
        for rule in Self.rules(text) {
            guard let colon = rule.firstIndex(of: ":") else { continue }
            let name = rule[..<colon].trimmingCharacters(in: .whitespaces).lowercased()
            let value = rule[rule.index(after: colon)...].trimmingCharacters(in: .whitespaces)
            switch name {
            case "required": required.append(Self.characters(value))
            case "allowed": allowed.formUnion(Self.characters(value))
            case "minlength": if let value = Int(value) { minLength = max(minLength ?? 0, value) }
            case "maxlength": if let value = Int(value) { maxLength = min(maxLength ?? .max, value) }
            case "max-consecutive": if let value = Int(value) { maxConsecutive = min(maxConsecutive ?? .max, value) }
            default: break
            }
        }
        allowed.formUnion(required.joined())
    }

    /// The rules between semicolons outside [custom] sets.
    private static func rules(_ text: String) -> [String] {
        var rules = [""]
        var inSet = false
        var setStart = false
        for character in text {
            if inSet {
                // "]" can only be a custom set's first character.
                if character == "]", !setStart { inSet = false }
                setStart = false
            } else if character == "[" {
                inSet = true
                setStart = true
            } else if character == ";" {
                rules.append("")
                continue
            }
            rules[rules.count - 1].append(character)
        }
        return rules
    }

    /// The classes and [custom] sets of one rule's value. Unicode is read as
    /// ASCII, which every site that allows Unicode accepts too.
    private static func characters(_ value: String) -> Set<Character> {
        var characters = Set<Character>()
        var rest = Substring(value)
        while let next = rest.first {
            if next == "[" {
                // "]" can only be a custom set's first character.
                let body = rest.dropFirst()
                let end = body.dropFirst().firstIndex(of: "]") ?? body.endIndex
                characters.formUnion(body[..<end].filter { $0.isASCII && ($0 == " " || !$0.isWhitespace) })
                rest = end < body.endIndex ? body[body.index(after: end)...] : ""
                continue
            }
            let name = rest.prefix { $0 != "," && $0 != "[" }
            rest = rest[name.endIndex...].drop { $0 == "," }
            switch name.trimmingCharacters(in: .whitespaces).lowercased() {
            case "upper": characters.formUnion(upper)
            case "lower": characters.formUnion(lower)
            case "digit": characters.formUnion(digit)
            case "special": characters.formUnion(special)
            case "ascii-printable", "unicode": characters.formUnion(upper.union(lower).union(digit).union(special))
            default: break
            }
        }
        return characters
    }

    /// A password that follows the rules, 16 characters unless they say
    /// otherwise, or nil when they can't be met or ask for more than 128.
    func password() -> String? {
        let alphabet = (allowed.isEmpty ? Self.upper.union(Self.lower).union(Self.digit) : allowed).sorted()
        let length = min(max(16, minLength ?? 0), maxLength ?? .max)
        guard (minLength ?? 0) <= (maxLength ?? .max), (max(1, required.count)...128).contains(length),
              !required.contains(where: \.isEmpty)
        else { return nil }
        let draw = { UInt32.random(in: .min ... .max) }
        // Rejection keeps every accepted password equally likely.
        for _ in 0..<1000 {
            let password = (0..<length).map { _ in alphabet[PasswordGenerator.randomIndex(alphabet.count, draw: draw)] }
            if required.allSatisfy({ set in password.contains(where: set.contains) }), hasNoLongRun(password) {
                return String(password)
            }
        }
        return nil
    }

    private func hasNoLongRun(_ password: [Character]) -> Bool {
        guard let maxConsecutive, maxConsecutive > 0 else { return true }
        var run = 0
        for (index, character) in password.enumerated() {
            run = index > 0 && password[index - 1] == character ? run + 1 : 1
            if run > maxConsecutive { return false }
        }
        return true
    }
}
