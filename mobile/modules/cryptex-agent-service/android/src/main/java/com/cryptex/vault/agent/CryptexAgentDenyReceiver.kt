package com.cryptex.vault.agent

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Deny from the notification. Works while the vault is locked and while JS is not running. */
class CryptexAgentDenyReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != AgentNotifications.ACTION_DENY) return
    val requestId = intent.getStringExtra(AgentNotifications.EXTRA_REQUEST_ID)
    if (requestId.isNullOrEmpty()) return
    AgentNotifications.cancelRequest(context, requestId)
    CryptexAgentServiceModule.record(context, PendingAgentActions.DENY, requestId)
  }
}
