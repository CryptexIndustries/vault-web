import Foundation
import Testing
@testable import AutofillCore

@MainActor
@Test func dropsAnUnlockThatFinishesAfterCancel() async throws {
    let request = AutofillRequest()
    let (started, didStart) = AsyncStream<Void>.makeStream()
    let finish = DispatchSemaphore(value: 0)
    let unlock = Task {
        await request.run { () -> String in
            didStart.yield()
            finish.wait()
            return "the vault"
        }
    }
    for await _ in started { break }
    #expect(request.end())
    finish.signal()
    #expect(await unlock.value == nil)
    // Each request completes once.
    #expect(!request.end())
}

@MainActor
@Test func deliversAnUnlockWhileTheRequestIsOpen() async throws {
    let request = AutofillRequest()
    let result = await request.run { "the vault" }
    #expect(try result?.get() == "the vault")
}

private func lockFile() -> URL {
    FileManager.default.temporaryDirectory.appendingPathComponent("autofill-\(UUID().uuidString).lock")
}

@Test func waitsForTheOtherHolder() async throws {
    let url = lockFile()
    let app = try await FileLock.acquire(url, timeout: 1)
    await #expect(throws: TimedOut.self) { try await FileLock.acquire(url, timeout: 0.1) }
    app.release()
    let extensionLock = try await FileLock.acquire(url, timeout: 1)
    extensionLock.release()
}

@Test func keepsTheLockUntilALateOperationReturns() async throws {
    let url = lockFile()
    let (answer, answers) = AsyncStream<Void>.makeStream()
    // A store call that answers only after its caller gave up.
    let late = Task {
        try await withFileLock(url, timeout: 0.2) {
            for await _ in answer {}
            return "late"
        }
    }
    await #expect(throws: TimedOut.self) { try await late.value }
    await #expect(throws: TimedOut.self) { try await withFileLock(url, timeout: 0.2) { "newer" } }
    answers.finish()
    #expect(try await withFileLock(url, timeout: 1) { "newer" } == "newer")
}
