package com.cryptex.vault.agent

import android.view.MotionEvent
import com.cryptex.vault.agent.ObscuredTouchFilter.Decision
import org.junit.Assert.assertEquals
import org.junit.Test

class ObscuredTouchFilterTest {
  private val obscured = MotionEvent.FLAG_WINDOW_IS_OBSCURED
  private val partial = ObscuredTouchFilter.FLAG_PARTIALLY_OBSCURED

  private fun filter() = ObscuredTouchFilter().apply { enabled = true }

  @Test
  fun partiallyObscuredFlagMatchesAndroid() {
    assertEquals(MotionEvent.FLAG_WINDOW_IS_PARTIALLY_OBSCURED, partial)
  }

  @Test
  fun dropsPartiallyAndFullyObscuredTaps() {
    // Partial: an overlay covering the warnings but not the Approve button (Android 10 and 11).
    for (flags in listOf(partial, obscured)) {
      val filter = filter()
      assertEquals(Decision.DROP, filter.decide(MotionEvent.ACTION_DOWN, flags))
      assertEquals(Decision.DROP, filter.decide(MotionEvent.ACTION_UP, flags))
    }
  }

  @Test
  fun dropsTheRestOfAnObscuredGestureEvenOnceUncovered() {
    val filter = filter()
    assertEquals(Decision.DROP, filter.decide(MotionEvent.ACTION_DOWN, partial))
    assertEquals(Decision.DROP, filter.decide(MotionEvent.ACTION_MOVE, 0))
    assertEquals(Decision.DROP, filter.decide(MotionEvent.ACTION_UP, 0))
    // The next clean gesture goes through.
    assertEquals(Decision.PASS, filter.decide(MotionEvent.ACTION_DOWN, 0))
    assertEquals(Decision.PASS, filter.decide(MotionEvent.ACTION_UP, 0))
  }

  @Test
  fun cancelsAGestureThatBecomesObscuredOnce() {
    val filter = filter()
    assertEquals(Decision.PASS, filter.decide(MotionEvent.ACTION_DOWN, 0))
    assertEquals(Decision.CANCEL, filter.decide(MotionEvent.ACTION_MOVE, partial))
    assertEquals(Decision.DROP, filter.decide(MotionEvent.ACTION_MOVE, 0))
    assertEquals(Decision.DROP, filter.decide(MotionEvent.ACTION_UP, 0))
  }

  @Test
  fun passesCleanTouches() {
    val filter = filter()
    assertEquals(Decision.PASS, filter.decide(MotionEvent.ACTION_DOWN, 0))
    assertEquals(Decision.PASS, filter.decide(MotionEvent.ACTION_MOVE, 0))
    assertEquals(Decision.PASS, filter.decide(MotionEvent.ACTION_UP, 0))
  }

  @Test
  fun passesEverythingWhenOff() {
    val filter = filter()
    assertEquals(Decision.DROP, filter.decide(MotionEvent.ACTION_DOWN, partial))
    filter.enabled = false
    assertEquals(Decision.PASS, filter.decide(MotionEvent.ACTION_UP, partial))
    assertEquals(Decision.PASS, filter.decide(MotionEvent.ACTION_DOWN, obscured))
    // Turning it back on starts clean.
    filter.enabled = true
    assertEquals(Decision.PASS, filter.decide(MotionEvent.ACTION_DOWN, 0))
  }
}
