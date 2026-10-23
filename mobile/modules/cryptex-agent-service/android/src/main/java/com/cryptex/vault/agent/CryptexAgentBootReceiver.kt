package com.cryptex.vault.agent

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Restarts the service after a reboot or an app update, only when the user left it on.
 * Both actions are protected broadcasts, so other apps cannot send them.
 */
class CryptexAgentBootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != Intent.ACTION_BOOT_COMPLETED && intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
    if (!AgentPreferences.isEnabled(context)) return
    CryptexAgentForegroundService.start(context)
  }
}
