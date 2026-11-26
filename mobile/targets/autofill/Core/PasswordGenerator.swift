import Foundation

/// Port of mobile/src/utils/password-generation.ts. Both read
/// AutofillCoreTests/Fixtures/generator-vectors.json in their tests, so
/// change them together.
enum PasswordGenerator {
    enum Kind: String, Decodable {
        case random
        case memorable
    }

    enum Separator: String, Decodable {
        case space
        case dash
        case underscore
        case none
    }

    /// The generator dialog's starting options.
    struct Options: Equatable {
        var kind = Kind.random
        var length = 16
        var includeUppercase = true
        var includeLowercase = true
        var includeNumbers = true
        var includeSymbols = false
        var wordSeparator = Separator.space
    }

    private static let lowercase = Array("abcdefghijklmnopqrstuvwxyz")
    private static let uppercase = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZ")
    private static let numbers = Array("0123456789")
    private static let symbols = Array("!@#$%^&*()_+-=[]{}|;:,.<>?")
    private static let words = bip39EnglishWords.split(separator: "\n")

    /// A rejected draw maps nowhere, so every index has the same input count.
    static func randomIndex(_ count: Int, draw: () -> UInt32) -> Int {
        let space = UInt64(1) << 32
        let limit = space / UInt64(count) * UInt64(count)
        while true {
            let value = UInt64(draw())
            if value < limit { return Int(value % UInt64(count)) }
        }
    }

    /// Rejection of whole strings makes every password with all enabled
    /// classes equally likely. Empty without a class or with a length shorter
    /// than the classes.
    static func randomPassword(_ options: Options, draw: () -> UInt32) -> String {
        let classes = [
            options.includeLowercase ? lowercase : nil,
            options.includeUppercase ? uppercase : nil,
            options.includeNumbers ? numbers : nil,
            options.includeSymbols ? symbols : nil,
        ].compactMap { $0 }
        guard !classes.isEmpty, options.length >= classes.count else { return "" }
        let alphabet = classes.flatMap { $0 }
        while true {
            let password = (0..<options.length).map { _ in alphabet[randomIndex(alphabet.count, draw: draw)] }
            if classes.allSatisfy({ characters in password.contains { characters.contains($0) } }) {
                return String(password)
            }
        }
    }

    static func memorablePassphrase(_ options: Options, draw: () -> UInt32) -> String {
        let chosen = (0..<options.length).map { _ in
            var word = String(words[randomIndex(words.count, draw: draw)])
            if options.includeUppercase, randomIndex(2, draw: draw) == 1 {
                word = word.prefix(1).uppercased() + word.dropFirst()
            }
            if options.includeNumbers, randomIndex(10, draw: draw) > 6 {
                word += String(randomIndex(10, draw: draw))
            }
            return word
        }
        switch options.wordSeparator {
        case .space: return chosen.joined(separator: " ")
        case .dash: return chosen.joined(separator: "-")
        case .underscore: return chosen.joined(separator: "_")
        case .none: return chosen.joined()
        }
    }

    /// SystemRandomNumberGenerator is cryptographically secure on Apple platforms.
    static func generate(_ options: Options, draw: () -> UInt32 = { UInt32.random(in: .min ... .max) }) -> String {
        options.kind == .random ? randomPassword(options, draw: draw) : memorablePassphrase(options, draw: draw)
    }
}
