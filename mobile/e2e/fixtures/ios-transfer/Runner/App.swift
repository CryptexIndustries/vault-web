import SwiftUI

// UI test bundles need a host app. The tests only drive Cryptex Vault.
@main
struct TransferRunner: App {
  var body: some Scene {
    WindowGroup { EmptyView() }
  }
}
