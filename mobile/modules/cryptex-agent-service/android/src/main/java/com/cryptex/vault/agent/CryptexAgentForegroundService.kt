package com.cryptex.vault.agent

import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat

/**
 * Special-use foreground service that keeps the process, and so the JS relay connection,
 * alive while at least one agent is approved on this phone. It owns no connection itself:
 * it keeps the CryptexAgentRuntime headless task running so JS timers keep firing with the
 * app in the background, and so JS can start again after Android restarts the service.
 */
class CryptexAgentForegroundService : Service() {
  companion object {
    private const val TAG = "CryptexAgentService"

    @Volatile
    var running = false
      private set

    fun start(context: Context) {
      try {
        ContextCompat.startForegroundService(context, Intent(context, CryptexAgentForegroundService::class.java))
      } catch (error: IllegalStateException) {
        // ForegroundServiceStartNotAllowedException (Android 12+) is an IllegalStateException.
        Log.w(TAG, "SSH agent service could not start from the background", error)
      } catch (error: SecurityException) {
        Log.w(TAG, "SSH agent service could not start", error)
      }
    }

    fun stop(context: Context) {
      context.stopService(Intent(context, CryptexAgentForegroundService::class.java))
    }
  }

  // Lock and unlock, for the agent names on request notifications. These actions can't be
  // declared in the manifest; listen while the service runs. SystemUI sends USER_PRESENT (not
  // the system UID), so the receiver must be exported; the actions are protected, so other apps
  // can't fake them.
  private val lockState = object : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
      when (intent.action) {
        Intent.ACTION_SCREEN_OFF -> AgentNotifications.onScreenOff(context)
        Intent.ACTION_SCREEN_ON -> AgentNotifications.onScreenOn(context)
        Intent.ACTION_USER_PRESENT -> AgentNotifications.onUserPresent(context)
      }
    }
  }

  override fun onCreate() {
    super.onCreate()
    running = true
    ContextCompat.registerReceiver(
      this,
      lockState,
      IntentFilter().apply {
        addAction(Intent.ACTION_SCREEN_OFF)
        addAction(Intent.ACTION_SCREEN_ON)
        addAction(Intent.ACTION_USER_PRESENT)
      },
      ContextCompat.RECEIVER_EXPORTED,
    )
    // A new service instance usually means a new process: nothing tracks the request
    // notifications the old one posted.
    AgentNotifications.reconcile(this)
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    // startForeground must come first, even when stopping right away, or a service started
    // with startForegroundService crashes the app.
    try {
      ServiceCompat.startForeground(
        this,
        AgentNotifications.SERVICE_NOTIFICATION_ID,
        AgentNotifications.serviceNotification(this),
        if (Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE else 0,
      )
    } catch (error: RuntimeException) {
      Log.w(TAG, "SSH agent service could not enter the foreground", error)
      stopSelf()
      return START_NOT_STICKY
    }
    if (!AgentPreferences.isEnabled(this)) {
      stopSelf()
      return START_NOT_STICKY
    }
    CryptexAgentHeadlessService.start(this)
    return START_STICKY
  }

  override fun onDestroy() {
    running = false
    runCatching { unregisterReceiver(lockState) }
    CryptexAgentHeadlessService.stop(this)
    super.onDestroy()
  }

  override fun onBind(intent: Intent?): IBinder? = null
}
