import Foundation
import Testing
@testable import AutofillCore

/// The vectors vault-core's credential-url tests also run.
private struct Vectors: Decodable {
    struct URLCase: Decodable, CustomTestStringConvertible {
        struct Parts: Decodable, Equatable {
            let hostname: String
            let port: String
            let pathname: String
        }

        let input: String
        let expected: Parts?
        var testDescription: String { input }
    }

    struct DomainCase: Decodable, CustomTestStringConvertible {
        let hostname: String
        let expected: String?
        var testDescription: String { hostname }
    }

    struct MatchCase: Decodable, CustomTestStringConvertible {
        struct Credential: Decodable {
            struct Rule: Decodable {
                let URL: String
                let MatchMode: Int
            }

            let URL: String
            let URLMatchMode: Int
            let AdditionalURLs: [Rule]?
        }

        let name: String
        let credential: Credential
        let pageUrl: String
        let ignorePort: Bool?
        let expected: Int?
        var testDescription: String { name }
    }

    struct RuleCase: Decodable, CustomTestStringConvertible {
        let rule: MatchCase.Credential.Rule
        let expected: Bool
        var testDescription: String { "\(rule.URL) \(rule.MatchMode)" }
    }

    let urls: [URLCase]
    let registrableDomains: [DomainCase]
    let matches: [MatchCase]
    let rules: [RuleCase]

    static let shared: Vectors = {
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent("../../../packages/vault-core/src/tests/fixtures/credential-url-vectors.json")
        return try! JSONDecoder().decode(Vectors.self, from: Data(contentsOf: url))
    }()
}

/// WebURL converts hostnames that aren't ASCII only from macOS 15 and iOS 18,
/// and rejects them before.
private func convertsUnicodeHosts() -> Bool {
    if #available(macOS 15, iOS 18, *) { return true }
    return false
}

private func hasUnicodeHost(_ url: String) -> Bool {
    let afterScheme = url.range(of: "://").map { url[$0.upperBound...] } ?? url[...]
    return afterScheme.prefix { !"/?#\\".contains($0) }.unicodeScalars.contains { !$0.isASCII }
}

@Test(arguments: Vectors.shared.urls)
private func normalizesLikeTheWHATWGParser(_ vector: Vectors.URLCase) {
    let url = CredentialURLMatching.normalize(vector.input)
    let expected = convertsUnicodeHosts() || !hasUnicodeHost(vector.input) ? vector.expected : nil
    #expect(url.map { .init(hostname: $0.hostname, port: $0.port.map(String.init) ?? "", pathname: $0.pathname) } == expected)
}

@Test(arguments: Vectors.shared.registrableDomains)
private func findsRegistrableDomains(_ vector: Vectors.DomainCase) {
    #expect(PublicSuffix.registrableDomain(vector.hostname) == vector.expected)
}

@Test(arguments: Vectors.shared.matches)
private func matchesCredentialURLs(_ vector: Vectors.MatchCase) {
    var credential = VaultUtilTypes_Credential()
    credential.url = vector.credential.URL
    credential.urlmatchMode = .init(rawValue: vector.credential.URLMatchMode)!
    credential.additionalUrls = (vector.credential.AdditionalURLs ?? []).map { rule in
        var url = VaultUtilTypes_CredentialURL()
        url.url = rule.URL
        url.matchMode = .init(rawValue: rule.MatchMode)!
        return url
    }
    let priority = CredentialURLMatching.matchPriority(
        CredentialURLMatching.rules(of: credential),
        pageURL: vector.pageUrl,
        ignorePort: vector.ignorePort ?? false
    )
    let urls = [vector.credential.URL, vector.pageUrl] + (vector.credential.AdditionalURLs ?? []).map(\.URL)
    #expect(priority == (convertsUnicodeHosts() || !urls.contains(where: hasUnicodeHost) ? vector.expected : nil))
}

@Test(arguments: Vectors.shared.rules)
private func validatesRulesLikeTheApp(_ vector: Vectors.RuleCase) {
    #expect(CredentialURLMatching.isValid(.init(url: vector.rule.URL, matchMode: .init(rawValue: vector.rule.MatchMode))) == vector.expected)
}
