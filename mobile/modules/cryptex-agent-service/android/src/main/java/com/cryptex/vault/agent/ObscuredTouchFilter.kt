package com.cryptex.vault.agent

import android.os.Build
import android.view.KeyboardShortcutGroup
import android.view.Menu
import android.view.MotionEvent
import android.view.Window
import androidx.annotation.RequiresApi

/**
 * Decides which touches reach the approval screen while it is protected.
 *
 * filterTouchesWhenObscured drops only touches flagged FLAG_WINDOW_IS_OBSCURED (the touch point
 * itself is under another app's window). An overlay that covers the warnings but leaves the
 * Approve button bare yields FLAG_WINDOW_IS_PARTIALLY_OBSCURED instead (Android 10+), so both
 * flags end the gesture here. A gesture that picks up a flag partway is cancelled, and nothing
 * more of it gets through until a clean ACTION_DOWN starts the next one.
 */
internal class ObscuredTouchFilter {
  enum class Decision { PASS, DROP, CANCEL }

  companion object {
    // MotionEvent.FLAG_WINDOW_IS_PARTIALLY_OBSCURED, added in API 29; the system never sets
    // it on older versions.
    const val FLAG_PARTIALLY_OBSCURED = 0x2
    const val OBSCURED_FLAGS = MotionEvent.FLAG_WINDOW_IS_OBSCURED or FLAG_PARTIALLY_OBSCURED
  }

  // Touches and the toggle both run on the UI thread.
  var enabled = false
    set(value) {
      field = value
      blocking = false
      cancelled = false
    }

  // The current gesture was obscured at some point; drop the rest of it.
  private var blocking = false

  // Views below already saw ACTION_CANCEL for the blocked gesture.
  private var cancelled = false

  fun decide(actionMasked: Int, flags: Int): Decision {
    if (!enabled) return Decision.PASS
    val obscured = flags and OBSCURED_FLAGS != 0
    if (actionMasked == MotionEvent.ACTION_DOWN) {
      blocking = obscured
      // Nothing of this gesture reached the views yet; no cancel needed.
      cancelled = obscured
      return if (obscured) Decision.DROP else Decision.PASS
    }
    if (!blocking && !obscured) return Decision.PASS
    blocking = true
    if (cancelled) return Decision.DROP
    cancelled = true
    return Decision.CANCEL
  }
}

/** Wraps an activity's window callback so every touch goes through the filter first. */
internal class ObscuredTouchCallback(
  val base: Window.Callback,
  val filter: ObscuredTouchFilter = ObscuredTouchFilter(),
) : Window.Callback by base {
  override fun dispatchTouchEvent(event: MotionEvent): Boolean =
    when (filter.decide(event.actionMasked, event.flags)) {
      ObscuredTouchFilter.Decision.PASS -> base.dispatchTouchEvent(event)
      ObscuredTouchFilter.Decision.DROP -> true
      ObscuredTouchFilter.Decision.CANCEL -> {
        // A fresh event without the obscured flags: filterTouchesWhenObscured would drop a copy,
        // and the views would stay pressed.
        val cancel = MotionEvent.obtain(event.downTime, event.eventTime, MotionEvent.ACTION_CANCEL, event.x, event.y, event.metaState)
        try {
          base.dispatchTouchEvent(cancel)
        } finally {
          cancel.recycle()
        }
        true
      }
    }

  // Kotlin delegation skips Java default methods; forward these by hand. Android calls them
  // only on the versions that have them.
  @RequiresApi(Build.VERSION_CODES.N)
  override fun onProvideKeyboardShortcuts(data: MutableList<KeyboardShortcutGroup>?, menu: Menu?, deviceId: Int) =
    base.onProvideKeyboardShortcuts(data, menu, deviceId)

  @RequiresApi(Build.VERSION_CODES.O)
  override fun onPointerCaptureChanged(hasCapture: Boolean) = base.onPointerCaptureChanged(hasCapture)
}
