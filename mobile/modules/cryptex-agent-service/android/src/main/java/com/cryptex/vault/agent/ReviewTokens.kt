package com.cryptex.vault.agent

import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * MainActivity is exported, so any app can start it with ACTION_REVIEW and a request ID.
 * Review PendingIntents carry an HMAC of the request ID under a per-install secret that only
 * this app knows; an ACTION_REVIEW without a matching token is ignored.
 */
internal object ReviewTokens {
  private const val SECRET_BYTES = 32

  fun newSecret(): ByteArray = ByteArray(SECRET_BYTES).also { SecureRandom().nextBytes(it) }

  fun token(secret: ByteArray, requestId: String): String {
    val mac = Mac.getInstance("HmacSHA256")
    mac.init(SecretKeySpec(secret, "HmacSHA256"))
    return mac.doFinal(requestId.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
  }

  fun matches(secret: ByteArray, requestId: String, token: String?): Boolean {
    if (token.isNullOrEmpty()) return false
    return MessageDigest.isEqual(
      token(secret, requestId).toByteArray(Charsets.US_ASCII),
      token.toByteArray(Charsets.US_ASCII),
    )
  }
}

/**
 * PendingIntent request codes for Review and Deny, one per request from a counter. Codes from
 * hashCode() can collide, and before API 29 (no Intent.setIdentifier) FLAG_UPDATE_CURRENT would
 * then point one notification's Review at another request. The next code is persisted, so a
 * restarted process doesn't reuse codes of notifications that are still shown.
 */
internal class RequestCodes(next: Int, private val persist: (Int) -> Unit) {
  companion object {
    const val FIRST = 1
    const val LAST = 1_000_000
    private const val REMEMBERED = 64
  }

  private var next = if (next in FIRST..LAST) next else FIRST
  private val codes = LinkedHashMap<String, Int>()

  /** The same request keeps its code, so re-posts update its own PendingIntents. */
  @Synchronized
  fun codeFor(requestId: String): Int {
    codes[requestId]?.let { return it }
    val code = next
    next = if (next >= LAST) FIRST else next + 1
    persist(next)
    codes[requestId] = code
    while (codes.size > REMEMBERED) codes.remove(codes.keys.first())
    return code
  }
}
