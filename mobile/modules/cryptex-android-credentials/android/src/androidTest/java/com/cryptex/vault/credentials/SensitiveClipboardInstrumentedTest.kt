package com.cryptex.vault.credentials

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SensitiveClipboardInstrumentedTest {
  @Test
  fun clearsOnlyTheMarkedClip() {
    val instrumentation = InstrumentationRegistry.getInstrumentation()
    val context = instrumentation.targetContext
    val activity = instrumentation.startActivitySync(
      Intent(context, ClipboardTestActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    ) as ClipboardTestActivity
    instrumentation.waitForIdleSync()
    val clipboard = context.getSystemService(ClipboardManager::class.java)
    try {
      SensitiveClipboard.set(context, "owned secret")
      SensitiveClipboard.clearIfOwned()
      assertNotEquals("owned secret", clipboard.primaryClip?.takeIf { it.itemCount > 0 }
        ?.getItemAt(0)?.text?.toString())

      SensitiveClipboard.set(context, "another owned secret")
      clipboard.setPrimaryClip(ClipData.newPlainText("other app", "replacement"))
      assertNull(clipboard.primaryClipDescription?.extras
        ?.getString("com.cryptex.vault.secret_clip"))
      SensitiveClipboard.clearIfOwned()
      assertTrue(clipboard.hasPrimaryClip())
      assertEquals("replacement", clipboard.primaryClip?.getItemAt(0)?.text?.toString())
    } finally {
      activity.finish()
    }
  }
}
