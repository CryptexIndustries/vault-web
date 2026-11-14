/// Port of `psl.get` (psl 1.15.0), which vault-core uses for registrable
/// domains. Hostnames reach it already in ASCII, so it skips punycode.
enum PublicSuffix {
    private struct Rule {
        let suffix: [Substring]
        let wildcard: Bool
        let exception: Bool
    }

    private static let rules: [Substring: Rule] = {
        var rules: [Substring: Rule] = [:]
        for line in publicSuffixRules.split(separator: "\n") {
            let wildcard = line.hasPrefix("*.")
            let exception = line.hasPrefix("!")
            let suffix = line.dropFirst(wildcard ? 2 : exception ? 1 : 0)
            rules[suffix] = Rule(
                suffix: suffix.split(separator: ".", omittingEmptySubsequences: false),
                wildcard: wildcard,
                exception: exception
            )
        }
        return rules
    }()

    static func registrableDomain(_ input: String) -> String? {
        var domain = input.lowercased()
        if domain.hasSuffix(".") { domain.removeLast() }
        guard isValid(domain) else { return nil }

        let parts = domain.split(separator: ".", omittingEmptySubsequences: false)
        if parts.last == "local" { return nil }
        // The longest listed suffix wins.
        guard let rule = parts.indices.lazy.compactMap({ rules[Substring(parts[$0...].joined(separator: "."))] }).first
        else {
            guard parts.count >= 2 else { return nil }
            return parts.suffix(2).joined(separator: ".")
        }

        var tld = rule.suffix
        var privateParts = Array(parts.prefix(parts.count - tld.count))
        if rule.exception { privateParts.append(tld.removeFirst()) }
        if privateParts.isEmpty { return nil }
        if rule.wildcard { tld.insert(privateParts.removeLast(), at: 0) }
        guard let sld = privateParts.popLast() else { return nil }
        return ([sld] + tld).joined(separator: ".")
    }

    private static func isValid(_ domain: String) -> Bool {
        guard !domain.isEmpty, domain.utf8.count <= 255 else { return false }
        return domain.split(separator: ".", omittingEmptySubsequences: false).allSatisfy { label in
            !label.isEmpty && label.utf8.count <= 63 && !label.hasPrefix("-") && !label.hasSuffix("-")
                && label.allSatisfy { ("a"..."z").contains($0) || ("0"..."9").contains($0) || $0 == "-" || $0 == "_" }
        }
    }
}
