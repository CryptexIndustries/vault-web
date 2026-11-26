import Foundation
import Testing
@testable import AutofillCore

/// The vectors the app's generator also runs (tests/password-generator-vectors.test.ts).
private struct GeneratorVector: Decodable, CustomTestStringConvertible {
    struct Options: Decodable {
        let type: PasswordGenerator.Kind
        let length: Int
        let includeUppercase: Bool
        let includeLowercase: Bool
        let includeNumbers: Bool
        let includeSymbols: Bool
        let wordSeparator: PasswordGenerator.Separator
    }

    let name: String
    let options: Options
    let seed: UInt64
    let prefix: [UInt32]?
    let expected: String
    var testDescription: String { name }

    static let all: [GeneratorVector] = {
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent("Fixtures/generator-vectors.json")
        struct File: Decodable { let vectors: [GeneratorVector] }
        return try! JSONDecoder().decode(File.self, from: Data(contentsOf: url)).vectors
    }()
}

/// The prefix, then xorshift32 from the seed, as the app's test draws.
private func draws(seed: UInt64, prefix: [UInt32]) -> () -> UInt32 {
    var queue = prefix[...]
    let seeded = UInt32(seed * 2_654_435_761 % 4_294_967_296)
    var state = seeded == 0 ? 2_463_534_242 : seeded
    return {
        if let next = queue.popFirst() { return next }
        state ^= state << 13
        state ^= state >> 17
        state ^= state << 5
        return state
    }
}

@Test(arguments: GeneratorVector.all)
private func generatesLikeTheApp(_ vector: GeneratorVector) {
    let options = PasswordGenerator.Options(
        kind: vector.options.type,
        length: vector.options.length,
        includeUppercase: vector.options.includeUppercase,
        includeLowercase: vector.options.includeLowercase,
        includeNumbers: vector.options.includeNumbers,
        includeSymbols: vector.options.includeSymbols,
        wordSeparator: vector.options.wordSeparator
    )
    #expect(PasswordGenerator.generate(options, draw: draws(seed: vector.seed, prefix: vector.prefix ?? [])) == vector.expected)
}
