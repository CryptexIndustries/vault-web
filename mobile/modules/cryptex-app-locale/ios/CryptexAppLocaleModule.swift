import ExpoModulesCore

/// The app language chosen in Settings. It is the same value as the app's language in the
/// iOS Settings app; iOS's own text in the app follows it from the next launch.
public final class CryptexAppLocaleModule: Module {
    private static let key = "AppleLanguages"

    public func definition() -> ModuleDefinition {
        Name("CryptexAppLocale")

        /// The chosen language tag, or null to follow the device.
        Function("getAppLocale") { () -> String? in
            // UserDefaults.standard falls back to the device's languages; only the app's own
            // domain holds a choice.
            let defaults = UserDefaults.standard.persistentDomain(forName: Bundle.main.bundleIdentifier!)
            return (defaults?[Self.key] as? [String])?.first
        }

        AsyncFunction("setAppLocale") { (tag: String?) in
            if let tag {
                UserDefaults.standard.set([tag], forKey: Self.key)
            } else {
                UserDefaults.standard.removeObject(forKey: Self.key)
            }
        }
    }
}
