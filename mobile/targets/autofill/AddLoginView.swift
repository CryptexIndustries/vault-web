import SwiftUI
import UniformTypeIdentifiers

/// Android's item editor (mobile/src/components/vault/credential-form.tsx)
/// for a new login, without its strength meter and QR scanning: extensions
/// can't use the camera.
struct AddLoginView: View {
    enum Focus {
        case name
        case username
        case password
    }

    @ObservedObject var model: AutofillModel
    @FocusState private var focus: Focus?
    @State private var revealsPassword = false
    @State private var confirmingDiscard = false
    @State private var generating = false
    @State private var editingAuthenticator = false
    @State private var confirmingRemoval = false
    @State private var matching: LoginDraft.Website?
    @State private var moreDetails = false
    @State private var focusedOnOpen = false

    var body: some View {
        List {
            Section {
                labeled(String(localized: "Name"), shown: !model.draft.name.isEmpty) {
                    TextField(String(localized: "Name"), text: $model.draft.name)
                        .textInputAutocapitalization(.words)
                        .focused($focus, equals: .name)
                        .submitLabel(.next)
                        .onSubmit { focus = .username }
                }
                labeled(String(localized: "Username or Email"), shown: !model.draft.username.isEmpty) {
                    TextField(String(localized: "Username or Email"), text: $model.draft.username)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .focused($focus, equals: .username)
                        .submitLabel(.next)
                        .onSubmit { focus = .password }
                }
                labeled(String(localized: "Password"), shown: !model.draft.password.isEmpty) {
                    passwordField
                }
            } footer: {
                problem(.nameTooLong, String(localized: "Name is too long"))
            }
            .listRowBackground(Palette.row)

            Section {
                website($model.draft.website, label: String(localized: "Website"))
                ForEach($model.draft.additionalWebsites) { $website in
                    self.website($website, label: String(localized: "Additional Website"))
                }
                .onDelete { model.draft.additionalWebsites.remove(atOffsets: $0) }
                addRow(String(localized: "Add Website")) { model.draft.additionalWebsites.append(.init()) }
            } header: {
                Text(String(localized: "Websites"))
            } footer: {
                problem(.websiteInvalid, String(localized: "Enter a valid website, Android app, or safe wildcard pattern."))
            }
            .listRowBackground(Palette.row)

            Section {
                Picker(String(localized: "Directory"), selection: $model.draft.directoryId) {
                    Text(String(localized: "No Directory")).tag("")
                    ForEach(model.directories, id: \.id) { directory in Text(directory.name).tag(directory.id) }
                }
                .pickerStyle(.navigationLink)
                .foregroundStyle(Palette.foreground)
            }
            .listRowBackground(Palette.row)

            authenticatorSection

            Section {
                ForEach($model.draft.fields) { $field in FieldEditor(field: $field) }
                    .onDelete { model.draft.fields.remove(atOffsets: $0) }
                addRow(String(localized: "Add Field")) { model.draft.fields.append(.init()) }
            } header: {
                Text(String(localized: "Custom Fields"))
            }
            .listRowBackground(Palette.row)

            Section {
                DisclosureGroup(String(localized: "More Details"), isExpanded: $moreDetails) {
                    labeled(String(localized: "Tags"), shown: !model.draft.tags.isEmpty) {
                        TextField(String(localized: "Tags"), text: $model.draft.tags)
                            .textInputAutocapitalization(.never)
                        Text(String(localized: "Separate tags with commas. Search with tag:\"work\"."))
                            .font(.caption).foregroundStyle(Palette.muted)
                    }
                    labeled(String(localized: "Notes"), shown: !model.draft.notes.isEmpty) {
                        TextField(String(localized: "Notes"), text: $model.draft.notes, axis: .vertical).lineLimit(4...)
                    }
                }
                .foregroundStyle(Palette.foreground)
            }
            .listRowBackground(Palette.row)
        }
        .scrollContentBackground(.hidden)
        .scrollDismissesKeyboard(.interactively)
        .background(Palette.background)
        .disabled(model.isWriting)
        .navigationTitle(String(localized: "New Login"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                CloseButton {
                    if model.draft == model.openedDraft { model.isEditing = false } else { confirmingDiscard = true }
                }
                .disabled(model.isWriting)
            }
            ToolbarItem(placement: .confirmationAction) {
                if model.isWriting {
                    ProgressView().accessibilityLabel(String(localized: "Saving…"))
                } else {
                    ConfirmButton(title: String(localized: "Save")) { model.saveDraft() }
                        .disabled(CredentialURLMatching.jsTrim(model.draft.name).isEmpty)
                }
            }
        }
        .confirmationDialog(String(localized: "Discard Changes?"), isPresented: $confirmingDiscard, titleVisibility: .visible) {
            Button(String(localized: "Discard"), role: .destructive) { model.isEditing = false }
            Button(String(localized: "Keep Editing"), role: .cancel) {}
        } message: {
            Text(String(localized: "Your unsaved changes will be lost."))
        }
        .writeErrorAlert(model)
        .sheet(isPresented: $generating) {
            GeneratorSheet { model.draft.password = $0 }
        }
        .sheet(isPresented: $editingAuthenticator) {
            AuthenticatorSheet(authenticator: $model.draft.authenticator)
        }
        .sheet(item: $matching) { website in
            MatchingSheet(website: websiteBinding(website.id))
        }
        .onAppear {
            // Name and website start from the page, so the username comes next.
            // Closing one of the form's sheets appears it again, so only once.
            guard !focusedOnOpen else { return }
            focusedOnOpen = true
            DispatchQueue.main.async { focus = model.draft.name.isEmpty ? .name : .username }
        }
    }

    private var passwordField: some View {
        HStack {
            Group {
                if revealsPassword {
                    TextField(String(localized: "Password"), text: $model.draft.password)
                } else {
                    SecureField(String(localized: "Password"), text: $model.draft.password)
                }
            }
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .focused($focus, equals: .password)
            .submitLabel(.done)
            if !model.draft.password.isEmpty {
                Button { revealsPassword.toggle() } label: { Image(systemName: revealsPassword ? "eye.slash" : "eye") }
                    .buttonStyle(.borderless)
                    .foregroundStyle(Palette.muted)
                    .accessibilityLabel(revealsPassword ? String(localized: "Hide Password") : String(localized: "Show Password"))
            }
            Button { generating = true } label: { Image(systemName: "wand.and.stars") }
                .buttonStyle(.borderless)
                .accessibilityLabel(String(localized: "Generate Password"))
        }
    }

    private var authenticatorSection: some View {
        Section {
            if let authenticator = model.draft.authenticator {
                Button { editingAuthenticator = true } label: { CodePreview(authenticator: authenticator) }
                    .accessibilityHint(String(localized: "Edits the verification code"))
                Button(String(localized: "Remove Verification Code"), role: .destructive) { confirmingRemoval = true }
                    .confirmationDialog(String(localized: "Remove Verification Code?"), isPresented: $confirmingRemoval, titleVisibility: .visible) {
                        Button(String(localized: "Remove"), role: .destructive) { model.draft.authenticator = nil }
                        Button(String(localized: "Keep"), role: .cancel) {}
                    } message: {
                        Text(String(localized: "This removes the key from this item when you save. It does not turn off two-step verification on the website."))
                    }
            } else {
                Button(String(localized: "Set Up Verification Code…")) { editingAuthenticator = true }
            }
        } footer: {
            problem(.labelTooLong, String(localized: "Label is too long"))
        }
        .listRowBackground(Palette.row)
    }

    @ViewBuilder private func problem(_ problem: LoginDraft.Problem, _ text: String) -> some View {
        if model.problem == problem {
            Text(text).foregroundStyle(Palette.primary)
        }
    }

    /// A field's name shows above it once it has a value, and as its
    /// placeholder before.
    private func labeled<Content: View>(_ title: String, shown: Bool, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            if shown { Text(title).font(.caption).foregroundStyle(Palette.muted) }
            content().foregroundStyle(Palette.foreground)
        }
    }

    private func addRow(_ title: String, add: @escaping () -> Void) -> some View {
        Button(action: add) {
            Label {
                Text(title).foregroundStyle(Palette.foreground)
            } icon: {
                Image(systemName: "plus.circle.fill").foregroundStyle(.white, .green)
            }
        }
    }

    private func website(_ website: Binding<LoginDraft.Website>, label: String) -> some View {
        let isApp = CredentialURLMatching.jsTrim(website.wrappedValue.url).lowercased().hasPrefix("androidapp:")
        let title = isApp ? String(localized: "Android App") : label
        return labeled(title, shown: !website.wrappedValue.url.isEmpty) {
            TextField(title, text: website.url)
                .keyboardType(.URL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .onChange(of: isApp) { if $0 { website.wrappedValue.matchMode = .exactHost } }
            if isApp {
                Text(String(localized: "Exact App Match")).font(.caption).foregroundStyle(Palette.muted)
            } else {
                let mode = MatchingSheet.label(website.wrappedValue.matchMode)
                Button { matching = website.wrappedValue } label: {
                    HStack(spacing: 4) {
                        Text(mode).font(.caption)
                        Image(systemName: "chevron.forward").font(.caption2)
                    }
                    .foregroundStyle(Palette.muted)
                }
                .buttonStyle(.borderless)
                .accessibilityLabel(String(localized: "Website Matching, \(mode)"))
            }
        }
    }

    private func websiteBinding(_ id: UUID) -> Binding<LoginDraft.Website> {
        Binding {
            ([model.draft.website] + model.draft.additionalWebsites).first { $0.id == id } ?? model.draft.website
        } set: { website in
            if model.draft.website.id == id {
                model.draft.website = website
            } else if let index = model.draft.additionalWebsites.firstIndex(where: { $0.id == id }) {
                model.draft.additionalWebsites[index] = website
            }
        }
    }
}

/// A hidden text field with a show button, as the app's Input.
private struct SecretField: View {
    let label: String
    @Binding var text: String
    @State private var revealed = false

    var body: some View {
        HStack {
            Group {
                if revealed { TextField(label, text: $text) } else { SecureField(label, text: $text) }
            }
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            if !text.isEmpty {
                Button { revealed.toggle() } label: { Image(systemName: revealed ? "eye.slash" : "eye") }
                    .buttonStyle(.borderless)
                    .foregroundStyle(Palette.muted)
                    .accessibilityLabel(revealed ? String(localized: "Hide \(label)") : String(localized: "Show \(label)"))
            }
        }
    }
}

/// The code the authenticator makes now, as the app's TotpField, with the
/// time left as a ring.
private struct CodePreview: View {
    let authenticator: LoginDraft.Authenticator

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            let credential = LoginDraft(name: "-", authenticator: authenticator).credential()
            let totp = (try? credential.get())?.vaultTotp
            let period = Int(totp?.period ?? 30)
            let left = period - Int(context.date.timeIntervalSince1970) % period
            let code = totp.flatMap { OneTimeCode.code(for: $0, at: context.date) } ?? "------"
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(code).font(.title2.monospacedDigit()).foregroundStyle(Palette.foreground)
                    Text(details).font(.caption).foregroundStyle(Palette.muted)
                }
                Spacer()
                ZStack {
                    Circle().stroke(Palette.muted.opacity(0.3), lineWidth: 3)
                    Circle()
                        .trim(from: 0, to: CGFloat(left) / CGFloat(period))
                        .stroke(Palette.primary, style: StrokeStyle(lineWidth: 3, lineCap: .round))
                        .rotationEffect(.degrees(-90))
                    Text("\(left)").font(.caption2.monospacedDigit()).foregroundStyle(Palette.muted)
                }
                .frame(width: 30, height: 30)
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(String(localized: "Verification Code"))
            .accessibilityValue(code)
        }
    }

    private var details: String {
        let settings = String(localized: "\(Int(authenticator.digits) ?? 6) digits") + ", "
            + String(localized: "\(Int(authenticator.period) ?? 30) seconds") + ", "
            + ["SHA1", "SHA256", "SHA512"][authenticator.algorithm]
        return authenticator.label.isEmpty ? settings : authenticator.label + "\n" + settings
    }
}

private struct FieldEditor: View {
    @Binding var field: LoginDraft.Field

    var body: some View {
        let name = field.name.isEmpty ? String(localized: "Field") : field.name
        VStack(alignment: .leading, spacing: 8) {
            TextField(String(localized: "Field Name"), text: $field.name)
            switch field.kind {
            case .boolean:
                Toggle(name, isOn: Binding { field.value == "true" } set: { field.value = $0 ? "true" : "false" })
                    .tint(Palette.primary)
            case .hidden:
                SecretField(label: String(localized: "Value"), text: $field.value)
                    .accessibilityLabel(String(localized: "\(name) value"))
            case .text:
                TextField(String(localized: "Value"), text: $field.value, axis: .vertical)
                    .lineLimit(3...)
                    .accessibilityLabel(String(localized: "\(name) value"))
            case .date:
                TextField(String(localized: "YYYY-MM-DD"), text: $field.value)
                    .accessibilityLabel(String(localized: "\(name) value"))
            }
            Picker(String(localized: "Type"), selection: $field.kind) {
                ForEach(LoginDraft.Field.Kind.allCases, id: \.self) { Text(Self.label($0)).tag($0) }
            }
            .pickerStyle(.menu)
            .font(.caption)
            .onChange(of: field.kind) { if $0 == .boolean { field.value = LoginDraft.booleanValue(field.value) } }
        }
        .foregroundStyle(Palette.foreground)
    }

    static func label(_ kind: LoginDraft.Field.Kind) -> String {
        switch kind {
        case .text: String(localized: "Text", comment: "Custom field type")
        case .hidden: String(localized: "Hidden", comment: "Custom field type")
        case .boolean: String(localized: "On/Off", comment: "Custom field type: a switch")
        case .date: String(localized: "Date", comment: "Custom field type")
        }
    }
}

private struct MatchingSheet: View {
    @Binding var website: LoginDraft.Website
    @Environment(\.dismiss) private var dismiss

    static func label(_ mode: CredentialURLMatchMode) -> String {
        switch mode {
        case .exactHost: String(localized: "This Host Only")
        case .domain: String(localized: "Related Domains")
        case .wildcard: String(localized: "Custom Pattern")
        }
    }

    private static let options: [(mode: CredentialURLMatchMode, description: String, example: String)] = [
        (.exactHost, String(localized: "Offer this item on this hostname, on any page."), "accounts.example.com"),
        (.domain, String(localized: "Include the base domain and its subdomains when they share one account."), "example.com, mail.example.com"),
        (.wildcard, String(localized: "Choose specific hostnames or paths using * and **."), "*.example.com, shop.example.com"),
    ]

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(Self.options, id: \.example) { option in
                        Button {
                            website.matchMode = option.mode
                            dismiss()
                        } label: {
                            HStack(alignment: .top, spacing: 12) {
                                VStack(alignment: .leading, spacing: 6) {
                                    Text(Self.label(option.mode)).foregroundStyle(Palette.foreground)
                                    Text(option.description).font(.caption).foregroundStyle(Palette.muted)
                                    Text(String(localized: "Example: \(option.example)")).font(.caption2.monospaced()).foregroundStyle(Palette.muted)
                                }
                                Spacer()
                                if option.mode == website.matchMode {
                                    Image(systemName: "checkmark").foregroundStyle(Palette.primary)
                                }
                            }
                        }
                        .accessibilityAddTraits(option.mode == website.matchMode ? .isSelected : [])
                    }
                } footer: {
                    Text(website.url.isEmpty
                        ? String(localized: "Choose when Cryptex Vault offers this item.")
                        : String(localized: "Choose when Cryptex Vault offers this item for \(website.url)."))
                }
                .listRowBackground(Palette.row)
            }
            .scrollContentBackground(.hidden)
            .background(Palette.background)
            .navigationTitle(String(localized: "Website Matching"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    CloseButton { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .preferredColorScheme(.dark)
    }
}

/// The verification code setup, from the key or a pasted otpauth:// link.
private struct AuthenticatorSheet: View {
    @Binding var authenticator: LoginDraft.Authenticator?
    @Environment(\.dismiss) private var dismiss
    @State private var draft = LoginDraft.Authenticator()
    @State private var advanced = false
    @State private var error: String?

    private var isLink: Bool {
        CredentialURLMatching.jsTrim(draft.secret).lowercased().hasPrefix("otpauth://")
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    TextField(String(localized: "Setup Key or Link"), text: $draft.secret, axis: .vertical)
                        .font(.body.monospaced())
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                        .onChange(of: draft.secret) { _ in error = nil }
                    TextField(String(localized: "Label (Optional)"), text: $draft.label)
                } footer: {
                    if let error {
                        Text(error).foregroundStyle(Palette.primary)
                    } else {
                        Text(String(localized: "Enter the setup key from the website, or paste its otpauth:// link."))
                            .foregroundStyle(Palette.muted)
                    }
                }
                .listRowBackground(Palette.row)
                .foregroundStyle(Palette.foreground)

                Section {
                    DisclosureGroup(String(localized: "Advanced Settings"), isExpanded: $advanced) {
                        number(String(localized: "Period in Seconds"), text: $draft.period)
                        number(String(localized: "Digits"), text: $draft.digits)
                        Picker(String(localized: "Algorithm"), selection: $draft.algorithm) {
                            Text(verbatim: "SHA1").tag(0)
                            Text(verbatim: "SHA256").tag(1)
                            Text(verbatim: "SHA512").tag(2)
                        }
                        .pickerStyle(.segmented)
                    }
                }
                .listRowBackground(Palette.row)
                .foregroundStyle(Palette.foreground)
            }
            .scrollContentBackground(.hidden)
            .background(Palette.background)
            .navigationTitle(String(localized: "Verification Code"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    CloseButton { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    ConfirmButton(title: String(localized: "Done")) {
                        // A link carries the key and its settings.
                        if isLink {
                            guard let totp = OneTimeCode.parseURI(CredentialURLMatching.jsTrim(draft.secret)) else {
                                error = String(localized: "This otpauth:// link isn't valid.")
                                return
                            }
                            let label = CredentialURLMatching.jsTrim(draft.label).isEmpty ? totp.label : draft.label
                            draft = .init(label: label, secret: totp.secret, period: String(totp.period), digits: String(totp.digits), algorithm: totp.algorithm)
                        }
                        guard let key = LoginDraft.setupKey(draft.secret) else {
                            error = String(localized: "Enter a setup key using letters A to Z and digits 2 to 7.")
                            return
                        }
                        draft.secret = key
                        authenticator = draft
                        dismiss()
                    }
                    .disabled(CredentialURLMatching.jsTrim(draft.secret).isEmpty)
                }
            }
            .onAppear { draft = authenticator ?? .init() }
        }
        .preferredColorScheme(.dark)
    }

    private func number(_ title: String, text: Binding<String>) -> some View {
        HStack {
            Text(title)
            Spacer()
            TextField(title, text: Binding { text.wrappedValue } set: { text.wrappedValue = $0.filter(\.isNumber) })
                .keyboardType(.numberPad)
                .multilineTextAlignment(.trailing)
                .frame(maxWidth: 80)
        }
    }
}

/// PasswordGeneratorDialog in mobile/src/components/vault/password-generator.tsx.
private struct GeneratorSheet: View {
    let use: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var options = PasswordGenerator.Options()
    @State private var password = ""
    @State private var copied = false

    var body: some View {
        NavigationStack {
            List {
                Section {
                    HStack(alignment: .top) {
                        Text(password.isEmpty ? String(localized: "Select at least one character type") : password)
                            .font(password.isEmpty ? .body : .title3.monospaced())
                            .foregroundStyle(password.isEmpty ? Palette.primary : Palette.foreground)
                            .textSelection(.enabled)
                            .accessibilityLabel(String(localized: "Generated Password"))
                            .accessibilityValue(password)
                        Spacer()
                        Button(action: regenerate) { Image(systemName: "arrow.clockwise") }
                            .buttonStyle(.borderless)
                            .accessibilityLabel(String(localized: "Regenerate Password"))
                        Button(action: copy) { Image(systemName: copied ? "checkmark" : "doc.on.doc") }
                            .buttonStyle(.borderless)
                            .disabled(password.isEmpty)
                            .accessibilityLabel(copied ? String(localized: "Copied") : String(localized: "Copy Password"))
                    }
                }
                .listRowBackground(Palette.row)

                Section {
                    Picker(String(localized: "Kind"), selection: $options.kind) {
                        Text(String(localized: "Random", comment: "Password generator mode")).tag(PasswordGenerator.Kind.random)
                        Text(String(localized: "Memorable", comment: "Password generator mode: passphrase of words")).tag(PasswordGenerator.Kind.memorable)
                    }
                    .pickerStyle(.segmented)
                    .onChange(of: options.kind) { options.length = $0 == .memorable ? 4 : 16 }
                    Stepper(value: $options.length, in: 4...128) {
                        HStack {
                            Text(options.kind == .memorable ? String(localized: "Words") : String(localized: "Length"))
                            Spacer()
                            Text("\(options.length)").monospacedDigit().foregroundStyle(Palette.muted)
                        }
                    }
                    if options.kind == .random {
                        Toggle(String(localized: "Lowercase"), isOn: $options.includeLowercase)
                        Toggle(String(localized: "Uppercase"), isOn: $options.includeUppercase)
                        Toggle(String(localized: "Numbers"), isOn: $options.includeNumbers)
                        Toggle(String(localized: "Symbols"), isOn: $options.includeSymbols)
                    } else {
                        Toggle(String(localized: "Capitalize Words"), isOn: $options.includeUppercase)
                        Toggle(String(localized: "Append Digits"), isOn: $options.includeNumbers)
                        Picker(String(localized: "Word Separator"), selection: $options.wordSeparator) {
                            Text(String(localized: "Space", comment: "Word separator: space character")).tag(PasswordGenerator.Separator.space)
                            Text(verbatim: "-").tag(PasswordGenerator.Separator.dash)
                            Text(verbatim: "_").tag(PasswordGenerator.Separator.underscore)
                            Text(String(localized: "None", comment: "Word separator: no separator")).tag(PasswordGenerator.Separator.none)
                        }
                    }
                }
                .tint(Palette.primary)
                .listRowBackground(Palette.row)
            }
            .foregroundStyle(Palette.foreground)
            .scrollContentBackground(.hidden)
            .background(Palette.background)
            .navigationTitle(String(localized: "Generate Password"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    CloseButton { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    ConfirmButton(title: String(localized: "Use Password")) {
                        use(password)
                        dismiss()
                    }
                    .disabled(password.isEmpty)
                }
            }
            .onAppear(perform: regenerate)
            .onChange(of: options) { _ in regenerate() }
        }
        .preferredColorScheme(.dark)
    }

    private func regenerate() {
        // Empty without a character type, which shows a prompt instead.
        password = PasswordGenerator.generate(options)
    }

    /// Like the extension's code copies: this device only, cleared after 30 seconds.
    private func copy() {
        UIPasteboard.general.setItems(
            [[UTType.utf8PlainText.identifier: password]],
            options: [.localOnly: true, .expirationDate: Date(timeIntervalSinceNow: 30)]
        )
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        copied = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { copied = false }
    }
}
