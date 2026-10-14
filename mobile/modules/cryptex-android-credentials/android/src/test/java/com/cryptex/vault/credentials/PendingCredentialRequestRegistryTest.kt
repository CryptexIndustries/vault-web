package com.cryptex.vault.credentials

import org.junit.Assert.*
import org.junit.Test

class PendingCredentialRequestRegistryTest {
  private class Fixture {
    var now = 1_000L
    data class Timer(val token: Any, val due: Long, val action: () -> Unit)
    val timers = mutableListOf<Timer>()
    val registry = PendingCredentialRequestRegistry(
      now = { now },
      scheduleExpiry = { token, delay, action -> timers.add(Timer(token, now + delay, action)) },
      cancelExpiry = { token -> timers.removeAll { it.token === token } },
    )

    fun register(id: String = "request"): String = registry.register(PendingCredentialRequest(
      id, "autofill-save", "com.example.app", password = "captured secret", createdAtElapsedMs = now,
    ))
  }

  @Test fun expiryTimerDropsCapturedPayloadWithoutAnotherRequestOrResolution() {
    val fixture = Fixture()
    val handle = fixture.register()
    val timer = fixture.timers.single()
    fixture.now = timer.due
    timer.action()

    assertNull(fixture.registry.current)
    assertNull(fixture.registry.resolveHandle(handle))
    assertTrue(fixture.timers.isEmpty())
    // Identity permits exact relay cleanup, but cannot authorize completion.
    assertEquals("request", fixture.registry.requestIdForHandle(handle))
    assertTrue(fixture.registry.clear("request"))
    assertNull(fixture.registry.requestIdForHandle(handle))
  }

  @Test fun completionWindowIncludesItsLastMillisecond() {
    val fixture = Fixture()
    val handle = fixture.register()
    fixture.now += 60_000L
    assertNotNull(fixture.registry.resolveHandle(handle))
    fixture.now++
    assertNull(fixture.registry.resolveHandle(handle))
    assertNull(fixture.registry.current)
    assertTrue(fixture.timers.isEmpty())
  }

  @Test fun resolutionExpiresPayloadWhenAndroidDefersTheTimer() {
    val fixture = Fixture()
    val handle = fixture.register()
    fixture.now += 90_000L
    assertNull(fixture.registry.resolveHandle(handle))
    assertNull(fixture.registry.current)
    assertTrue(fixture.timers.isEmpty())
  }

  @Test fun deliveryRefreshesTheWindowAndOldCallbackCannotExpireIt() {
    val fixture = Fixture()
    val handle = fixture.register()
    val oldTimer = fixture.timers.single()
    fixture.now += 40_000L
    assertTrue(fixture.registry.markDelivered("request"))
    val refreshedTimer = fixture.timers.single()
    assertEquals(fixture.now + 60_001L, refreshedTimer.due)

    fixture.now = oldTimer.due
    oldTimer.action()
    assertNotNull(fixture.registry.resolveHandle(handle))
    assertEquals(refreshedTimer, fixture.timers.single())

    fixture.now = refreshedTimer.due
    refreshedTimer.action()
    assertNull(fixture.registry.current)
  }

  @Test fun oldCallbackAndHandleCannotClearAReplacementRequest() {
    val fixture = Fixture()
    val firstHandle = fixture.register("first")
    val oldTimer = fixture.timers.single()
    fixture.now += 20_000L
    val secondHandle = fixture.register("second")
    val secondTimer = fixture.timers.single()
    assertNotEquals(firstHandle, secondHandle)

    fixture.now = oldTimer.due
    oldTimer.action()
    assertNull(fixture.registry.resolveHandle(firstHandle))
    assertNull(fixture.registry.requestIdForHandle(firstHandle))
    assertFalse(fixture.registry.clear("first"))
    assertEquals("second", fixture.registry.resolveHandle(secondHandle)?.id)
    assertEquals(secondTimer, fixture.timers.single())
  }

  @Test fun deliveryCannotReviveAnExpiredRequestEvenBeforeItsTimerRuns() {
    val fixture = Fixture()
    val handle = fixture.register()
    fixture.now += 60_001L
    assertFalse(fixture.registry.markDelivered("request"))
    assertNull(fixture.registry.resolveHandle(handle))
    assertTrue(fixture.timers.isEmpty())
  }

  @Test fun clearingCancelsTheTimerAndInvalidatesTheHandle() {
    val fixture = Fixture()
    val handle = fixture.register()
    val oldTimer = fixture.timers.single()
    fixture.registry.clear()
    oldTimer.action()
    assertNull(fixture.registry.current)
    assertNull(fixture.registry.resolveHandle(handle))
    assertNull(fixture.registry.requestIdForHandle(handle))
    assertTrue(fixture.timers.isEmpty())
  }

  @Test fun earlyTimerCallbackRearmsForTheRemainingWindow() {
    val fixture = Fixture()
    val handle = fixture.register()
    val timer = fixture.timers.single()
    fixture.now += 1_000L
    timer.action()
    assertNotNull(fixture.registry.resolveHandle(handle))
    assertEquals(timer.due, fixture.timers.single().due)
  }

  @Test fun backwardsClockInvalidatesTheRequestInsteadOfExtendingIt() {
    val fixture = Fixture()
    val handle = fixture.register()
    fixture.now--
    assertNull(fixture.registry.resolveHandle(handle))
    assertFalse(fixture.registry.markDelivered("request"))
  }

  @Test fun wrongHandleCannotResolveOrIdentifyTheRequest() {
    val fixture = Fixture()
    val handle = fixture.register()
    assertNull(fixture.registry.resolveHandle("forged"))
    assertNull(fixture.registry.requestIdForHandle("forged"))
    assertNull(fixture.registry.resolveHandle(null))
    assertEquals("request", fixture.registry.resolveHandle(handle)?.id)
  }
}
