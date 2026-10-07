package com.cryptex.vault.credentials

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class BrowserAutofillPolicyTest {
  @Test
  fun `recognizes the supported browser packages only`() {
    assertTrue(BrowserAutofillPolicy.isKnownBrowser("com.android.chrome"))
    assertTrue(BrowserAutofillPolicy.isKnownBrowser("org.mozilla.firefox"))
    assertTrue(BrowserAutofillPolicy.isKnownBrowser("com.sec.android.app.sbrowser"))
    assertFalse(BrowserAutofillPolicy.isKnownBrowser("com.example.https.handler"))
  }

  @Test
  fun `resolves every supported browser through its package specific resource`() {
    val browserResources = mapOf(
      "com.android.chrome" to "url_bar",
      "com.chrome.beta" to "url_bar",
      "com.chrome.canary" to "url_bar",
      "com.chrome.dev" to "url_bar",
      "com.brave.browser" to "url_bar",
      "com.brave.browser_beta" to "url_bar",
      "com.brave.browser_nightly" to "url_bar",
      "com.microsoft.emmx" to "url_bar",
      "com.microsoft.emmx.beta" to "url_bar",
      "com.microsoft.emmx.canary" to "url_bar",
      "com.microsoft.emmx.dev" to "url_bar",
      "com.sec.android.app.sbrowser" to "location_bar_edit_text",
      "com.sec.android.app.sbrowser.beta" to "location_bar_edit_text",
      "com.opera.browser" to "url_field",
      "com.opera.browser.beta" to "url_field",
      "com.opera.browser.canary" to "url_field",
      "com.vivaldi.browser" to "url_bar",
      "com.vivaldi.browser.snapshot" to "url_bar",
      "org.mozilla.firefox" to "mozac_browser_toolbar_url_view",
      "org.mozilla.firefox_beta" to "mozac_browser_toolbar_url_view",
      "org.mozilla.fenix" to "mozac_browser_toolbar_url_view",
      "org.mozilla.focus" to "display_url",
      "com.duckduckgo.mobile.android" to "omnibarTextInput",
      "org.torproject.torbrowser" to "mozac_browser_toolbar_url_view",
      "com.kiwibrowser.browser" to "url_bar",
    )

    browserResources.forEach { (packageName, resourceId) ->
      assertEquals(
        "$packageName failed",
        BrowserWebsite("https", "example.com"),
        resolve(
          packageName = packageName,
          resourceName = "$packageName:id/$resourceId",
          text = "https://example.com/login",
        ),
      )
    }
  }

  @Test
  fun `requires the address bar resource to belong to the browser package`() {
    assertEquals(
      BrowserWebsite("https", "example.com"),
      resolve(
        packageName = "com.android.chrome",
        resourceName = "com.android.chrome:id/url_bar",
        text = "https://example.com/login",
      ),
    )
    assertNull(
      resolve(
        packageName = "com.android.chrome",
        resourceName = "com.attacker.app:id/url_bar",
        text = "https://example.com/login",
      ),
    )
  }

  @Test
  fun `rejects generic labels and hidden address bars`() {
    assertNull(
      BrowserAutofillPolicy.resolveWebsite(
        "com.android.chrome",
        sequenceOf(
          BrowserAddressBarCandidate(
            resourceName = "com.android.chrome:id/login_field",
            visible = true,
            values = listOf("https://example.com"),
            contentDescription = "Address bar",
          ),
        ),
      ),
    )
    assertNull(
      resolve(
        packageName = "com.android.chrome",
        resourceName = "com.android.chrome:id/url_bar",
        text = "https://example.com",
        visible = false,
      ),
    )
  }

  @Test
  fun `rejects conflicting address bar values`() {
    assertNull(
      BrowserAutofillPolicy.resolveWebsite(
        "com.android.chrome",
        sequenceOf(
          candidate("com.android.chrome:id/url_bar", "https://example.com"),
          candidate("com.android.chrome:id/url_bar", "https://attacker.example"),
        ),
      ),
    )
  }

  @Test
  fun `accepts duplicate values for one website`() {
    assertEquals(
      BrowserWebsite("unknown", "example.com"),
      BrowserAutofillPolicy.resolveWebsite(
        "com.android.chrome",
        sequenceOf(
          candidate("com.android.chrome:id/url_bar", "example.com/login"),
          candidate("com.android.chrome:id/url_bar", "example.com/account"),
        ),
      ),
    )
  }

  @Test
  fun `never infers HTTPS from a scheme-less address bar`() {
    assertEquals(
      BrowserWebsite("unknown", "localhost"),
      BrowserAutofillPolicy.parseWebsite("localhost:43110/login"),
    )
    assertNull(
      BrowserAutofillPolicy.resolveWebsite(
        "com.android.chrome",
        sequenceOf(
          candidate("com.android.chrome:id/url_bar", "example.com/login"),
          candidate("com.android.chrome:id/url_bar", "https://example.com/login"),
        ),
      ),
    )
  }

  @Test
  fun `uses the verified top level website for a field without an origin`() {
    val topLevel = BrowserWebsite("https", "example.com")

    assertTrue(websiteMatchesTarget(null, topLevel, topLevel))
    assertFalse(
      websiteMatchesTarget(
        fieldWebsite = null,
        fallbackWebsite = topLevel,
        targetWebsite = BrowserWebsite("https", "frame.example"),
      ),
    )
  }

  @Test
  fun `preserves a field origin instead of replacing it with the top level website`() {
    val topLevel = BrowserWebsite("https", "example.com")
    val frame = BrowserWebsite("https", "frame.example")

    assertTrue(websiteMatchesTarget(frame, topLevel, frame))
    assertFalse(websiteMatchesTarget(frame, topLevel, topLevel))
    assertEquals("untrusted-web-context", browserFieldWarning(topLevel, frame, false))
  }

  @Test
  fun `requires review when the browser or receiving field website is unavailable`() {
    val website = BrowserWebsite("https", "example.com")

    assertEquals("unverified-field-origin", browserFieldWarning(website, website, true))
    assertEquals("unverified-field-origin", browserFieldWarning(null, website, false))
    assertNull(browserFieldWarning(website, website, false))
  }

  @Test
  fun `uses the known Mozilla address bar description format`() {
    assertEquals(
      BrowserWebsite("unknown", "accounts.example"),
      BrowserAutofillPolicy.resolveWebsite(
        "org.mozilla.firefox",
        sequenceOf(
          BrowserAddressBarCandidate(
            resourceName = "org.mozilla.firefox:id/mozac_browser_toolbar_url_view",
            visible = true,
            values = listOf("Firefox"),
            contentDescription = "accounts.example. Search or enter address",
          ),
        ),
      ),
    )
  }

  @Test
  fun `ignores a generic Mozilla address bar description`() {
    assertEquals(
      BrowserWebsite("https", "accounts.example"),
      BrowserAutofillPolicy.resolveWebsite(
        "org.mozilla.firefox",
        sequenceOf(
          BrowserAddressBarCandidate(
            resourceName = "org.mozilla.firefox:id/mozac_browser_toolbar_url_view",
            visible = true,
            values = listOf("https://accounts.example/login"),
            contentDescription = "Search or enter address",
          ),
        ),
      ),
    )
  }

  @Test
  fun `does not treat a Mozilla description label as a host`() {
    assertEquals(
      BrowserWebsite("https", "accounts.example"),
      BrowserAutofillPolicy.resolveWebsite(
        "org.mozilla.firefox",
        sequenceOf(
          BrowserAddressBarCandidate(
            resourceName = "org.mozilla.firefox:id/mozac_browser_toolbar_url_view",
            visible = true,
            values = listOf("https://accounts.example/login"),
            contentDescription = "Address: Search or enter address",
          ),
        ),
      ),
    )
  }

  @Test
  fun `parses ports unicode domains and IPv6 without retaining the port`() {
    assertEquals(
      BrowserWebsite("http", "example.com"),
      BrowserAutofillPolicy.parseWebsite("http://example.com:8080/login"),
    )
    assertEquals(
      BrowserWebsite("unknown", "xn--mnich-kva.example"),
      BrowserAutofillPolicy.parseWebsite("münich.example/login"),
    )
    assertEquals(
      BrowserWebsite("https", "[::1]"),
      BrowserAutofillPolicy.parseWebsite("https://[::1]:43110/login"),
    )
    assertEquals(
      BrowserWebsite("https", "example.com"),
      BrowserAutofillPolicy.parseWebsite("https://example.com/search?q=two words"),
    )
  }

  @Test
  fun `rejects pseudo schemes and malformed ports`() {
    assertNull(BrowserAutofillPolicy.parseWebsite("about:blank"))
    assertNull(BrowserAutofillPolicy.parseWebsite("example.com:not-a-port"))
  }

  private fun resolve(
    packageName: String,
    resourceName: String,
    text: String,
    visible: Boolean = true,
  ): BrowserWebsite? = BrowserAutofillPolicy.resolveWebsite(
    packageName,
    sequenceOf(candidate(resourceName, text, visible)),
  )

  private fun candidate(
    resourceName: String,
    text: String,
    visible: Boolean = true,
  ) = BrowserAddressBarCandidate(
    resourceName = resourceName,
    visible = visible,
    values = listOf(text),
  )
}
