package com.cryptex.vault.agent

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RequestNotificationStateTest {
  private val timeout = 90_000L

  @Test
  fun namesTheAgentOnlyWhileUnlocked() {
    val state = RequestNotificationState(timeout)
    assertFalse(state.show("a", "laptop", vaultLocked = false, now = 0, phoneLocked = false).generic)
    assertTrue(state.show("b", "laptop", vaultLocked = false, now = 0, phoneLocked = true).generic)
  }

  @Test
  fun lockingRedactsNotificationsThatNameTheAgent() {
    // Posted while the user was in another app, then the phone locked.
    val state = RequestNotificationState(timeout)
    state.show("a", "laptop", vaultLocked = true, now = 0, phoneLocked = false)
    state.show("b", "server", vaultLocked = false, now = 1_000, phoneLocked = true)
    val reposts = state.onLocked(now = 10_000)
    assertEquals(listOf("a"), reposts.map { it.requestId })
    val repost = reposts.single()
    assertTrue(repost.generic)
    assertTrue(repost.silent)
    assertTrue(repost.vaultLocked)
    // The re-post keeps the original timeout.
    assertEquals(timeout - 10_000, repost.timeoutMs)
    // Already generic: nothing more to do on a second screen-off.
    assertTrue(state.onLocked(now = 11_000).isEmpty())
  }

  @Test
  fun redactsAgainAfterTheNameWasRestored() {
    // Posted while locked, revealed by unlocking, then the phone locked again.
    val state = RequestNotificationState(timeout)
    state.show("a", "laptop", vaultLocked = false, now = 0, phoneLocked = true)
    val restored = state.onUnlocked(now = 1_000)
    assertEquals(listOf("a"), restored.map { it.requestId })
    assertFalse(restored.single().generic)
    val redacted = state.onLocked(now = 2_000)
    assertEquals(listOf("a"), redacted.map { it.requestId })
    assertTrue(redacted.single().generic)
  }

  @Test
  fun staysGenericAfterScreenOffEvenIfAndroidStillReportsUnlocked() {
    // The broadcast came before the keyguard reported locked, or before a post finished.
    val state = RequestNotificationState(timeout)
    state.onLocked(now = 0)
    assertTrue(state.show("a", "laptop", vaultLocked = false, now = 1, phoneLocked = false).generic)
    state.onUnlocked(now = 2)
    assertFalse(state.show("b", "laptop", vaultLocked = false, now = 3, phoneLocked = false).generic)
  }

  @Test
  fun cancelledAndExpiredRequestsAreNotReposted() {
    val state = RequestNotificationState(timeout)
    state.show("a", "laptop", vaultLocked = false, now = 0, phoneLocked = false)
    state.show("b", "laptop", vaultLocked = false, now = 50_000, phoneLocked = false)
    state.cancel("b")
    assertTrue(state.onLocked(now = timeout + 1).isEmpty())
  }

  @Test
  fun aRepostAfterReviewIsSilentAndKeepsItsTimeout() {
    val state = RequestNotificationState(timeout)
    assertFalse(state.show("a", "laptop", vaultLocked = true, now = 0, phoneLocked = false).silent)
    state.cancel("a")
    val again = state.show("a", "laptop", vaultLocked = true, now = 30_000, phoneLocked = false)
    assertTrue(again.silent)
    assertEquals(timeout - 30_000, again.timeoutMs)
  }

  @Test
  fun adoptsANotificationLeftFromBeforeARestartAsGeneric() {
    // The process died with a named notification showing; the fresh state knows nothing of it.
    val state = RequestNotificationState(timeout)
    val adopted = state.adoptOrphan("a", postedAt = 0, now = 20_000)!!
    assertTrue(adopted.generic)
    assertTrue(adopted.silent)
    assertEquals(timeout - 20_000, adopted.timeoutMs)
    assertEquals(0L, adopted.postedAt)
    // Its name is gone: locking has nothing to change, unlocking leaves it generic.
    assertTrue(state.onLocked(now = 21_000).isEmpty())
    assertTrue(state.onUnlocked(now = 22_000).isEmpty())
    // A request JS shows again gets its name back and keeps the original timeout.
    val shown = state.show("a", "laptop", vaultLocked = false, now = 23_000, phoneLocked = false)
    assertFalse(shown.generic)
    assertTrue(shown.silent)
    assertEquals(timeout - 23_000, shown.timeoutMs)
  }

  @Test
  fun skipsKnownAndExpiredOrphans() {
    val state = RequestNotificationState(timeout)
    state.show("a", "laptop", vaultLocked = false, now = 0, phoneLocked = false)
    assertNull(state.adoptOrphan("a", postedAt = 0, now = 1_000))
    assertNull(state.adoptOrphan("b", postedAt = 0, now = timeout + 1))
  }
}
