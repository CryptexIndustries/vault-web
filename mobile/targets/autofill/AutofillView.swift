import SwiftUI

extension UIColor {
    static let autofillBackground = UIColor(red: 0x18 / 255, green: 0x1D / 255, blue: 0x2B / 255, alpha: 1)
}

/// The app's dark palette, from mobile/src/theme/colors.ts.
enum Palette {
    static let background = Color(uiColor: .autofillBackground)
    static let row = Color(red: 0x22 / 255, green: 0x29 / 255, blue: 0x3A / 255)
    static let foreground = Color(red: 0xFC / 255, green: 0xF8 / 255, blue: 0xEC / 255)
    static let muted = Color(red: 0x8A / 255, green: 0x93 / 255, blue: 0xA8 / 255)
    static let primary = Color(red: 0xFF / 255, green: 0x56 / 255, blue: 0x68 / 255)
}

/// iOS 26's close button, or Cancel before it.
struct CloseButton: View {
    let action: () -> Void

    var body: some View {
        if #available(iOS 26.0, *) {
            Button(role: .close, action: action)
        } else {
            Button(String(localized: "Cancel"), action: action).tint(Palette.foreground)
        }
    }
}

/// iOS 26's checkmark button, or `title` before it.
struct ConfirmButton: View {
    let title: String
    let action: () -> Void

    var body: some View {
        if #available(iOS 26.0, *) {
            Button(role: .confirm, action: action).accessibilityLabel(title)
        } else {
            Button(title, action: action)
        }
    }
}

/// A screen-filling state, as ContentUnavailableView from iOS 17 on.
struct StatusView<Actions: View>: View {
    let symbol: String
    let title: String
    var detail: String?
    @ViewBuilder var actions: Actions

    var body: some View {
        if #available(iOS 17.0, *) {
            ContentUnavailableView {
                Label(title, systemImage: symbol)
            } description: {
                if let detail { Text(detail) }
            } actions: {
                actions
            }
        } else {
            VStack(spacing: 12) {
                Image(systemName: symbol).font(.largeTitle).foregroundStyle(Palette.muted)
                Text(title).font(.title2.bold()).foregroundStyle(Palette.foreground)
                if let detail { Text(detail).foregroundStyle(Palette.muted) }
                actions
            }
            .multilineTextAlignment(.center)
            .padding(24)
        }
    }
}

extension StatusView where Actions == EmptyView {
    init(symbol: String, title: String, detail: String? = nil) {
        self.init(symbol: symbol, title: title, detail: detail) { EmptyView() }
    }
}

extension View {
    /// Why the last write failed.
    func writeErrorAlert(_ model: AutofillModel) -> some View {
        alert(
            String(localized: "Something Went Wrong"),
            isPresented: Binding { model.writeError != nil } set: { if !$0 { model.writeError = nil } }
        ) {
            Button(String(localized: "OK")) {}
        } message: {
            Text(model.writeError ?? "")
        }
    }
}

struct AutofillView: View {
    @ObservedObject var model: AutofillModel

    var body: some View {
        NavigationStack {
            content
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Palette.background)
                .navigationBarTitleDisplayMode(.inline)
                .toolbarBackground(Palette.background, for: .navigationBar)
                .toolbar {
                    if case let .setup(_, done) = model.phase {
                        // Never leave the user waiting on Face ID or the store.
                        ToolbarItem(placement: done ? .confirmationAction : .cancellationAction) {
                            Button(done ? String(localized: "Done") : String(localized: "Skip")) { model.doneSettingUp() }
                        }
                    } else {
                        ToolbarItem(placement: .cancellationAction) {
                            CloseButton { model.cancel() }
                        }
                    }
                }
        }
        .tint(Palette.primary)
    }

    @ViewBuilder private var content: some View {
        switch model.phase {
        case .loading:
            ProgressView()
        case let .choosingVault(vaults):
            List(vaults) { vault in
                Button(vault.name) { model.choose(vault) }
                    .foregroundStyle(Palette.foreground)
                    .listRowBackground(Palette.row)
            }
            .scrollContentBackground(.hidden)
            .navigationTitle(String(localized: "Choose a Vault"))
        case let .locked(vault):
            StatusView(symbol: "lock.fill", title: String(localized: "Vault Locked")) {
                Button(String(localized: "Unlock with \(SharedVault.biometryName)")) { model.retry(vault) }
                    .buttonStyle(.borderedProminent)
            }
            .navigationTitle(vault.name)
        case .list:
            LoginList(model: model)
        case let .message(title, detail):
            StatusView(symbol: "exclamationmark.triangle", title: title, detail: detail)
        case let .saveChoice(candidates, newName, username):
            List {
                Section {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(username.isEmpty ? String(localized: "No Username") : username).font(.headline)
                        Text(newName).font(.subheadline).foregroundStyle(Palette.muted)
                    }
                    .foregroundStyle(Palette.foreground)
                }
                .listRowBackground(Palette.row)
                if !candidates.isEmpty {
                    Section {
                        ForEach(candidates) { login in
                            Button { model.saveLogin(updating: login) } label: {
                                LoginLabel(login: login)
                            }
                            .listRowBackground(Palette.row)
                        }
                    } header: {
                        Text(String(localized: "Update Password For")).foregroundStyle(Palette.muted)
                    }
                }
                Section {
                    Button(String(localized: "Save as New Login")) { model.saveLogin(updating: nil) }
                        .listRowBackground(Palette.row)
                }
            }
            .scrollContentBackground(.hidden)
            .navigationTitle(String(localized: "Save Password"))
        case let .setup(message, done):
            StatusView(
                symbol: done ? "checkmark.circle" : "key",
                title: done ? String(localized: "AutoFill Is Ready") : String(localized: "Setting Up AutoFill"),
                detail: message
            ) {
                if !done { ProgressView() }
            }
        }
    }
}

private struct LoginList: View {
    @ObservedObject var model: AutofillModel

    var body: some View {
        let results = AutofillLogins.search(model.logins, query: model.query)
        List {
            if model.query.isEmpty {
                if !model.suggested.isEmpty {
                    Section { rows(model.suggested) } header: { header(String(localized: "Suggested")) }
                }
                Section { rows(model.logins) } header: { header(String(localized: "All Logins")) }
            } else {
                rows(results)
            }
        }
        .scrollContentBackground(.hidden)
        .searchable(text: $model.query, prompt: String(localized: "Search Logins"))
        .navigationTitle(model.destination?.name ?? model.vaultName)
        .modifier(VaultSubtitle(model: model))
        .toolbar {
            // Text insertion has no website to save a login for.
            if model.kind != nil {
                ToolbarItem(placement: .primaryAction) {
                    Button { model.addLogin() } label: {
                        Label(String(localized: "New Login"), systemImage: "plus")
                    }
                }
            }
        }
        .overlay {
            if model.logins.isEmpty {
                StatusView(symbol: "key", title: String(localized: "No Logins"), detail: emptyDetail)
            } else if !model.query.isEmpty, results.isEmpty {
                if #available(iOS 17.0, *) { ContentUnavailableView.search(text: model.query) }
            }
        }
        .navigationDestination(isPresented: Binding { model.picked != nil } set: { if !$0 { model.picked = nil } }) {
            if let login = model.picked {
                if model.kind == nil {
                    InsertView(model: model, login: login)
                } else if let destination = model.destination {
                    ReviewView(model: model, login: login, destination: destination)
                }
            }
        }
        .sheet(isPresented: $model.isEditing) {
            NavigationStack { AddLoginView(model: model) }
                .interactiveDismissDisabled(model.draft != model.openedDraft)
                .preferredColorScheme(.dark)
        }
    }

    private var emptyDetail: String {
        switch model.kind {
        case .password: String(localized: "No logins with a password in this vault.")
        case .oneTimeCode: String(localized: "No logins with a verification code in this vault.")
        case nil: String(localized: "No logins in this vault.")
        }
    }

    private func header(_ title: String) -> some View {
        Text(title).foregroundStyle(Palette.muted)
    }

    private func rows(_ logins: [AutofillLogin]) -> some View {
        ForEach(logins) { login in
            Button { model.pick(login) } label: { LoginLabel(login: login) }
            .listRowBackground(Palette.row)
        }
    }
}

/// The vault under the website's name, on iOS 26.
private struct VaultSubtitle: ViewModifier {
    @ObservedObject var model: AutofillModel

    func body(content: Content) -> some View {
        if #available(iOS 26.0, *), model.destination != nil {
            content.navigationSubtitle(model.vaultName)
        } else {
            content
        }
    }
}

private struct LoginLabel: View {
    let login: AutofillLogin

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(login.name).foregroundStyle(Palette.foreground)
            if !login.username.isEmpty {
                Text(login.username).font(.subheadline).foregroundStyle(Palette.muted)
            }
            if login.isPending {
                Text(String(localized: "Not yet in your vault")).font(.caption).foregroundStyle(Palette.muted)
            }
        }
    }
}

/// Android's FillDecisionScreen and AssociationConsentScreen
/// (mobile/src/components/autofill/request-ui.tsx) as one screen: the
/// button that adds the website is the consent.
private struct ReviewView: View {
    @ObservedObject var model: AutofillModel
    let login: AutofillLogin
    let destination: FillDestination

    var body: some View {
        List {
            Section {
                row(symbol: "globe", title: destination.name, detail: String(localized: "This website"))
                row(
                    symbol: "key",
                    title: login.name,
                    detail: login.username.isEmpty ? String(localized: "No Username") : login.username
                )
            } footer: {
                if !destination.matches(login) {
                    Text(String(localized: "\(login.name) isn't saved for this website. Fill it only if you trust \(destination.name)."))
                }
            }
            .listRowBackground(Palette.row)
            if destination.isInsecure {
                Section {
                    Label {
                        Text(String(localized: "This website doesn't use a secure connection, so others on the network could see what you fill."))
                            .font(.subheadline).foregroundStyle(Palette.foreground)
                    } icon: {
                        Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.yellow)
                    }
                }
                .listRowBackground(Palette.row)
            }
        }
        .scrollContentBackground(.hidden)
        .background(Palette.background)
        .safeAreaInset(edge: .bottom) {
            VStack(spacing: 10) {
                Button { model.select(login) } label: {
                    Text(destination.canAssociate(login) ? String(localized: "Fill Once") : String(localized: "Fill Anyway"))
                        .foregroundStyle(Palette.background)
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(Palette.foreground)
                if destination.canAssociate(login) {
                    Button { model.addWebsiteAndFill(login) } label: {
                        Group {
                            if model.isWriting { ProgressView() } else { Text(String(localized: "Fill and Add Website")) }
                        }
                        .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                    .tint(Palette.foreground)
                }
            }
            .controlSize(.large)
            .disabled(model.isWriting)
            .padding(20)
        }
        .navigationTitle(String(localized: "Use This Login?"))
        .navigationBarBackButtonHidden(model.isWriting)
        .writeErrorAlert(model)
    }

    private func row(symbol: String, title: String, detail: String) -> some View {
        Label {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).foregroundStyle(Palette.foreground)
                Text(detail).font(.subheadline).foregroundStyle(Palette.muted)
            }
        } icon: {
            Image(systemName: symbol).foregroundStyle(Palette.muted)
        }
    }
}

/// Text insertion: which of the login's values to insert.
private struct InsertView: View {
    @ObservedObject var model: AutofillModel
    let login: AutofillLogin

    var body: some View {
        List {
            Section {
                if !login.username.isEmpty {
                    row(String(localized: "Username"), shown: login.username) { model.insert(login.username) }
                }
                if !login.password.isEmpty {
                    row(String(localized: "Password"), shown: String(repeating: "•", count: 8)) { model.insert(login.password) }
                        .accessibilityValue(String(localized: "Hidden"))
                }
                if let totp = login.totp {
                    TimelineView(.periodic(from: .now, by: 1)) { context in
                        let code = OneTimeCode.code(for: totp, at: context.date)
                        row(String(localized: "Verification Code"), shown: code ?? "") {
                            if let code = OneTimeCode.code(for: totp) { model.insert(code) }
                        }
                    }
                }
            } footer: {
                Text(String(localized: "Choose what to fill."))
            }
            .listRowBackground(Palette.row)
        }
        .scrollContentBackground(.hidden)
        .background(Palette.background)
        .navigationTitle(login.name)
    }

    private func row(_ title: String, shown: String, insert: @escaping () -> Void) -> some View {
        Button(action: insert) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.subheadline).foregroundStyle(Palette.muted)
                Text(shown).font(.body.monospaced()).foregroundStyle(Palette.foreground)
            }
        }
    }
}
