package com.cryptex.vault.agent

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Log
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.lang.ref.WeakReference

class CryptexAgentServiceModule : Module() {
  companion object {
    private const val TAG = "CryptexAgentService"
    private const val EVENT = "onNotificationAction"

    /** The module instance of the live JS runtime, if there is one. */
    @Volatile
    private var live: CryptexAgentServiceModule? = null

    /**
     * Stores a notification action and, when JS is listening, delivers it right away.
     * Otherwise it waits for takePendingActions().
     */
    fun record(context: Context, action: String, requestId: String) {
      val entry = PendingAgentActions.record(context.applicationContext, action, requestId) ?: return
      live?.deliver(context.applicationContext, entry)
    }
  }

  @Volatile
  private var observing = false

  // The approval screen's touch filter; read and written on the UI thread.
  private var touchCallback: WeakReference<ObscuredTouchCallback>? = null

  private val context get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private fun deliver(context: Context, entry: AgentAction) {
    if (!observing) return
    try {
      sendEvent(EVENT, entry.toMap())
      PendingAgentActions.remove(context, entry)
    } catch (error: Exception) {
      Log.w(TAG, "Notification action stays pending", error)
    }
  }

  /** Review taps open the app with ACTION_REVIEW; consume the extras once. */
  private fun handleReviewIntent(intent: Intent?) {
    if (intent?.action != AgentNotifications.ACTION_REVIEW) return
    val requestId = intent.getStringExtra(AgentNotifications.EXTRA_REQUEST_ID)
    val token = intent.getStringExtra(AgentNotifications.EXTRA_REVIEW_TOKEN)
    intent.removeExtra(AgentNotifications.EXTRA_REQUEST_ID)
    intent.removeExtra(AgentNotifications.EXTRA_REVIEW_TOKEN)
    intent.action = Intent.ACTION_MAIN
    if (requestId.isNullOrEmpty()) return
    val context = appContext.reactContext ?: return
    // MainActivity is exported: another app can send ACTION_REVIEW with any request ID.
    if (!AgentNotifications.isGenuineReview(context, requestId, token)) {
      Log.w(TAG, "Ignored a Review intent that didn't come from a request notification")
      return
    }
    AgentNotifications.cancelRequest(context, requestId)
    record(context, PendingAgentActions.REVIEW, requestId)
  }

  private fun startSettings(intent: Intent): Boolean {
    val activity = appContext.currentActivity
    return try {
      if (activity != null) {
        activity.startActivity(intent)
      } else {
        context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      }
      true
    } catch (_: ActivityNotFoundException) {
      false
    } catch (_: SecurityException) {
      false
    }
  }

  override fun definition() = ModuleDefinition {
    Name("CryptexAgentService")
    Events(EVENT)

    OnCreate {
      live = this@CryptexAgentServiceModule
      appContext.reactContext?.let {
        AgentNotifications.ensureChannels(it)
        // The service does this too; the app can start before it does.
        AgentNotifications.reconcile(it)
      }
      handleReviewIntent(appContext.currentActivity?.intent)
    }

    OnDestroy {
      observing = false
      if (live === this@CryptexAgentServiceModule) live = null
    }

    OnStartObserving(EVENT) { observing = true }

    OnStopObserving(EVENT) { observing = false }

    OnNewIntent { intent -> handleReviewIntent(intent) }

    // Cold start from a Review tap: the activity intent carries the request.
    OnActivityEntersForeground { handleReviewIntent(appContext.currentActivity?.intent) }

    Function("startService") {
      AgentPreferences.setEnabled(context, true)
      CryptexAgentForegroundService.start(context)
    }

    Function("stopService") {
      AgentPreferences.setEnabled(context, false)
      CryptexAgentForegroundService.stop(context)
    }

    Function("isServiceRunning") { CryptexAgentForegroundService.running }

    // The name the user sees in Settings > About phone, else the model.
    Function("getDeviceName") {
      val name = runCatching {
        Settings.Global.getString(context.contentResolver, Settings.Global.DEVICE_NAME)
      }.getOrNull()?.trim()
      if (name.isNullOrEmpty()) Build.MODEL else name
    }

    Function("showRequestNotification") { requestId: String, agentName: String, vaultLocked: Boolean ->
      AgentNotifications.showRequest(context, requestId, agentName, vaultLocked)
    }

    Function("cancelRequestNotification") { requestId: String ->
      AgentNotifications.cancelRequest(context, requestId)
    }

    Function("takePendingActions") { PendingAgentActions.takeAll(context).map { it.toMap() } }

    Function("areNotificationsEnabled") { AgentNotifications.areRequestNotificationsEnabled(context) }

    // The list page only. This app does not declare REQUEST_IGNORE_BATTERY_OPTIMIZATIONS.
    Function("openBatterySettings") {
      startSettings(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)) ||
        startSettings(
          Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null)),
        )
    }

    // The app's own notification settings, else its app info page.
    Function("openNotificationSettings") {
      val details = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null))
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        startSettings(
          Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName),
        ) || startSettings(details)
      } else {
        startSettings(details)
      }
    }

    // While the approval screen shows: drop touches that pass through, or land next to, another
    // app's window drawn on top (tapjacking), and hide other apps' overlays where Android allows
    // it (12+). The window callback filter covers partial overlays, which
    // filterTouchesWhenObscured lets through.
    Function("setApprovalScreenProtected") { enabled: Boolean ->
      val activity = appContext.currentActivity ?: return@Function
      activity.runOnUiThread {
        val window = activity.window
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) window.setHideOverlayWindows(enabled)
        window.decorView.filterTouchesWhenObscured = enabled
        if (enabled) {
          val current = window.callback
          val guard = when (current) {
            is ObscuredTouchCallback -> current
            null -> null
            else -> ObscuredTouchCallback(current).also { window.callback = it }
          }
          guard?.filter?.enabled = true
          touchCallback = guard?.let { WeakReference(it) }
        } else {
          // Turn off the one turned on, even if something has wrapped the callback since.
          (window.callback as? ObscuredTouchCallback)?.filter?.enabled = false
          touchCallback?.get()?.filter?.enabled = false
          touchCallback = null
        }
      }
    }
  }
}
