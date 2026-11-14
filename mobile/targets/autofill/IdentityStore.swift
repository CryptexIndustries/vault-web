import AuthenticationServices

/// Registers identities with iOS, for the setup screen and, through
/// modules/cryptex-ios-credentials/ios/Shared, for the app.
enum IdentityStore {
    /// The store never answers when its service isn't running (as on the
    /// Simulator), and ten seconds still covers a large replace on a busy
    /// device. A timed-out call isn't canceled and may still complete.
    private static let timeout: Double = 10
    /// When the extension last filled each record identifier, in the App Group.
    private static let lastFilledKey = "autofill.lastFilled"
    private static let defaults = (Bundle.main.object(forInfoDictionaryKey: "AppGroup") as? String)
        .flatMap(UserDefaults.init(suiteName:))

    static func isEnabled() async throws -> Bool {
        try await withTimeout(seconds: timeout) { await ASCredentialIdentityStore.shared.state().isEnabled }
    }

    /// Keeps other vaults' identities. Listing the store needs iOS 17.4, so
    /// older versions get no suggestions, only the extension's own list.
    static func replace(vaultIndex: Int, with identities: [AutofillIdentity]) async throws {
        guard #available(iOS 17.4, *) else { return }
        let store = ASCredentialIdentityStore.shared
        // A disabled store rejects updates. The app updates it again when it
        // returns to the foreground, and the setup screen when it's turned on.
        guard try await isEnabled(), let lock = FileLock.url(FileLock.identityStore) else { return }
        let prefix = "\(vaultIndex):"
        let kept = Set(identities.map(\.recordIdentifier))
        // The app and the extension both list and replace the whole store. The
        // lock keeps them apart, and a call that times out keeps it until the
        // store answers, so the next update lists what that call wrote.
        try await withFileLock(lock, timeout: timeout) {
            defaults?.set(lastFilled().filter { !$0.key.hasPrefix(prefix) || kept.contains($0.key) }, forKey: lastFilledKey)
            let updated = credentialIdentities(identities)
            let others = await store.credentialIdentities().filter { !($0.recordIdentifier?.hasPrefix(prefix) ?? false) }
            try await store.replaceCredentialIdentities(others + updated)
        }
    }

    /// Adds a login the extension just saved, until the app replaces the
    /// vault's identities after adding it. Only to a vault the store still
    /// lists, so a late add can't undo the app clearing it.
    static func add(_ identities: [AutofillIdentity]) async throws {
        guard #available(iOS 17.4, *), let first = identities.first,
              let lock = FileLock.url(FileLock.identityStore)
        else { return }
        let store = ASCredentialIdentityStore.shared
        let state = try await withTimeout(seconds: timeout) { await store.state() }
        // Without incremental updates only a full replace works, which the app makes.
        guard state.isEnabled, state.supportsIncrementalUpdates else { return }
        let prefix = String(first.recordIdentifier.prefix { $0 != ":" }) + ":"
        try await withFileLock(lock, timeout: timeout) {
            guard await store.credentialIdentities().contains(where: { $0.recordIdentifier?.hasPrefix(prefix) ?? false })
            else { return }
            try await store.saveCredentialIdentities(credentialIdentities(identities))
        }
    }

    /// Ranks the record first among the accounts iOS offers for its website
    /// from the next store update on.
    static func recordFill(_ recordIdentifier: String) {
        var history = lastFilled()
        history[recordIdentifier] = Int(Date().timeIntervalSince1970)
        defaults?.set(history, forKey: lastFilledKey)
    }

    private static func lastFilled() -> [String: Any] {
        defaults?.dictionary(forKey: lastFilledKey) ?? [:]
    }

    @available(iOS 17.4, *)
    private static func credentialIdentities(_ identities: [AutofillIdentity]) -> [any ASCredentialIdentity] {
        let history = lastFilled()
        return identities.compactMap { identity -> (any ASCredentialIdentity)? in
            let service = ASCredentialServiceIdentifier(identifier: identity.domain, type: .domain)
            switch identity.kind {
            case .password:
                let password = ASPasswordCredentialIdentity(serviceIdentifier: service, user: identity.user, recordIdentifier: identity.recordIdentifier)
                password.rank = history[identity.recordIdentifier] as? Int ?? 0
                return password
            case .oneTimeCode:
                guard #available(iOS 18.0, *) else { return nil }
                let code = ASOneTimeCodeCredentialIdentity(serviceIdentifier: service, label: identity.user, recordIdentifier: identity.recordIdentifier)
                code.rank = history[identity.recordIdentifier] as? Int ?? 0
                return code
            }
        }
    }
}
