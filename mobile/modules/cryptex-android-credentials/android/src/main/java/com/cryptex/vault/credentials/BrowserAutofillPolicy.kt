package com.cryptex.vault.credentials

import java.net.IDN
import java.net.Inet6Address
import java.net.InetAddress
import java.net.URI
import java.util.Locale

internal data class BrowserWebsite(
  val scheme: String,
  val domain: String,
)

internal data class BrowserAddressBarCandidate(
  val resourceName: String?,
  val visible: Boolean,
  val values: List<String?>,
  val contentDescription: String? = null,
)

internal object BrowserAutofillPolicy {
  private val mozillaAddressBarIds = setOf(
    "mozac_browser_toolbar_url_view",
    "mozac_browser_toolbar_edit_url_view",
    "url_bar_title",
  )

  private val addressBarIdsByPackage = mapOf(
    "com.android.chrome" to setOf("url_bar"),
    "com.chrome.beta" to setOf("url_bar"),
    "com.chrome.canary" to setOf("url_bar"),
    "com.chrome.dev" to setOf("url_bar"),
    "com.brave.browser" to setOf("url_bar"),
    "com.brave.browser_beta" to setOf("url_bar"),
    "com.brave.browser_nightly" to setOf("url_bar"),
    "com.microsoft.emmx" to setOf("url_bar"),
    "com.microsoft.emmx.beta" to setOf("url_bar"),
    "com.microsoft.emmx.canary" to setOf("url_bar"),
    "com.microsoft.emmx.dev" to setOf("url_bar"),
    "com.sec.android.app.sbrowser" to setOf("location_bar_edit_text"),
    "com.sec.android.app.sbrowser.beta" to setOf("location_bar_edit_text"),
    "com.opera.browser" to setOf("url_field", "url_bar"),
    "com.opera.browser.beta" to setOf("url_field", "url_bar"),
    "com.opera.browser.canary" to setOf("url_field", "url_bar"),
    "com.vivaldi.browser" to setOf("url_bar"),
    "com.vivaldi.browser.snapshot" to setOf("url_bar"),
    "org.mozilla.firefox" to mozillaAddressBarIds,
    "org.mozilla.firefox_beta" to mozillaAddressBarIds,
    "org.mozilla.fenix" to mozillaAddressBarIds,
    "org.mozilla.focus" to mozillaAddressBarIds + "display_url",
    "com.duckduckgo.mobile.android" to setOf("omnibartextinput"),
    "org.torproject.torbrowser" to mozillaAddressBarIds,
    "com.kiwibrowser.browser" to setOf("url_bar"),
  )

  private val mozillaPackages = setOf(
    "org.mozilla.firefox",
    "org.mozilla.firefox_beta",
    "org.mozilla.fenix",
    "org.mozilla.focus",
    "org.torproject.torbrowser",
  )

  fun isKnownBrowser(packageName: String?): Boolean =
    packageName != null && addressBarIdsByPackage.containsKey(packageName)

  fun resolveWebsite(
    packageName: String?,
    candidates: Sequence<BrowserAddressBarCandidate>,
  ): BrowserWebsite? {
    packageName ?: return null
    val addressBarIds = addressBarIdsByPackage[packageName] ?: return null
    var website: BrowserWebsite? = null
    for (candidate in candidates) {
      if (!candidate.visible) continue
      val resourceName = candidate.resourceName?.lowercase(Locale.ROOT)
      if (addressBarIds.none { id -> resourceName == "$packageName:id/$id" }) continue
      val candidateWebsite = candidate.website(packageName in mozillaPackages) ?: continue
      if (website != null && website != candidateWebsite) {
        return null
      }
      website = candidateWebsite
    }
    return website
  }

  private fun BrowserAddressBarCandidate.website(
    useMozillaDescription: Boolean,
  ): BrowserWebsite? {
    if (useMozillaDescription) {
      val description = contentDescription
        ?.trim()
        ?.substringBefore(' ')
        ?.trimEnd('.')
      val isWebsite = description != null && (
        description.contains('.') ||
        description.equals("localhost", ignoreCase = true) ||
        (
          description.startsWith("localhost:", ignoreCase = true) &&
            description.substringAfterLast(':').let { port ->
              port.isNotEmpty() && port.all(Char::isDigit)
            }
        ) ||
        description.startsWith("http://", ignoreCase = true) ||
        description.startsWith("https://", ignoreCase = true) ||
        description.startsWith('[') && description.indexOf(']') > 1
      )
      if (isWebsite) parseWebsite(description)?.let { return it }
    }
    return values.firstNotNullOfOrNull(::parseWebsite)
  }

  internal fun parseWebsite(rawValue: String?): BrowserWebsite? {
    val value = rawValue?.trim()?.takeIf(String::isNotEmpty) ?: return null
    val explicitScheme = when {
      value.startsWith("http://", ignoreCase = true) -> "http"
      value.startsWith("https://", ignoreCase = true) -> "https"
      else -> null
    }
    // Browsers commonly hide the scheme. A bare host is not proof of HTTPS.
    val candidate = if (explicitScheme != null) value else "https://$value"
    return runCatching {
      val parsed = URI(candidate.replace(" ", "%20"))
      val parsedScheme = parsed.scheme?.lowercase(Locale.ROOT)
      if (parsedScheme != "http" && parsedScheme != "https") return@runCatching null
      val rawHost = parsed.host ?: parsed.authorityHost() ?: return@runCatching null
      val domain = normalizeHost(rawHost) ?: return@runCatching null
      BrowserWebsite(explicitScheme ?: "unknown", domain)
    }.getOrNull()
  }

  private fun URI.authorityHost(): String? {
    val authority = rawAuthority?.substringAfterLast('@') ?: return null
    if (authority.startsWith('[')) {
      val closingBracket = authority.indexOf(']')
      return authority.takeIf { closingBracket > 1 }?.substring(0, closingBracket + 1)
    }
    val colon = authority.lastIndexOf(':')
    return if (
      colon > 0 && authority.indexOf(':') == colon &&
      authority.substring(colon + 1).all(Char::isDigit)
    ) {
      authority.substring(0, colon)
    } else {
      authority
    }.takeIf(String::isNotEmpty)
  }

  private fun normalizeHost(rawHost: String): String? {
    val host = rawHost.trim().trimEnd('.').takeIf(String::isNotEmpty) ?: return null
    if (':' in host) {
      val literal = host.removePrefix("[").removeSuffix("]")
      if ('%' in literal) return null
      val address = runCatching { InetAddress.getByName(literal) }.getOrNull()
      return if (address is Inet6Address) "[${literal.lowercase(Locale.ROOT)}]" else null
    }
    return IDN.toASCII(host, IDN.USE_STD3_ASCII_RULES)
      .lowercase(Locale.ROOT)
      .takeIf { it.isNotEmpty() && it.length <= 253 }
  }
}
