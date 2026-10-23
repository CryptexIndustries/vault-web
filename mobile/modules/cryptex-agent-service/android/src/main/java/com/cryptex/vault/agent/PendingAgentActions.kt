package com.cryptex.vault.agent

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

internal data class AgentAction(val action: String, val requestId: String, val recordedAtMs: Long) {
  fun toMap(): Map<String, Any?> = mapOf("action" to action, "requestId" to requestId)
}

/**
 * Review and Deny taps that JS has not handled yet. Kept in memory and mirrored to
 * SharedPreferences, so a Deny tapped while no JS runtime exists survives until
 * takePendingActions(). Requests expire after 90 s, so entries older than 2 minutes are dropped.
 */
internal object PendingAgentActions {
  const val REVIEW = "review"
  const val DENY = "deny"
  private const val KEY = "pending_actions"
  private const val MAX_AGE_MS = 2 * 60 * 1000L
  private const val MAX_ENTRIES = 32

  private var cache: MutableList<AgentAction>? = null

  /** Adds an action unless the same requestId and action is already pending. */
  @Synchronized
  fun record(context: Context, action: String, requestId: String): AgentAction? {
    val entries = load(context)
    if (entries.any { it.action == action && it.requestId == requestId }) return null
    val entry = AgentAction(action, requestId, System.currentTimeMillis())
    entries.add(entry)
    while (entries.size > MAX_ENTRIES) entries.removeAt(0)
    save(context, entries)
    return entry
  }

  @Synchronized
  fun remove(context: Context, entry: AgentAction) {
    val entries = load(context)
    if (entries.remove(entry)) save(context, entries)
  }

  @Synchronized
  fun takeAll(context: Context): List<AgentAction> {
    val entries = load(context).toList()
    save(context, mutableListOf())
    return entries
  }

  private fun load(context: Context): MutableList<AgentAction> {
    val entries = cache ?: read(context).also { cache = it }
    val now = System.currentTimeMillis()
    // A clock moved backwards also counts as stale.
    if (entries.removeAll { now - it.recordedAtMs !in 0..MAX_AGE_MS }) save(context, entries)
    return entries
  }

  private fun read(context: Context): MutableList<AgentAction> {
    val raw = AgentPreferences.preferences(context).getString(KEY, null) ?: return mutableListOf()
    return try {
      val array = JSONArray(raw)
      MutableList(array.length()) { index -> array.getJSONObject(index) }
        .mapNotNull { item ->
          val action = item.optString("action")
          val requestId = item.optString("requestId")
          if ((action == REVIEW || action == DENY) && requestId.isNotEmpty()) {
            AgentAction(action, requestId, item.optLong("at"))
          } else null
        }
        .toMutableList()
    } catch (_: Exception) {
      mutableListOf()
    }
  }

  private fun save(context: Context, entries: MutableList<AgentAction>) {
    cache = entries
    val array = JSONArray()
    entries.forEach {
      array.put(JSONObject().put("action", it.action).put("requestId", it.requestId).put("at", it.recordedAtMs))
    }
    // commit, not apply: a Deny receiver's process can be killed right after onReceive.
    AgentPreferences.preferences(context).edit().putString(KEY, array.toString()).commit()
  }
}
