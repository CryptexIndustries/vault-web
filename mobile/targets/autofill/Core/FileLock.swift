import Foundation

/// An exclusive flock on a file in the App Group, which the app and the
/// extension both take, so their read-then-write steps don't interleave. The
/// system drops it if the process ends.
final class FileLock {
    /// Held by the app from merging the inbox until a rotated vault is stored,
    /// and by the extension while it checks its key and writes an inbox entry.
    static let inbox = "autofill-inbox.lock"
    /// Held around the identity store's list and replace.
    static let identityStore = "identity-store.lock"

    private var descriptor: Int32

    private init(_ descriptor: Int32) {
        self.descriptor = descriptor
    }

    deinit {
        release()
    }

    /// The lock file `name` in the App Group from the AppGroup key in
    /// Info.plist, which the app and the extension both have.
    static func url(_ name: String) -> URL? {
        (Bundle.main.object(forInfoDictionaryKey: "AppGroup") as? String)
            .flatMap { FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: $0) }?
            .appendingPathComponent(name)
    }

    /// Waits up to `timeout` seconds for the lock, then throws TimedOut.
    static func acquire(_ url: URL, timeout: Double) async throws -> FileLock {
        let descriptor = open(url.path, O_RDWR | O_CREAT | O_CLOEXEC, 0o600)
        guard descriptor >= 0 else { throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO) }
        let deadline = Date(timeIntervalSinceNow: timeout)
        while flock(descriptor, LOCK_EX | LOCK_NB) != 0 {
            guard errno == EWOULDBLOCK || errno == EINTR, Date() < deadline else {
                close(descriptor)
                throw TimedOut()
            }
            try? await Task.sleep(nanoseconds: 20_000_000)
        }
        return FileLock(descriptor)
    }

    func release() {
        guard descriptor >= 0 else { return }
        flock(descriptor, LOCK_UN)
        close(descriptor)
        descriptor = -1
    }
}

/// Runs `operation` under the lock, waiting up to `timeout` for the lock and
/// again for the operation. The lock stays held until a late operation
/// returns, so it can't overwrite a newer one.
func withFileLock<T>(_ url: URL, timeout: Double, _ operation: @escaping () async throws -> T) async throws -> T {
    let lock = try await FileLock.acquire(url, timeout: timeout)
    return try await withTimeout(seconds: timeout) {
        defer { lock.release() }
        return try await operation()
    }
}
