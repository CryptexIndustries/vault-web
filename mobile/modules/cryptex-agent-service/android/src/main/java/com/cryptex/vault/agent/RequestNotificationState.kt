package com.cryptex.vault.agent

/**
 * Which request notifications are showing and whether each names its agent.
 *
 * The agent name shows only while the phone is unlocked. A request posted while the phone is
 * locked reads "Approval needed", whatever the user's lock screen setting, and gets its name
 * once the phone unlocks. Locking the phone turns the named ones back into "Approval needed".
 *
 * Not thread-safe: AgentNotifications holds its lock around every call and the posts that follow.
 */
internal class RequestNotificationState(private val timeoutMs: Long) {
  data class Post(
    val requestId: String,
    val agentName: String,
    val vaultLocked: Boolean,
    /** "Approval needed" without the agent name. */
    val generic: Boolean,
    val timeoutMs: Long,
    /** Only a request's first post alerts; re-posts and updates stay quiet. */
    val silent: Boolean,
    /** When the request first alerted; stored in the notification for adoptOrphan. */
    val postedAt: Long,
  )

  // agentName is null for a notification adopted after a restart: its name is gone, so it stays
  // generic.
  private data class Shown(val agentName: String?, val vaultLocked: Boolean, val postedAt: Long, val generic: Boolean)

  private val shown = LinkedHashMap<String, Shown>()

  // When each request first alerted. Kept after its notification is cancelled (Review opens the
  // app), so the re-post after the user backs out of unlock is silent and keeps its timeout.
  private val firstPosted = LinkedHashMap<String, Long>()

  // The screen went off and the phone hasn't been unlocked since. Covers the moment before the
  // keyguard reports locked, and a broadcast that arrives while a post is under way.
  private var locked = false

  private fun prune(now: Long) {
    firstPosted.entries.removeAll { now - it.value > timeoutMs }
    shown.entries.removeAll { now - it.value.postedAt > timeoutMs }
  }

  /** A request to show, with the phone's lock state as Android reports it right now. */
  fun show(requestId: String, agentName: String, vaultLocked: Boolean, now: Long, phoneLocked: Boolean): Post {
    prune(now)
    val earlier = firstPosted[requestId]
    if (earlier == null) firstPosted[requestId] = now
    val postedAt = earlier ?: now
    val generic = locked || phoneLocked
    shown[requestId] = Shown(agentName, vaultLocked, postedAt, generic)
    return Post(requestId, agentName, vaultLocked, generic, timeoutMs - (now - postedAt), silent = earlier != null, postedAt)
  }

  /**
   * A request notification Android still shows that this state doesn't know: posted before the
   * process died, so nothing here would redact it on the next lock. It is re-posted as "Approval
   * needed" and stays that way. Null if it is known already or past its timeout.
   */
  fun adoptOrphan(requestId: String, postedAt: Long, now: Long): Post? {
    prune(now)
    if (shown.containsKey(requestId)) return null
    val remaining = timeoutMs - (now - postedAt)
    if (remaining <= 0) return null
    if (!firstPosted.containsKey(requestId)) firstPosted[requestId] = postedAt
    shown[requestId] = Shown(null, vaultLocked = false, postedAt = postedAt, generic = true)
    return Post(requestId, "", vaultLocked = false, generic = true, timeoutMs = remaining, silent = true, postedAt = postedAt)
  }

  /**
   * The phone locked, or turned out to be locked right after a post: the notifications that
   * still name their agent, re-posted as "Approval needed". This doesn't ask Android which ones
   * are still showing: a notification posted a moment ago may not be listed yet, and missing it
   * would leave the name on the lock screen. One the user swiped away can come back, quietly,
   * until its timeout.
   */
  fun onLocked(now: Long): List<Post> {
    locked = true
    return repost(now, generic = true)
  }

  /** The phone unlocked: the notifications that hid their agent, re-posted with the name. */
  fun onUnlocked(now: Long): List<Post> {
    locked = false
    return repost(now, generic = false)
  }

  private fun repost(now: Long, generic: Boolean): List<Post> {
    prune(now)
    val posts = mutableListOf<Post>()
    for (entry in shown.entries) {
      val request = entry.value
      if (request.generic == generic || request.agentName == null) continue
      entry.setValue(request.copy(generic = generic))
      posts += Post(
        entry.key,
        request.agentName,
        request.vaultLocked,
        generic,
        timeoutMs - (now - request.postedAt),
        silent = true,
        postedAt = request.postedAt,
      )
    }
    return posts
  }

  fun cancel(requestId: String) {
    shown.remove(requestId)
  }
}
