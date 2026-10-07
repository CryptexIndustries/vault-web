package com.cryptex.vault.credentials

import android.os.SystemClock
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.URL
import java.util.Locale
import javax.net.ssl.HttpsURLConnection
import org.json.JSONArray
import org.json.JSONTokener

/** Direct website association checks. No third-party API or persistent trust cache. */
internal object PasskeyAssetLinks {
  private const val RELATION = "delegate_permission/common.get_login_creds"
  private const val MAX_DOCUMENT_BYTES = 256 * 1024
  private const val MAX_INCLUDES = 10
  private const val REQUEST_BUDGET_MS = 10_000L
  private val domainLabel = Regex("[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?")
  private val fingerprint = Regex("(?:[0-9A-Fa-f]{2}:){31}[0-9A-Fa-f]{2}")

  fun verify(
    rpId: String,
    packageName: String,
    certificates: Set<String>,
    requireAllCertificates: Boolean = false,
    openConnection: (URL) -> HttpsURLConnection = { it.openConnection() as HttpsURLConnection },
    now: () -> Long = { SystemClock.elapsedRealtime() },
  ): Boolean {
    // An RP ID is a domain, never a URL, port, path, or credentials.
    if (rpId.length !in 1..253 || !rpId.split('.').all { domainLabel.matches(it) }) {
      throw IOException("Invalid relying-party domain")
    }
    require(certificates.isNotEmpty() && certificates.all { fingerprint.matches(it) })
    val expected = certificates.map { it.uppercase(Locale.US) }.toSet()
    val matched = mutableSetOf<String>()
    val deadline = now() + REQUEST_BUDGET_MS
    val pending = ArrayDeque<URL>()
    pending.add(URL("https://${rpId.lowercase(Locale.US)}/.well-known/assetlinks.json"))
    val visited = mutableSetOf<String>()
    var includes = 0

    while (pending.isNotEmpty()) {
      val url = pending.removeFirst()
      if (!visited.add(url.toExternalForm())) continue
      val statements = readStatements(url, deadline, openConnection, now)
      for (index in 0 until statements.length()) {
        val statement = statements.getJSONObject(index)
        val relations = statement.optJSONArray("relation")
        val target = statement.optJSONObject("target")
        if (relations != null && target != null &&
          (0 until relations.length()).any { relations.optString(it) == RELATION } &&
          target.optString("namespace") == "android_app" &&
          target.optString("package_name") == packageName
        ) {
          val published = target.optJSONArray("sha256_cert_fingerprints")
          if (published != null) {
            for (certificate in 0 until published.length()) {
              val value = published.optString(certificate)
              if (fingerprint.matches(value)) matched.add(value.uppercase(Locale.US))
            }
          }
        }
      }
      if (if (requireAllCertificates) matched.containsAll(expected) else expected.any { it in matched }) {
        return true
      }
      for (index in 0 until statements.length()) {
        val statement = statements.getJSONObject(index)
        if (!statement.has("include")) continue
        if (++includes > MAX_INCLUDES) throw IOException("Too many association includes")
        val included = URL(statement.getString("include"))
        // Only explicit HTTPS delegation; never follow HTTP redirects or send app identity.
        if (included.protocol != "https" || included.host.isEmpty() ||
          included.userInfo != null || included.ref != null
        ) throw IOException("Invalid association include")
        included.toURI() // Reject malformed URL characters before opening a connection.
        pending.add(included)
      }
    }
    return false
  }

  private fun readStatements(
    url: URL,
    deadline: Long,
    openConnection: (URL) -> HttpsURLConnection,
    now: () -> Long,
  ): JSONArray {
    fun remaining(): Int {
      val time = deadline - now()
      if (time <= 0) throw IOException("Association request timed out")
      return minOf(time, 5_000L).toInt()
    }
    val timeout = remaining()
    val connection = openConnection(url)
    try {
      connection.instanceFollowRedirects = false
      connection.useCaches = false
      connection.connectTimeout = timeout
      connection.readTimeout = timeout
      connection.setRequestProperty("Accept", "application/json")
      if (connection.responseCode != 200 ||
        connection.contentType?.substringBefore(';')?.trim()?.lowercase(Locale.US) != "application/json"
      ) throw IOException("Invalid association response")
      if (connection.contentLengthLong > MAX_DOCUMENT_BYTES) {
        throw IOException("Association document too large")
      }
      val output = ByteArrayOutputStream()
      connection.inputStream.use { input ->
        val buffer = ByteArray(4096)
        while (true) {
          connection.readTimeout = remaining()
          val count = input.read(buffer)
          if (count < 0) break
          if (output.size() + count > MAX_DOCUMENT_BYTES) {
            throw IOException("Association document too large")
          }
          output.write(buffer, 0, count)
        }
      }
      remaining()
      val json = Charsets.UTF_8.newDecoder()
        .decode(java.nio.ByteBuffer.wrap(output.toByteArray())).toString()
      // Bound the parser's own recursion, including syntax accepted by Android's JSONTokener.
      val parser = object : JSONTokener(json) {
        private var depth = 0
        override fun nextValue(): Any? {
          if (++depth > 32) throw IOException("Association nesting too deep")
          try { return super.nextValue() } finally { depth-- }
        }
      }
      val statements = parser.nextValue() as? JSONArray ?: throw IOException("Expected association array")
      if (parser.nextClean() != '\u0000') throw IOException("Trailing association data")
      return statements
    } finally {
      connection.disconnect()
    }
  }
}
