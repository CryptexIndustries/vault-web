package com.cryptex.vault.credentials

import android.app.Activity
import android.content.Intent
import android.os.SystemClock
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class CredentialCallerHandoffInstrumentedTest {
  @Test
  fun successfulResultResumesOriginalCallerPastUnrelatedTask() = verifyHandoff(Activity.RESULT_OK)

  @Test
  fun cancellationResumesOriginalCallerPastUnrelatedTask() = verifyHandoff(Activity.RESULT_CANCELED)

  @Test
  fun expiryCancellationKeepsHostInFront() = verifyHandoff(Activity.RESULT_CANCELED, false)

  private fun verifyHandoff(resultCode: Int, returnToCaller: Boolean = true) {
    val instrumentation = InstrumentationRegistry.getInstrumentation()
    val context = instrumentation.targetContext
    val activities = mutableListOf<Activity>()
    CredentialHandoffTestState.resumed = null
    CredentialHandoffTestState.resultCode = null
    CredentialHandoffTestState.resultValue = null
    fun launch(type: Class<out Activity>): Activity = instrumentation.startActivitySync(
      Intent(context, type).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_MULTIPLE_TASK)
    ).also { activities.add(it); instrumentation.waitForIdleSync() }
    try {
      val caller = launch(CredentialHandoffCallerActivity::class.java)
      val monitor = instrumentation.addMonitor(CredentialHandoffRelayActivity::class.java.name, null, false)
      val relay = try {
        instrumentation.runOnMainSync {
          caller.startActivityForResult(Intent(caller, CredentialHandoffRelayActivity::class.java), 73)
        }
        requireNotNull(instrumentation.waitForMonitorWithTimeout(monitor, 5000))
          .also { activities.add(it) }
      } finally {
        instrumentation.removeMonitor(monitor)
      }
      assertEquals(caller.taskId, relay.taskId)
      val unrelated = launch(CredentialHandoffUnrelatedActivity::class.java)
      val host = launch(CredentialHandoffHostActivity::class.java)
      assertNotEquals(caller.taskId, unrelated.taskId)
      assertNotEquals(caller.taskId, host.taskId)
      assertSame(host, CredentialHandoffTestState.resumed)

      val result = if (resultCode == Activity.RESULT_OK) {
        Intent().putExtra("result", "original-request-result")
      } else null
      instrumentation.runOnMainSync {
        // Optional mutation run proves these assertions reject the former provider behavior.
        if (InstrumentationRegistry.getArguments().getString("cryptex.handoffLegacy") == "true") {
          relay.setResult(resultCode, result)
          relay.finish()
          if (returnToCaller) host.moveTaskToBack(true)
        } else {
          finishCredentialRelay(relay, host, resultCode, result, returnToCaller)
        }
      }
      if (!returnToCaller) {
        instrumentation.waitForIdleSync()
        assertTrue(relay.isFinishing)
        assertSame(host, CredentialHandoffTestState.resumed)
        // Android may defer a background caller's result until it resumes.
        // First prove expiry leaves the host visible, then observe its cancellation.
        instrumentation.runOnMainSync { returnCredentialCallerToFront(caller) }
      }
      val deadline = SystemClock.uptimeMillis() + 5000
      while (SystemClock.uptimeMillis() < deadline &&
        (CredentialHandoffTestState.resultCode == null || CredentialHandoffTestState.resumed !== caller)) {
        SystemClock.sleep(25)
      }
      assertEquals(resultCode, CredentialHandoffTestState.resultCode)
      assertEquals(if (resultCode == Activity.RESULT_OK) "original-request-result" else null,
        CredentialHandoffTestState.resultValue)
      assertSame(caller, CredentialHandoffTestState.resumed)
    } finally {
      instrumentation.runOnMainSync { activities.asReversed().forEach { it.finishAndRemoveTask() } }
      instrumentation.waitForIdleSync()
    }
  }
}
