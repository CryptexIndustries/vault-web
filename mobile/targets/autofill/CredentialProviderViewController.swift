import AuthenticationServices
import CryptoKit
import SwiftUI
import UniformTypeIdentifiers

final class CredentialProviderViewController: ASCredentialProviderViewController {
    private lazy var model = AutofillModel(
        complete: { [weak self] fill, added in self?.complete(fill, adding: added) },
        cancel: { [weak self] code in
            self?.extensionContext.cancelRequest(withError: ASExtensionError(code))
        },
        finishSetup: { [weak self] in self?.extensionContext.completeExtensionConfigurationRequest() }
    )

    override func viewDidLoad() {
        super.viewDidLoad()
        // SwiftUI's preferredColorScheme doesn't reach the system's navigation
        // bar here, so set the app's dark style for the whole extension.
        overrideUserInterfaceStyle = .dark
        // Dark from the first frame, before SwiftUI draws.
        view.backgroundColor = .autofillBackground
        let host = UIHostingController(rootView: AutofillView(model: model))
        host.view.backgroundColor = .autofillBackground
        addChild(host)
        host.view.frame = view.bounds
        host.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(host.view)
        host.didMove(toParent: self)
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        model.viewDidAppear()
    }

    // Swiping the sheet down on the setup screen is Done. A sheet of the
    // extension's own that covers it, as in landscape, isn't a dismissal.
    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        guard presentedViewController == nil else { return }
        model.cancel()
    }

    override func prepareInterfaceForExtensionConfiguration() {
        model.setUp()
    }

    override func prepareCredentialList(for serviceIdentifiers: [ASCredentialServiceIdentifier]) {
        model.showList(for: serviceIdentifiers.compactMap(ServiceTarget.init), kind: .password)
    }

    @available(iOS 26.2, *)
    override func prepareInterface(for savePasswordRequest: ASSavePasswordRequest) {
        model.save(
            source: SaveSource(savePasswordRequest.serviceIdentifier),
            username: savePasswordRequest.credential.user,
            password: savePasswordRequest.credential.password
        )
    }

    // Saving asks for Face ID too.
    @available(iOS 26.2, *)
    override func performWithoutUserInteractionIfPossible(savePasswordRequest: ASSavePasswordRequest) {
        extensionContext.cancelRequest(withError: ASExtensionError(.userInteractionRequired))
    }

    @available(iOS 18.0, *)
    override func prepareOneTimeCodeCredentialList(for serviceIdentifiers: [ASCredentialServiceIdentifier]) {
        model.showList(for: serviceIdentifiers.compactMap(ServiceTarget.init), kind: .oneTimeCode)
    }

    /// AutoFill in a text field's menu: any login's username, password or code.
    @available(iOS 18.0, *)
    override func prepareInterfaceForUserChoosingTextToInsert() {
        model.showList(for: [], kind: nil)
    }

    /// Passwords iOS offers for a new account need no unlock. A website
    /// without password rules also gets a passphrase.
    @available(iOS 26.2, *)
    override func performWithoutUserInteraction(generatePasswordsRequest: ASGeneratePasswordsRequest) {
        let rules = [generatePasswordsRequest.passwordFieldPasswordRules, generatePasswordsRequest.passwordRulesFromQuirks]
            .compactMap { $0 }.first { !$0.isEmpty }
        guard let strong = PasswordRules(rules ?? "").password() else {
            return extensionContext.cancelRequest(withError: ASExtensionError(.failed))
        }
        var passwords = [ASGeneratedPassword(kind: .strong, value: strong)]
        if rules == nil {
            let passphrase = PasswordGenerator.generate(.init(kind: .memorable, length: 4, wordSeparator: .dash))
            passwords.append(ASGeneratedPassword(kind: .passphrase, value: passphrase))
        }
        extensionContext.completeGeneratePasswordRequest(results: passwords)
    }

    // Every fill asks for Face ID, which needs the extension's interface.
    override func provideCredentialWithoutUserInteraction(for credentialIdentity: ASPasswordCredentialIdentity) {
        extensionContext.cancelRequest(withError: ASExtensionError(.userInteractionRequired))
    }

    @available(iOS 17.0, *)
    override func provideCredentialWithoutUserInteraction(for credentialRequest: any ASCredentialRequest) {
        extensionContext.cancelRequest(withError: ASExtensionError(.userInteractionRequired))
    }

    override func prepareInterfaceToProvideCredential(for credentialIdentity: ASPasswordCredentialIdentity) {
        model.fill(recordIdentifier: credentialIdentity.recordIdentifier, kind: .password)
    }

    @available(iOS 17.0, *)
    override func prepareInterfaceToProvideCredential(for credentialRequest: any ASCredentialRequest) {
        var kind = AutofillIdentity.Kind.password
        if #available(iOS 18.0, *), credentialRequest.type == .oneTimeCode { kind = .oneTimeCode }
        model.fill(recordIdentifier: credentialRequest.credentialIdentity.recordIdentifier, kind: kind)
    }

    /// Logins saved during the request join the suggestions after it ends:
    /// iOS keeps the extension running until the handler returns.
    private func complete(_ fill: AutofillModel.Fill, adding identities: [AutofillIdentity]) {
        let addIdentities: (Bool) -> Void = { expired in
            guard !expired, !identities.isEmpty else { return }
            let added = DispatchSemaphore(value: 0)
            Task.detached {
                try? await IdentityStore.add(identities)
                added.signal()
            }
            added.wait()
        }
        switch fill {
        case let .password(user, password, codeToCopy):
            if let codeToCopy {
                // Like the app's secret copies: this device only, cleared after 30 seconds.
                UIPasteboard.general.setItems(
                    [[UTType.utf8PlainText.identifier: codeToCopy]],
                    options: [.localOnly: true, .expirationDate: Date(timeIntervalSinceNow: 30)]
                )
            }
            extensionContext.completeRequest(
                withSelectedCredential: ASPasswordCredential(user: user, password: password),
                completionHandler: addIdentities
            )
        case let .oneTimeCode(code):
            guard #available(iOS 18.0, *) else { return }
            extensionContext.completeOneTimeCodeRequest(using: ASOneTimeCodeCredential(code: code), completionHandler: addIdentities)
        case let .text(text):
            guard #available(iOS 18.0, *) else { return }
            extensionContext.completeRequest(withTextToInsert: text, completionHandler: addIdentities)
        case .saved:
            guard #available(iOS 26.2, *) else { return }
            extensionContext.completeSavePasswordRequest(completionHandler: addIdentities)
        }
    }
}

private extension SaveSource {
    /// The Android request fields SaveDefaults reads, from iOS's identifier.
    init(_ identifier: ASCredentialServiceIdentifier) {
        if let target = ServiceTarget(identifier) {
            self.init(target)
            return
        }
        // An app (iOS 26.2): its name, but not its bundle ID, which Android's
        // rules would turn into an androidapp:// address.
        self.init()
        if #available(iOS 26.2, *) { applicationLabel = identifier.displayName }
        if applicationLabel == nil { applicationLabel = identifier.identifier }
    }
}

private extension ServiceTarget {
    init?(_ identifier: ASCredentialServiceIdentifier) {
        switch identifier.type {
        case .URL: self = .url(identifier.identifier)
        case .domain: self = .domain(identifier.identifier)
        default: return nil
        }
    }
}

/// One request's state. Each fill unlocks again, and finishing or canceling
/// drops the decrypted logins.
@MainActor
final class AutofillModel: ObservableObject {
    enum Phase {
        case loading
        case choosingVault([SharedVault.Summary])
        /// Face ID was canceled or failed; the user can try again.
        case locked(SharedVault.Summary)
        case list
        case message(title: String, detail: String)
        /// The screen iOS shows when the user turns the extension on.
        case setup(message: String, done: Bool)
        /// Update one of these logins, or save a new one with this name.
        case saveChoice(candidates: [AutofillLogin], newName: String, username: String)
    }

    enum Fill {
        case password(user: String, password: String, codeToCopy: String?)
        case oneTimeCode(String)
        case text(String)
        case saved
    }

    private struct SaveRequest {
        let source: SaveSource
        let username: String
        let password: String
    }

    /// The open vault's DEK, from Face ID until the request ends, for inbox entries.
    private struct VaultKey {
        let summary: SharedVault.Summary
        let key: SymmetricKey
    }

    @Published private(set) var phase = Phase.loading
    /// Nil when the user chooses text to insert.
    @Published private(set) var kind: AutofillIdentity.Kind? = .password
    /// The setup screen's request, which ends with Done rather than Cancel.
    @Published private(set) var isSettingUp = false
    @Published private(set) var vaultName = ""
    @Published private(set) var suggested: [AutofillLogin] = []
    @Published private(set) var logins: [AutofillLogin] = []
    @Published var query = ""
    /// The website iOS asked for, when it named one.
    @Published private(set) var destination: FillDestination?
    /// A login picked for a website it isn't saved for, or for a page
    /// without HTTPS, or to insert text from: the screen pushed over the list.
    @Published var picked: AutofillLogin?
    /// The Add login sheet, which saves and then fills.
    @Published var isEditing = false
    @Published var draft = LoginDraft()
    /// The form as it opened, to tell whether leaving discards anything.
    private(set) var openedDraft = LoginDraft()
    @Published private(set) var directories: [(id: String, name: String)] = []
    @Published private(set) var isWriting = false
    /// Why Add login can't save the form.
    @Published private(set) var problem: LoginDraft.Problem?
    /// Why the last write failed, shown as an alert.
    @Published var writeError: String?

    private let complete: (Fill, [AutofillIdentity]) -> Void
    private let cancelRequest: (ASExtensionError.Code) -> Void
    private let finishSetup: () -> Void
    private let request = AutofillRequest()
    private var vault: SharedVault?
    private var targets: [ServiceTarget] = []
    /// Set when the user picked a suggestion above the keyboard.
    private var requestedCredentialID: String?
    private var saveRequest: SaveRequest?
    private var vaultKey: VaultKey?
    /// Identities for logins this request saved, added to iOS's suggestions as it ends.
    private var added: [AutofillIdentity] = []
    /// Vaults the setup screen has yet to register, the current one first.
    private var setupQueue: ArraySlice<SharedVault.Summary> = []
    /// iOS calls the prepare methods before the extension is on screen, and Face
    /// ID fails with notInteractive until it is, so unlocks wait for this.
    private var isVisible = false
    private var pendingUnlock: (() -> Void)?

    init(
        complete: @escaping (Fill, [AutofillIdentity]) -> Void,
        cancel: @escaping (ASExtensionError.Code) -> Void,
        finishSetup: @escaping () -> Void
    ) {
        self.complete = complete
        cancelRequest = cancel
        self.finishSetup = finishSetup
    }

    func showList(for targets: [ServiceTarget], kind: AutofillIdentity.Kind?) {
        self.targets = targets
        self.kind = kind
        destination = FillDestination(targets, fallbackName: String(localized: "New login"))
        openChosenVault()
    }

    /// iOS asked to save a login: pick the vault, unlock it, then ask whether
    /// to update a matching login or save a new one.
    func save(source: SaveSource, username: String, password: String) {
        saveRequest = SaveRequest(source: source, username: username, password: password)
        kind = .password
        openChosenVault()
    }

    private func openChosenVault() {
        vault = SharedVault()
        let vaults = vault?.faceIDVaults() ?? []
        switch VaultChoice.resolve(enabled: vaults.map(\.id), lastChoice: vault?.lastVaultIndex) {
        case .none:
            phase = .message(
                title: String(localized: "No Vaults to Fill From"),
                detail: String(localized: "Turn on biometric unlock for a vault in Cryptex Vault to fill its passwords here.")
            )
        case let .open(index):
            if let summary = vaults.first(where: { $0.id == index }) { unlock(summary) }
        case let .ask(order):
            phase = .choosingVault(order.compactMap { index in vaults.first { $0.id == index } })
        }
    }

    func fill(recordIdentifier: String?, kind: AutofillIdentity.Kind) {
        self.kind = kind
        vault = SharedVault()
        guard let record = recordIdentifier.flatMap(AutofillLogins.parseRecordIdentifier),
              let summary = vault?.faceIDVaults().first(where: { $0.id == record.vaultIndex })
        else { return end { cancelRequest(.credentialIdentityNotFound) } }
        requestedCredentialID = record.credentialID
        unlock(summary)
    }

    func viewDidAppear() {
        isVisible = true
        pendingUnlock?()
        pendingUnlock = nil
    }

    private func whenVisible(_ work: @escaping () -> Void) {
        if isVisible { work() } else { pendingUnlock = work }
    }

    /// The locked screen's button.
    func retry(_ summary: SharedVault.Summary) {
        if isSettingUp { register() } else { unlock(summary) }
    }

    func choose(_ summary: SharedVault.Summary) {
        vault?.lastVaultIndex = summary.id
        unlock(summary)
    }

    private func unlock(_ summary: SharedVault.Summary) {
        guard let vault else { return }
        phase = .loading
        vaultName = summary.name
        let kind = kind
        let reason = saveRequest != nil
            ? String(localized: "Unlock your vault to save a password")
            : kind == .password
            ? String(localized: "Unlock your vault to fill a password")
            : kind == .oneTimeCode
            ? String(localized: "Unlock your vault to fill a verification code")
            : String(localized: "Unlock your vault to choose what to fill")
        whenVisible {
            Task {
                guard let result = await self.request.run({ () -> ([AutofillLogin], OpenedVault) in
                    let opened = try vault.unlock(summary.id, reason: reason)
                    let pending = vault.pendingLogins(vaultIndex: summary.id, key: opened.key)
                    return (AutofillLogins.candidates(in: opened.vault, for: kind, pending: pending), opened)
                }) else { return }
                self.unlocked(summary, result)
            }
        }
    }

    private func unlocked(_ summary: SharedVault.Summary, _ result: Result<([AutofillLogin], OpenedVault), Error>) {
        switch result {
        case let .success((logins, opened)):
            vaultKey = VaultKey(summary: summary, key: opened.key)
            if let saveRequest {
                phase = .saveChoice(
                    candidates: SaveDefaults.candidates(logins, source: saveRequest.source, username: saveRequest.username),
                    newName: SaveDefaults.name(saveRequest.source, fallback: String(localized: "New login")),
                    username: saveRequest.username
                )
                return
            }
            if let requestedCredentialID {
                guard let login = logins.first(where: { $0.id == requestedCredentialID }) else {
                    return end { cancelRequest(.credentialIdentityNotFound) }
                }
                return select(login)
            }
            self.logins = logins
            suggested = AutofillLogins.matching(logins, targets: targets)
            // sortDirectories in vault-core.
            directories = opened.vault.directories
                .filter { !$0.deleted }
                .sorted {
                    let order = $0.name.compare($1.name, options: [.caseInsensitive, .diacriticInsensitive])
                    return order == .orderedSame ? $0.id < $1.id : order == .orderedAscending
                }
                .map { ($0.id, $0.name) }
            phase = .list
        case .failure(SharedVaultError.notAuthenticated), .failure(SharedVaultError.notInteractive):
            phase = .locked(summary)
        case .failure(SharedVaultError.keyInvalidated):
            phase = .message(
                title: String(localized: "\(SharedVault.biometryName) Changed"),
                detail: String(localized: "\(SharedVault.biometryName) changed on this device. Turn biometric unlock on again in Cryptex Vault.")
            )
        case .failure:
            phase = .message(
                title: String(localized: "Can't Open Vault"),
                detail: String(localized: "Could not open this vault. Unlock it in Cryptex Vault, then try again.")
            )
        }
    }

    /// A row in the list: logins for another website go through the review,
    /// and text insertion asks which of the login's values to insert.
    func pick(_ login: AutofillLogin) {
        guard kind == nil || destination?.needsReview(login) == true else {
            return select(login)
        }
        picked = login
    }

    /// Adds the website to the login through the inbox, then fills it.
    func addWebsiteAndFill(_ login: AutofillLogin) {
        guard let destination else { return }
        let association = InboxLogin(decision: .associate, targetId: login.id, credential: InboxCredential(url: destination.url))
        write(association) { id in
            self.register(AutofillInbox.applyPending([(id, association)], to: [login]))
            self.select(login)
        } failed: {
            self.writeError = String(localized: "The website could not be added, so the login was not filled. Try again, or fill it once.")
        }
    }

    func addLogin() {
        var draft = LoginDraft(name: destination?.name ?? "", website: .init(url: destination?.url ?? ""))
        // A strong password to start with, as Safari suggests one.
        if kind == .password { draft.password = PasswordGenerator.generate(.init()) }
        self.draft = draft
        openedDraft = draft
        problem = nil
        isEditing = true
    }

    /// Saves the form as a new login through the inbox, then fills it, after
    /// the review when its websites don't cover the page.
    func saveDraft() {
        let credential: InboxCredential
        switch draft.credential() {
        case let .success(value):
            credential = value
            problem = nil
        case let .failure(problem):
            self.problem = problem
            return
        }
        let login = InboxLogin(decision: .new, targetId: nil, credential: credential)
        write(login) { id in
            self.logins = AutofillInbox.applyPending([(id, login)], to: self.logins)
            self.suggested = AutofillLogins.matching(self.logins, targets: self.targets)
            self.isEditing = false
            guard let added = self.logins.first(where: { $0.id == id }) else { return }
            self.register([added])
            if self.kind == .password ? !added.password.isEmpty : added.totp != nil { self.pick(added) }
        } failed: {
            self.writeError = String(localized: "The login could not be saved. Your changes are still in the form.")
        }
    }

    /// Adds saved logins to iOS's suggestions when the request ends.
    private func register(_ logins: [AutofillLogin]) {
        guard let vaultKey else { return }
        added += AutofillIdentities.build(vaultIndex: vaultKey.summary.id, logins: logins.map(IdentityLogin.init))
    }

    func select(_ login: AutofillLogin) {
        guard !request.hasEnded, let kind else { return }
        let fill: Fill
        switch kind {
        case .password:
            let codeToCopy = vault?.autoCopyTotp == true ? login.totp.flatMap { OneTimeCode.code(for: $0) } : nil
            fill = .password(user: login.username, password: login.password, codeToCopy: codeToCopy)
        case .oneTimeCode:
            guard let code = login.totp.flatMap({ OneTimeCode.code(for: $0) }) else {
                clear()
                phase = .message(
                    title: String(localized: "Can't Create Code"),
                    detail: String(localized: "Could not create a code for this login.")
                )
                return
            }
            fill = .oneTimeCode(code)
        }
        if let vaultKey { IdentityStore.recordFill("\(vaultKey.summary.id):\(login.id)") }
        end { complete(fill, added) }
    }

    /// Text insertion's choice: a username, password or code.
    func insert(_ text: String) {
        guard !request.hasEnded else { return }
        end { complete(.text(text), added) }
    }

    /// Close, or swiping the sheet away. Ends any request, so an unlock still
    /// running can't fill or copy a code afterwards.
    func cancel() {
        if isSettingUp { return doneSettingUp() }
        end { cancelRequest(.userCanceled) }
    }

    /// Ends the request once, dropping what it holds, then tells iOS.
    private func end(_ tellIOS: () -> Void) {
        guard request.end() else { return }
        saveRequest = nil
        vaultKey = nil
        draft = LoginDraft()
        openedDraft = LoginDraft()
        picked = nil
        isEditing = false
        phase = .loading
        clear()
        tellIOS()
    }

    /// Writes the chosen save to the inbox for the app to add on its next
    /// unlock. Nil `target` saves a new login.
    func saveLogin(updating target: AutofillLogin?) {
        guard let saveRequest, let vaultKey else { return }
        phase = .loading
        let credential = InboxCredential(
            name: SaveDefaults.name(saveRequest.source, fallback: String(localized: "New login")),
            username: saveRequest.username,
            password: saveRequest.password,
            url: SaveDefaults.url(saveRequest.source)
        )
        let login = InboxLogin(decision: target == nil ? .new : .update, targetId: target?.id, credential: credential)
        write(login) { id in
            self.register(AutofillInbox.applyPending([(id, login)], to: target.map { [$0] } ?? []))
            self.end { self.complete(.saved, self.added) }
        } failed: {
            self.phase = .message(
                title: String(localized: "Can't Save Login"),
                detail: String(localized: "Could not save this login. Try again from Cryptex Vault.")
            )
        } stale: {
            // Unlocking again picks up the new key.
            self.unlock(vaultKey.summary)
        }
    }

    /// Seals `login` with the vault's DEK into the inbox, then calls `written`
    /// with its ID. `stale` runs instead when the app has rotated the key
    /// since this request unlocked; without it that is a failure.
    private func write(
        _ login: InboxLogin,
        written: @escaping (String) -> Void,
        failed: @escaping () -> Void,
        stale: (() -> Void)? = nil
    ) {
        guard !request.hasEnded, !isWriting, vaultKey != nil, let vault else { return }
        isWriting = true
        Task {
            defer { isWriting = false }
            do {
                guard let lockURL = FileLock.url(FileLock.inbox) else { throw SharedVaultError.unavailable }
                // The app holds this lock through a key rotation, which derives
                // keys from the master password twice, so this waits a while.
                let lock = try await FileLock.acquire(lockURL, timeout: 30)
                defer { lock.release() }
                // Ending the request drops the key, so a cancel during the wait
                // leaves this task without it.
                guard !request.hasEnded, let vaultKey else { return }
                // The app merges the inbox and stores the rotated vault under
                // this lock, so a key that still opens the stored vault is current.
                guard vault.keyOpensStoredVault(vaultKey.summary.id, key: vaultKey.key) else {
                    return (stale ?? failed)()
                }
                let id = UUID().uuidString.lowercased()
                try vault.addToInbox(AutofillInbox.seal(
                    login,
                    id: id,
                    vaultIndex: vaultKey.summary.id,
                    createdAt: Date(),
                    key: vaultKey.key
                ))
                written(id)
            } catch {
                failed()
            }
        }
    }

    /// Unlocks each Face ID vault once to register its logins with iOS. A
    /// canceled or failed unlock skips that vault.
    func setUp() {
        isSettingUp = true
        vault = SharedVault()
        let vaults = vault?.faceIDVaults() ?? []
        guard !vaults.isEmpty else {
            phase = .setup(
                message: String(localized: "To fill from a vault, open it in Cryptex Vault and turn on biometric unlock under Settings, then Security."),
                done: true
            )
            return
        }
        // Before iOS 17.4 the store can't be updated per vault, so there is nothing to register.
        guard #available(iOS 17.4, *) else {
            phase = .setup(message: String(localized: "Choose Passwords above the keyboard, then Cryptex Vault, to fill a login."), done: true)
            return
        }
        setupQueue = vaults[...]
        register()
    }

    private func register() {
        guard let summary = setupQueue.first, let vault else { return doneSettingUp() }
        phase = .setup(
            message: String(localized: "Unlock each vault with \(SharedVault.biometryName) so its logins can appear above the keyboard."),
            done: false
        )
        let reason = String(localized: "Unlock your vault to show its logins above the keyboard")
        whenVisible {
            Task {
                guard let result = await self.request.run({
                    AutofillIdentities.build(
                        vaultIndex: summary.id,
                        logins: try vault.unlock(summary.id, reason: reason).vault.credentials.compactMap(IdentityLogin.init)
                    )
                }),
                    // The user may have skipped the rest meanwhile.
                    self.isSettingUp
                else { return }
                switch result {
                case .failure(SharedVaultError.notInteractive):
                    // Not a cancel: let the user try this vault again.
                    self.phase = .locked(summary)
                    return
                case let .success(identities):
                    // A store that fails or times out skips this vault too.
                    try? await IdentityStore.replace(vaultIndex: summary.id, with: identities)
                    guard self.isSettingUp else { return }
                case .failure:
                    // A canceled or failed Face ID skips this vault.
                    break
                }
                self.setupQueue = self.setupQueue.dropFirst()
                self.register()
            }
        }
    }

    /// Ends the setup request once, whether it finished, was skipped or failed.
    func doneSettingUp() {
        guard isSettingUp else { return }
        isSettingUp = false
        setupQueue = []
        vault = nil
        finishSetup()
    }

    private func clear() {
        logins = []
        suggested = []
        query = ""
    }
}
