package com.cryptex.vault.agent

import android.content.Context
import android.content.SharedPreferences
import android.util.Base64

/** The "keep the approver running" switch, read again on boot and service restarts. */
internal object AgentPreferences {
  private const val FILE_NAME = "cryptex_agent_service"
  private const val ENABLED_KEY = "enabled"
  private const val REVIEW_SECRET_KEY = "review_secret"
  private const val NEXT_REQUEST_CODE_KEY = "next_request_code"

  fun preferences(context: Context): SharedPreferences =
    context.applicationContext.getSharedPreferences(FILE_NAME, Context.MODE_PRIVATE)

  fun isEnabled(context: Context): Boolean = preferences(context).getBoolean(ENABLED_KEY, false)

  fun setEnabled(context: Context, enabled: Boolean) {
    preferences(context).edit().putBoolean(ENABLED_KEY, enabled).commit()
  }

  /** The per-install key for Review tokens (ReviewTokens), created on first use. */
  @Synchronized
  fun reviewSecret(context: Context): ByteArray {
    val prefs = preferences(context)
    prefs.getString(REVIEW_SECRET_KEY, null)?.let { saved ->
      runCatching { Base64.decode(saved, Base64.NO_WRAP) }.getOrNull()?.takeIf { it.size == 32 }?.let { return it }
    }
    val secret = ReviewTokens.newSecret()
    prefs.edit().putString(REVIEW_SECRET_KEY, Base64.encodeToString(secret, Base64.NO_WRAP)).commit()
    return secret
  }

  fun nextRequestCode(context: Context): Int = preferences(context).getInt(NEXT_REQUEST_CODE_KEY, RequestCodes.FIRST)

  fun setNextRequestCode(context: Context, code: Int) {
    preferences(context).edit().putInt(NEXT_REQUEST_CODE_KEY, code).apply()
  }
}
