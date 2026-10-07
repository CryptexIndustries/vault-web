package com.cryptex.vault.credentials

import android.content.ClipData
import android.content.ClipDescription
import android.content.ClipboardManager
import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PersistableBundle
import android.os.SystemClock
import java.util.UUID

/** Return true once the clip is cleared or another owner has replaced it. */
internal fun clearOwnedClipboardClip(
  expectedMarker: String,
  sdkInt: Int,
  readMarker: () -> String?,
  clearPrimaryClip: () -> Unit,
  replaceWithEmptyClip: () -> Unit,
): Boolean {
  val current = runCatching(readMarker).getOrNull() ?: return false
  if (current != expectedMarker) return true
  val cleared = runCatching {
    if (sdkInt >= Build.VERSION_CODES.P) clearPrimaryClip() else replaceWithEmptyClip()
  }.isSuccess
  if (!cleared) return false
  // A void clipboard operation can be ignored by Android. Keep ownership to retry.
  return runCatching { readMarker() != expectedMarker }.getOrDefault(false)
}

/** Clears only a clip still carrying our marker. Android may defer callbacks for a frozen app. */
internal object SensitiveClipboard {
  private const val MARKER_KEY = "com.cryptex.vault.secret_clip"
  private const val CLEAR_AFTER_MS = 30_000L
  private val handler = Handler(Looper.getMainLooper())
  private var marker: String? = null
  private var expiresAtElapsedMs = 0L
  private var context: Context? = null
  private val expiryAction = Runnable { clearIfExpired() }

  @Synchronized
  fun set(appContext: Context, text: String) {
    val token = UUID.randomUUID().toString()
    val clip = ClipData.newPlainText(null, text)
    clip.description.extras = PersistableBundle().apply {
      putBoolean(ClipDescription.EXTRA_IS_SENSITIVE, true)
      putString(MARKER_KEY, token)
    }
    appContext.getSystemService(ClipboardManager::class.java).setPrimaryClip(clip)
    context = appContext.applicationContext
    marker = token
    expiresAtElapsedMs = SystemClock.elapsedRealtime() + CLEAR_AFTER_MS
    handler.removeCallbacks(expiryAction)
    handler.postDelayed(expiryAction, CLEAR_AFTER_MS)
  }

  @Synchronized
  fun clearIfExpired() {
    if (marker == null || SystemClock.elapsedRealtime() < expiresAtElapsedMs) return
    clearIfOwned()
  }

  @Synchronized
  fun clearIfOwned() {
    val token = marker ?: return
    expiresAtElapsedMs = SystemClock.elapsedRealtime()
    val clipboard = context?.getSystemService(ClipboardManager::class.java) ?: return
    val released = clearOwnedClipboardClip(
      expectedMarker = token,
      sdkInt = Build.VERSION.SDK_INT,
      readMarker = { clipboard.primaryClipDescription?.extras?.getString(MARKER_KEY) },
      clearPrimaryClip = { clipboard.clearPrimaryClip() },
      replaceWithEmptyClip = { clipboard.setPrimaryClip(ClipData.newPlainText(null, "")) },
    )
    if (!released) return // Retry on resume if reads or clearing were denied.
    marker = null
    expiresAtElapsedMs = 0L
    handler.removeCallbacks(expiryAction)
    context = null
  }
}
