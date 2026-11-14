import Foundation

/// One request to the extension. Canceling and every completion end it, and
/// background work that finishes later, such as an unlock that was still
/// decrypting, is dropped, so an ended request can't fill, copy or save.
@MainActor
final class AutofillRequest {
    private(set) var hasEnded = false

    /// Ends the request. True only the first time, so each request completes once.
    func end() -> Bool {
        guard !hasEnded else { return false }
        hasEnded = true
        return true
    }

    /// Runs `work` off the main thread, as Face ID and the keychain block it.
    /// Nil when the request ended meanwhile.
    func run<T>(_ work: @escaping () throws -> T) async -> Result<T, Error>? {
        let result = await withCheckedContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                continuation.resume(returning: Result { try work() })
            }
        }
        return hasEnded ? nil : result
    }
}
