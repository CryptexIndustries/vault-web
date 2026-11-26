import Foundation

struct TimedOut: Error {}

/// Returns the operation's result, or throws TimedOut after `seconds`. An
/// operation that never returns (the identity store's when its service isn't
/// running) is abandoned rather than awaited, so callers always move on.
func withTimeout<T>(seconds: Double, _ operation: @escaping () async throws -> T) async throws -> T {
    let race = Race<T>()
    return try await withCheckedThrowingContinuation { continuation in
        race.start(continuation)
        race.timer = Task {
            try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
            race.finish(.failure(TimedOut()))
        }
        Task {
            do {
                race.finish(.success(try await operation()))
            } catch {
                race.finish(.failure(error))
            }
        }
    }
}

/// Resumes the continuation once, with whichever result comes first.
private final class Race<T> {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<T, Error>?
    var timer: Task<Void, Never>?

    func start(_ continuation: CheckedContinuation<T, Error>) {
        self.continuation = continuation
    }

    func finish(_ result: Result<T, Error>) {
        lock.lock()
        let continuation = self.continuation
        self.continuation = nil
        lock.unlock()
        timer?.cancel()
        continuation?.resume(with: result)
    }
}
