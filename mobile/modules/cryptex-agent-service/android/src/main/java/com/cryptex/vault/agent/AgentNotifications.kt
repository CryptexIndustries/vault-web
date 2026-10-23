package com.cryptex.vault.agent

import android.annotation.SuppressLint
import android.app.Notification
import android.app.KeyguardManager
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.util.Log
import androidx.core.app.NotificationChannelCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

internal object AgentNotifications {
  private const val TAG = "CryptexAgentService"
  const val REQUEST_CHANNEL = "agent_requests"
  const val SERVICE_CHANNEL = "agent_service"
  const val SERVICE_NOTIFICATION_ID = 0x43414753
  const val ACTION_REVIEW = "com.cryptex.vault.agent.action.REVIEW"
  const val ACTION_DENY = "com.cryptex.vault.agent.action.DENY"
  const val EXTRA_REQUEST_ID = "com.cryptex.vault.agent.extra.REQUEST_ID"
  const val EXTRA_REVIEW_TOKEN = "com.cryptex.vault.agent.extra.REVIEW_TOKEN"
  private const val REQUEST_TAG_PREFIX = "cryptex_agent_request:"
  // When the request first alerted, so a restarted process can keep its timeout.
  private const val EXTRA_FIRST_POSTED = "com.cryptex.vault.agent.extra.FIRST_POSTED"
  private const val OPEN_APP_REQUEST_CODE = 0x43414700
  // Requests expire on the agent after 90 s; the notification should not outlive them.
  private const val REQUEST_TIMEOUT_MS = 90_000L
  private const val MAX_AGENT_NAME_LENGTH = 64

  private val icon get() = R.drawable.cryptex_agent_notification

  // Every decision and the notify calls that follow it hold the lock on state, so a
  // screen-off redaction can't land between a post choosing the name and Android showing it.
  private val state = RequestNotificationState(REQUEST_TIMEOUT_MS)

  /** Locked as far as notifications go: keyguard up, or the screen off (it may lock any moment). */
  private fun phoneLocked(context: Context): Boolean =
    keyguardLocked(context) || context.getSystemService(PowerManager::class.java)?.isInteractive == false

  private fun keyguardLocked(context: Context): Boolean =
    context.getSystemService(KeyguardManager::class.java)?.isKeyguardLocked == true

  fun ensureChannels(context: Context) {
    val manager = NotificationManagerCompat.from(context)
    manager.createNotificationChannel(
      NotificationChannelCompat.Builder(REQUEST_CHANNEL, NotificationManagerCompat.IMPORTANCE_HIGH)
        .setName(context.getString(R.string.cryptex_agent_requests_channel))
        .build(),
    )
    manager.createNotificationChannel(
      NotificationChannelCompat.Builder(SERVICE_CHANNEL, NotificationManagerCompat.IMPORTANCE_LOW)
        .setName(context.getString(R.string.cryptex_agent_service_channel))
        .setShowBadge(false)
        .build(),
    )
  }

  fun areRequestNotificationsEnabled(context: Context): Boolean {
    val manager = NotificationManagerCompat.from(context)
    if (!manager.areNotificationsEnabled()) return false
    val channel = manager.getNotificationChannelCompat(REQUEST_CHANNEL) ?: return true
    return channel.importance != NotificationManagerCompat.IMPORTANCE_NONE
  }

  private fun requestTag(requestId: String) = REQUEST_TAG_PREFIX + requestId

  // Notifications are told apart by their tag; the hash only fills the id slot.
  private fun requestNotificationId(requestId: String) = requestId.hashCode()

  @Volatile
  private var requestCodes: RequestCodes? = null

  /** PendingIntent request code for one request's Review and Deny (see RequestCodes). */
  private fun pendingIntentCode(context: Context, requestId: String): Int {
    val codes = requestCodes ?: synchronized(this) {
      requestCodes ?: RequestCodes(AgentPreferences.nextRequestCode(context)) {
        AgentPreferences.setNextRequestCode(context, it)
      }.also { requestCodes = it }
    }
    return codes.codeFor(requestId)
  }

  /** A Review intent came from one of this app's notifications. */
  fun isGenuineReview(context: Context, requestId: String, token: String?): Boolean =
    ReviewTokens.matches(AgentPreferences.reviewSecret(context), requestId, token)

  /** Agent names come from the paired computer; keep them to one short line. */
  private fun displayName(context: Context, agentName: String): String {
    val cleaned = agentName.filterNot { it.isISOControl() || it.category == CharCategory.FORMAT }
      .trim()
    if (cleaned.isEmpty()) return context.getString(R.string.cryptex_agent_unknown_agent)
    return if (cleaned.length > MAX_AGENT_NAME_LENGTH) cleaned.take(MAX_AGENT_NAME_LENGTH - 3).trimEnd() + "..." else cleaned
  }

  /** Explicit intent to the app's launcher activity. */
  private fun launchIntent(context: Context): Intent {
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
      ?: Intent(Intent.ACTION_MAIN).setPackage(context.packageName)
    return launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
  }

  fun openAppPendingIntent(context: Context): PendingIntent = PendingIntent.getActivity(
    context,
    OPEN_APP_REQUEST_CODE,
    launchIntent(context),
    PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
  )

  private fun reviewPendingIntent(context: Context, requestId: String): PendingIntent {
    val intent = Intent(ACTION_REVIEW)
      .setComponent(launchIntent(context).component)
      .setPackage(context.packageName)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      .putExtra(EXTRA_REQUEST_ID, requestId)
      .putExtra(EXTRA_REVIEW_TOKEN, ReviewTokens.token(AgentPreferences.reviewSecret(context), requestId))
    // No data URI here: Linking would treat it as a deep link. The identifier and the
    // request code each keep PendingIntents of different requests apart.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) intent.setIdentifier(requestTag(requestId))
    return PendingIntent.getActivity(
      context,
      pendingIntentCode(context, requestId),
      intent,
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
  }

  private fun denyPendingIntent(context: Context, requestId: String): PendingIntent {
    val intent = Intent(context, CryptexAgentDenyReceiver::class.java)
      .setAction(ACTION_DENY)
      .setPackage(context.packageName)
      .setData(Uri.fromParts("cryptex-agent-deny", requestId, null))
      .putExtra(EXTRA_REQUEST_ID, requestId)
    return PendingIntent.getBroadcast(
      context,
      pendingIntentCode(context, requestId),
      intent,
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
  }

  fun showRequest(context: Context, requestId: String, agentName: String, vaultLocked: Boolean) {
    synchronized(state) {
      val shown = state.show(requestId, agentName, vaultLocked, System.currentTimeMillis(), phoneLocked(context))
      post(context, shown)
      // The phone may have locked while this was being posted, before the screen-off broadcast.
      if (!shown.generic && phoneLocked(context)) redactNames(context)
    }
  }

  /** The screen went off: take the agent names off the notifications that show them. */
  fun onScreenOff(context: Context) {
    synchronized(state) { redactNames(context) }
  }

  // Callers hold the state lock.
  private fun redactNames(context: Context) {
    for (post in state.onLocked(System.currentTimeMillis())) post(context, post)
  }

  /** The screen came on. Within the lock delay the phone is still unlocked. */
  fun onScreenOn(context: Context) {
    if (!keyguardLocked(context)) onUserPresent(context)
  }

  /**
   * After the process restarted: request notifications Android still shows are unknown to the
   * fresh state, so a later screen-off couldn't redact them. Re-post them as "Approval needed".
   */
  fun reconcile(context: Context) {
    val active = try {
      context.getSystemService(NotificationManager::class.java)?.activeNotifications ?: return
    } catch (error: RuntimeException) {
      Log.w(TAG, "Could not read active request notifications", error)
      return
    }
    synchronized(state) {
      val now = System.currentTimeMillis()
      for (notification in active) {
        val tag = notification.tag ?: continue
        if (!tag.startsWith(REQUEST_TAG_PREFIX)) continue
        val requestId = tag.removePrefix(REQUEST_TAG_PREFIX)
        if (notification.id != requestNotificationId(requestId)) continue
        val postedAt = notification.notification.extras.getLong(EXTRA_FIRST_POSTED, notification.postTime)
        state.adoptOrphan(requestId, postedAt, now)?.let { post(context, it) }
      }
    }
  }

  /** The phone was unlocked: show the agent names the lock screen hid. */
  fun onUserPresent(context: Context) {
    synchronized(state) {
      for (post in state.onUnlocked(System.currentTimeMillis())) post(context, post)
    }
  }

  @SuppressLint("MissingPermission")
  private fun post(context: Context, request: RequestNotificationState.Post) {
    val (requestId, agentName, vaultLocked, generic, timeoutMs, silent, postedAt) = request
    if (timeoutMs <= 0) return
    ensureChannels(context)
    val manager = NotificationManagerCompat.from(context)
    if (!manager.areNotificationsEnabled()) return
    val publicVersion = NotificationCompat.Builder(context, REQUEST_CHANNEL)
      .setSmallIcon(icon)
      .setContentTitle(context.getString(R.string.cryptex_agent_request_public_title))
      .build()
    val review = reviewPendingIntent(context, requestId)
    val notification = NotificationCompat.Builder(context, REQUEST_CHANNEL)
      .setSmallIcon(icon)
      .setContentTitle(
        if (generic) context.getString(R.string.cryptex_agent_request_public_title)
        else context.getString(R.string.cryptex_agent_request_title, displayName(context, agentName)),
      )
      .setContentText(
        if (generic) null
        else context.getString(
          if (vaultLocked) R.string.cryptex_agent_request_locked else R.string.cryptex_agent_request_unlocked,
        ),
      )
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
      .setPublicVersion(publicVersion)
      .setAutoCancel(true)
      .setOnlyAlertOnce(true)
      .setSilent(silent)
      .setTimeoutAfter(timeoutMs)
      .addExtras(Bundle().apply { putLong(EXTRA_FIRST_POSTED, postedAt) })
      .setContentIntent(review)
      .addAction(0, context.getString(R.string.cryptex_agent_request_review), review)
      .addAction(0, context.getString(R.string.cryptex_agent_request_deny), denyPendingIntent(context, requestId))
      .build()
    try {
      manager.notify(requestTag(requestId), requestNotificationId(requestId), notification)
    } catch (error: SecurityException) {
      Log.w(TAG, "Request notification was not posted", error)
    }
  }

  fun cancelRequest(context: Context, requestId: String) {
    synchronized(state) {
      state.cancel(requestId)
      NotificationManagerCompat.from(context).cancel(requestTag(requestId), requestNotificationId(requestId))
    }
  }

  fun serviceNotification(context: Context): Notification {
    ensureChannels(context)
    return NotificationCompat.Builder(context, SERVICE_CHANNEL)
      .setSmallIcon(icon)
      .setContentTitle(context.getString(R.string.cryptex_agent_service_title))
      .setContentText(context.getString(R.string.cryptex_agent_service_text))
      .setContentIntent(openAppPendingIntent(context))
      .setOngoing(true)
      .setShowWhen(false)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
      .build()
  }
}
