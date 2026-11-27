import Testing
@testable import AutofillCore

@Test func returnsAResultInTime() async throws {
    #expect(try await withTimeout(seconds: 5) { 42 } == 42)
}

@Test func passesOnAnError() async {
    struct Failed: Error {}
    await #expect(throws: Failed.self) { try await withTimeout(seconds: 5) { throw Failed() } }
}

/// Like the identity store when its service never starts: a call that never returns.
@Test func abandonsACallThatNeverReturns() async {
    await #expect(throws: TimedOut.self) {
        try await withTimeout(seconds: 0.05) {
            await withCheckedContinuation { (_: CheckedContinuation<Void, Never>) in }
        }
    }
}
