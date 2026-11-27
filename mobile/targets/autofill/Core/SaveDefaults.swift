import Foundation

/// The fields of Android's save request (PendingAndroidCredentialRequest) that
/// its name and URL rules read. The extension fills them from iOS's request.
struct SaveSource: Equatable {
    /// The host, and from a page's URL also a port other than the default.
    var webDomain: String?
    var webScheme: String?
    var applicationLabel: String?
    var packageName: String?
    /// True for a page's URL. Android only knows the host, as does iOS for an
    /// associated domain, so those match logins on any port.
    var comparesPort = false
}

extension SaveSource {
    /// The fields from a page's URL or an app's associated domain.
    init(_ target: ServiceTarget) {
        self.init()
        switch target {
        case let .url(value):
            let url = WebURL(value)
            webDomain = url.map { url in url.hostname + (url.port.map { ":\($0)" } ?? "") }
            webScheme = url?.scheme
            comparesPort = true
        // Associated domains are verified over https.
        case let .domain(domain):
            webDomain = domain
            webScheme = "https"
        }
    }
}

/// Where a fill goes, for Android's destination review
/// (requiresAutofillReview and canAssociateAutofillTarget in
/// mobile/src/utils/android-autofill.ts).
struct FillDestination: Equatable {
    /// The first website iOS named. Android's review has one target, so a
    /// login saved for only another of iOS's websites is reviewed too.
    let target: ServiceTarget
    /// The host, as Android's target.displayName.
    let name: String
    /// The website an association adds and a new login starts with.
    let url: String

    /// The first website iOS named, or nil without one.
    init?(_ targets: [ServiceTarget], fallbackName: String) {
        guard let target = targets.first else { return nil }
        self.target = target
        let source = SaveSource(target)
        name = SaveDefaults.name(source, fallback: fallbackName)
        url = SaveDefaults.url(source)
    }

    var isInsecure: Bool { url.hasPrefix("http://") }

    /// A login saved for another website, or any login on a page without
    /// HTTPS, is reviewed before it fills.
    func needsReview(_ login: AutofillLogin) -> Bool { isInsecure || !matches(login) }

    /// Only an HTTPS page can be added, and only to a login not saved for it.
    func canAssociate(_ login: AutofillLogin) -> Bool { url.hasPrefix("https://") && !matches(login) }

    /// The login is saved for the website.
    func matches(_ login: AutofillLogin) -> Bool {
        !AutofillLogins.matching([login], targets: [target]).isEmpty
    }
}

/// Ports of Android's save rules in mobile/src/utils/android-autofill.ts and
/// app/credential-request.tsx. Both read
/// AutofillCoreTests/Fixtures/save-vectors.json in their tests.
enum SaveDefaults {
    /// defaultAutofillCredentialName, with its "New login" as `fallback`.
    static func name(_ source: SaveSource, fallback: String) -> String {
        [source.webDomain, source.applicationLabel, source.packageName]
            .lazy.compactMap { $0.map(CredentialURLMatching.jsTrim) }.first { !$0.isEmpty } ?? fallback
    }

    /// The URL the save editor starts with: buildAutofillTarget's pageUrl, or
    /// its appUri for an app, or nothing.
    static func url(_ source: SaveSource) -> String {
        pageURL(source) ?? appURI(source) ?? ""
    }

    /// Logins the save offers to update: those matching the page with the
    /// saved username, as saveCandidates in credential-request.tsx. Android's
    /// app associations aren't ported: iOS never sends an Android package.
    static func candidates(_ logins: [AutofillLogin], source: SaveSource, username: String) -> [AutofillLogin] {
        // buildAutofillTarget's "unverified-web-scheme" gets no matches.
        guard !username.isEmpty, let pageURL = pageURL(source),
              source.webScheme == "http" || source.webScheme == "https"
        else { return [] }
        return logins.filter {
            !$0.password.isEmpty && $0.username == username
                && CredentialURLMatching.matchPriority($0.rules, pageURL: pageURL, ignorePort: !source.comparesPort) != nil
        }
    }

    private static func pageURL(_ source: SaveSource) -> String? {
        guard let domain = source.webDomain.map(CredentialURLMatching.jsTrim)?.lowercased(), !domain.isEmpty
        else { return nil }
        return "\(source.webScheme == "http" ? "http" : "https")://\(domain)"
    }

    /// normalizeAndroidAppUri: a package name is all a valid one can contain.
    private static func appURI(_ source: SaveSource) -> String? {
        guard let package = source.packageName.map(CredentialURLMatching.jsTrim),
              package.range(of: "^(?:[a-zA-Z][a-zA-Z0-9_]*\\.)+[a-zA-Z][a-zA-Z0-9_]*$", options: .regularExpression) != nil
        else { return nil }
        return "androidapp://\(package.lowercased())"
    }
}
