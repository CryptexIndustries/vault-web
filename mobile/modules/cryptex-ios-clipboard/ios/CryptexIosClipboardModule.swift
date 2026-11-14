import ExpoModulesCore
import UIKit
import UniformTypeIdentifiers

/// Clipboard writes. Secret copies skip Universal Clipboard and expire even while the app is
/// suspended.
public final class CryptexIosClipboardModule: Module {
    public func definition() -> ModuleDefinition {
        Name("CryptexIosClipboard")

        /// Returns a pasteboard type that marks this copy.
        AsyncFunction("setSecretString") { (text: String, expiresInMs: Double) -> String in
            let marker = "com.cryptex.vault.secret-clip.\(UUID().uuidString)"
            UIPasteboard.general.setItems(
                [[UTType.utf8PlainText.identifier: text, marker: Data([1])]],
                options: [
                    .localOnly: true,
                    .expirationDate: Date(timeIntervalSinceNow: expiresInMs / 1000),
                ]
            )
            return marker
        }.runOnQueue(.main)

        // On the main queue with the clear below, so a clear can't erase this copy.
        AsyncFunction("setString") { (text: String) in
            UIPasteboard.general.setItems([[UTType.utf8PlainText.identifier: text]])
        }.runOnQueue(.main)

        // Checks the types only: reading the contents would show iOS's paste prompt after
        // another app's copy.
        AsyncFunction("clearSecretIfOwned") { (marker: String) in
            guard UIPasteboard.general.contains(pasteboardTypes: [marker]) else { return }
            UIPasteboard.general.items = []
        }.runOnQueue(.main)
    }
}
