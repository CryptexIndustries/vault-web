import AuthenticationServices
import ExpoModulesCore

struct CredentialURLRecord: Record {
    @Field var url = ""
    /// CredentialURLMatchMode in vault.proto.
    @Field var matchMode = 0
}

/// A login without its password or TOTP secret.
struct IdentityLoginRecord: Record {
    @Field var id = ""
    @Field var name = ""
    @Field var username = ""
    @Field var hasPassword = false
    @Field var hasTotp = false
    @Field var urls: [CredentialURLRecord] = []
}

public final class CryptexIosCredentialsModule: Module {
    /// Read by the AutoFill extension from the same App Group.
    private static let autoCopyTotpKey = "autofill.autoCopyTotp"
    private static let appGroup = Bundle.main.object(forInfoDictionaryKey: "AppGroup") as? String
    /// Held while the app rotates a vault's data key (src/utils/ios-autofill-inbox.ts).
    private var inboxLock: FileLock?

    public func definition() -> ModuleDefinition {
        Name("CryptexIosCredentials")

        // The App Group shared with the AutoFill extension, also read by MMKV.
        Constant("appGroup") { Self.appGroup }

        AsyncFunction("replaceVaultIdentities") { (vaultIndex: Int, logins: [IdentityLoginRecord]) in
            let identities = AutofillIdentities.build(
                vaultIndex: vaultIndex,
                logins: logins.map {
                    IdentityLogin(
                        id: $0.id,
                        name: $0.name,
                        username: $0.username,
                        hasPassword: $0.hasPassword,
                        hasTotp: $0.hasTotp,
                        rules: $0.urls.map { CredentialURLRule(url: $0.url, matchMode: .init(rawValue: $0.matchMode)) }
                    )
                }
            )
            try await IdentityStore.replace(vaultIndex: vaultIndex, with: identities)
        }

        AsyncFunction("clearVaultIdentities") { (vaultIndex: Int) in
            try await IdentityStore.replace(vaultIndex: vaultIndex, with: [])
        }

        AsyncFunction("lockAutofillInbox") { () async throws in
            guard let url = FileLock.url(FileLock.inbox) else { throw Exception(name: "NoAppGroup", description: "The App Group is missing") }
            self.inboxLock = try await FileLock.acquire(url, timeout: 30)
        }

        Function("unlockAutofillInbox") {
            self.inboxLock?.release()
            self.inboxLock = nil
        }

        AsyncFunction("isProviderEnabled") { () async throws -> Bool in
            try await IdentityStore.isEnabled()
        }

        /// iOS's prompt to turn the provider on, and whether it ended up on.
        /// Nil before iOS 18, which has no prompt.
        AsyncFunction("requestProviderEnabled") { () async -> Bool? in
            guard #available(iOS 18.0, *) else { return nil }
            return await ASSettingsHelper.requestToTurnOnCredentialProviderExtension()
        }

        AsyncFunction("openProviderSettings") { () async throws -> Bool in
            guard #available(iOS 17.0, *) else { return false }
            try await ASSettingsHelper.openCredentialProviderAppSettings()
            return true
        }

        AsyncFunction("getAutoCopyTotp") { () -> Bool in
            Self.appGroup.flatMap(UserDefaults.init(suiteName:))?.bool(forKey: Self.autoCopyTotpKey) ?? false
        }

        AsyncFunction("setAutoCopyTotp") { (enabled: Bool) in
            Self.appGroup.flatMap(UserDefaults.init(suiteName:))?.set(enabled, forKey: Self.autoCopyTotpKey)
        }
    }
}
