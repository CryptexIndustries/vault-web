import Foundation

/// CredentialURLMatchMode in vault.proto. This file avoids the generated
/// types so the app's iOS module can compile it too.
enum CredentialURLMatchMode: Equatable {
    case exactHost
    case domain
    case wildcard

    /// Unknown values match by domain, as in TypeScript.
    init(rawValue: Int) {
        self = rawValue == 0 ? .exactHost : rawValue == 2 ? .wildcard : .domain
    }

    var rawValue: Int {
        switch self {
        case .exactHost: return 0
        case .domain: return 1
        case .wildcard: return 2
        }
    }
}

struct CredentialURLRule: Equatable {
    let url: String
    let matchMode: CredentialURLMatchMode
}

/// Port of the matching half of packages/vault-core/src/credential-url.ts.
/// Both read packages/vault-core/src/tests/fixtures/credential-url-vectors.json
/// in their tests, so change them together.
enum CredentialURLMatching {
    /// getCredentialUrlRules: the primary URL, then the additional ones, without blanks.
    static func rules(_ rules: [CredentialURLRule]) -> [CredentialURLRule] {
        rules.filter { !jsTrim($0.url).isEmpty }
    }

    /// The best rule priority for the page (3 exact host, 2 wildcard,
    /// 1 registrable domain), or nil when no rule matches.
    static func matchPriority(_ rules: [CredentialURLRule], pageURL: String, ignorePort: Bool) -> Int? {
        guard let page = normalize(pageURL) else { return nil }
        return rules.compactMap { priority(of: $0, page: page, ignorePort: ignorePort) }.max()
    }

    /// isCredentialUrlRuleValid: a website, an Android app matched exactly, or
    /// a wildcard pattern that keeps the registrable domain fixed.
    static func isValid(_ rule: CredentialURLRule) -> Bool {
        if isAndroidApp(rule.url) { return rule.matchMode == .exactHost }
        guard let url = normalize(rule.url) else { return false }
        guard rule.matchMode == .wildcard else { return true }
        let labels = normalizedHostname(url).split(separator: ".", omittingEmptySubsequences: false)
        return labels.count >= 2
            && labels.contains(where: isWildcardLabel)
            && labels.allSatisfy { $0 == "*" || $0.range(of: "^[a-z0-9-]+$", options: [.regularExpression, .caseInsensitive]) != nil }
            && wildcardHostnameIsSafe(labels)
    }

    /// normalizeAndroidAppUri accepts only "androidapp://" and a package name.
    private static func isAndroidApp(_ raw: String) -> Bool {
        jsTrim(raw).range(
            of: "^androidapp://(?:[a-zA-Z][a-zA-Z0-9_]*\\.)+[a-zA-Z][a-zA-Z0-9_]*$",
            options: [.regularExpression, .caseInsensitive]
        ) != nil
    }

    /// JavaScript's String.prototype.trim whitespace.
    private static let jsWhitespace = CharacterSet.whitespaces
        .union(CharacterSet(charactersIn: "\u{0B}\u{0C}\u{FEFF}\n\r\u{2028}\u{2029}"))

    static func jsTrim(_ value: String) -> String {
        value.trimmingCharacters(in: jsWhitespace)
    }

    /// normalizeCredentialPattern. normalizeCredentialUrl only adds a check for
    /// "%2A" in the hostname, which a WHATWG parser decodes, so both use this.
    static func normalize(_ raw: String) -> WebURL? {
        let trimmed = jsTrim(raw)
        if trimmed.isEmpty { return nil }
        if trimmed.range(of: "^https?://", options: [.regularExpression, .caseInsensitive]) != nil {
            return WebURL(trimmed)
        }
        if hasExplicitNonHttpScheme(trimmed) { return nil }
        return WebURL("https://" + trimmed)
    }

    private static func hasExplicitNonHttpScheme(_ value: String) -> Bool {
        guard let match = value.range(of: "^[A-Za-z][A-Za-z0-9+.-]*:", options: .regularExpression) else {
            return false
        }
        let scheme = value[match].dropLast()
        let remainder = value[match.upperBound...]
        let looksLikeHostPort = remainder.range(of: "^[0-9]+(?:[/?#]|$)", options: .regularExpression) != nil
            && (scheme.contains(".") || scheme.lowercased() == "localhost")
        return !looksLikeHostPort
    }

    private static func protocolsAndPortsMatch(_ saved: WebURL, _ page: WebURL, ignorePort: Bool) -> Bool {
        if saved.scheme == "https", page.scheme != "https" { return false }
        return ignorePort || saved.port == page.port
    }

    static func normalizedHostname(_ url: WebURL) -> String {
        var hostname = url.hostname.lowercased()
        if hostname.hasSuffix(".") { hostname.removeLast() }
        return hostname
    }

    static func isWildcardLabel(_ label: Substring) -> Bool {
        label == "*" || label.lowercased() == "%2a"
    }

    private static func wildcardHostnameIsSafe(_ labels: [Substring]) -> Bool {
        let sample = labels.map { isWildcardLabel($0) ? "wildcard" : String($0) }.joined(separator: ".")
        guard let registrableDomain = PublicSuffix.registrableDomain(sample) else { return false }
        let registrableLabels = registrableDomain.split(separator: ".", omittingEmptySubsequences: false).count
        return labels.suffix(registrableLabels).allSatisfy { !isWildcardLabel($0) }
    }

    private static func wildcardRuleMatches(_ rawPattern: String, page: WebURL, ignorePort: Bool) -> Bool {
        guard let pattern = normalize(rawPattern),
              protocolsAndPortsMatch(pattern, page, ignorePort: ignorePort)
        else { return false }
        let labels = normalizedHostname(pattern).split(separator: ".", omittingEmptySubsequences: false)
        guard labels.count >= 2, wildcardHostnameIsSafe(labels),
              labels.allSatisfy({ label in
                  label.contains("*")
                      ? isWildcardLabel(label)
                      : label.range(of: "^[a-z0-9-]+$", options: [.regularExpression, .caseInsensitive]) != nil
              })
        else { return false }

        let pageLabels = normalizedHostname(page).split(separator: ".", omittingEmptySubsequences: false)
        guard pageLabels.count == labels.count,
              zip(labels, pageLabels).allSatisfy({ label, pageLabel in
                  isWildcardLabel(label) ? !pageLabel.isEmpty : label.lowercased() == pageLabel.lowercased()
              })
        else { return false }

        if pattern.pathname == "/" { return true }
        let pathPattern = "^"
            + NSRegularExpression.escapedPattern(for: pattern.pathname)
                .replacingOccurrences(of: "\\*\\*", with: ".*")
                .replacingOccurrences(of: "\\*", with: "[^/]*")
            + "$"
        return page.pathname.range(of: pathPattern, options: .regularExpression) != nil
    }

    private static func priority(of rule: CredentialURLRule, page: WebURL, ignorePort: Bool) -> Int? {
        if rule.matchMode == .wildcard {
            return wildcardRuleMatches(rule.url, page: page, ignorePort: ignorePort) ? 2 : nil
        }
        guard let saved = normalize(rule.url),
              protocolsAndPortsMatch(saved, page, ignorePort: ignorePort)
        else { return nil }
        let savedHostname = normalizedHostname(saved)
        let pageHostname = normalizedHostname(page)
        if rule.matchMode == .exactHost {
            return savedHostname == pageHostname ? 3 : nil
        }
        // Unknown modes fall through to domain matching, as in TypeScript.
        guard let savedDomain = PublicSuffix.registrableDomain(savedHostname),
              let pageDomain = PublicSuffix.registrableDomain(pageHostname)
        else { return savedHostname == pageHostname ? 3 : nil }
        return savedDomain == pageDomain ? 1 : nil
    }
}
