package com.cryptex.vault.credentials

import android.app.Activity
import android.app.ActivityManager
import android.content.Intent
import android.os.Bundle
import android.view.WindowManager
import androidx.credentials.provider.PendingIntentHandler
import java.util.UUID

internal const val EXTRA_RELAY_HANDLE = "cryptex.internal.relayHandle"

internal fun Intent.hasProviderCredentialRequest(): Boolean =
  PendingIntentHandler.retrieveBeginGetCredentialRequest(this) != null ||
    PendingIntentHandler.retrieveProviderGetCredentialRequest(this) != null ||
    PendingIntentHandler.retrieveProviderCreateCredentialRequest(this) != null

/**
 * Holds the activity that Credential Manager launched so results can be
 * delivered from wherever the request UI completes.
 */
object CredentialRequestBridge {
  @Volatile var resultActivity: Activity? = null
  @Volatile var requestIntent: Intent? = null
  @Volatile var launchHandle: String? = null

  fun accepts(intent: Intent): Boolean =
    resultActivity != null && requestIntent != null &&
      launchHandle != null && runCatching {
        intent.getStringExtra(EXTRA_RELAY_HANDLE)
      }.getOrNull() == launchHandle

  fun clear() {
    resultActivity = null
    requestIntent = null
    launchHandle = null
  }
}

/**
 * Relay activity for Credential Manager and autofill requests.
 *
 * Credential Manager launches this activity via the provider PendingIntent and
 * reads the response from its activity result. Results are silently dropped
 * for activities launched with [Intent.FLAG_ACTIVITY_NEW_TASK] or single-task
 * launch modes, so the app's main activity can never deliver them directly.
 * This activity stays in Credential Manager's result chain while the main app
 * handles the request and completes through [CredentialRequestBridge].
 */
class CredentialRequestActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
    super.onCreate(savedInstanceState)
    handleRequest()
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    handleRequest()
  }

  /**
   * Credential Manager re-launches this activity's PendingIntent while a
   * previous relay task may still be alive; delivery then lands in
   * onNewIntent instead of onCreate and must be re-handoffed to the main
   * app or the request silently dead-ends on a blank relay.
  */
  private fun handleRequest() {
    val autofillRequest = PendingCredentialRequests.resolve(intent)
    val hasProviderRequest = intent.hasProviderCredentialRequest()
    if (autofillRequest != null && !isRequestFresh(autofillRequest)) {
      PendingCredentialRequests.clear(autofillRequest.id)
      intent.replaceExtras(Bundle())
      intent.data = null
      setResult(RESULT_CANCELED)
      finish()
      return
    }
    if (autofillRequest == null && !hasProviderRequest) {
      setResult(RESULT_CANCELED)
      finish()
      return
    }
    val launch = packageManager.getLaunchIntentForPackage(packageName)
      ?: return
    if (!launch.isOwnedByPackage(packageName)) return
    if (autofillRequest != null) {
      launch.action = Intent.ACTION_VIEW
    }
    launch.data = intent.data
    val handle = UUID.randomUUID().toString()
    launch.putExtra(EXTRA_RELAY_HANDLE, handle)
    if (autofillRequest != null) {
      launch.putPendingRequestHandle(
        intent.getStringExtra(EXTRA_PENDING_REQUEST_HANDLE) ?: return,
      )
      PendingCredentialRequests.markDelivered(autofillRequest.id)
    } else {
      markRequestDelivered()
    }
    launch.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
    CredentialRequestBridge.resultActivity = this
    CredentialRequestBridge.requestIntent = intent
    CredentialRequestBridge.launchHandle = handle
    val mainTask = getSystemService(ActivityManager::class.java).appTasks.firstOrNull { task ->
      task.taskInfo.baseActivity == launch.component ||
        task.taskInfo.baseIntent.component == launch.component
    }
    startActivity(launch)
    // A repeated handoff can show MainActivity's saved frame while Android
    // leaves its task behind the translucent relay. Bring only Cryptex Vault's main
    // task forward; the caller/relay task stays intact for the final result.
    try {
      mainTask?.moveToFront()
    } catch (_: IllegalArgumentException) {
      // Android can remove a task between appTasks lookup and moveToFront().
    }
  }

  override fun onDestroy() {
    if (CredentialRequestBridge.resultActivity === this) {
      CredentialRequestBridge.clear()
    }
    super.onDestroy()
  }
}
