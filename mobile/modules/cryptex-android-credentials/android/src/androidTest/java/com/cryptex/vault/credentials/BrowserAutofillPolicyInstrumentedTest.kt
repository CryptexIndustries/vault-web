package com.cryptex.vault.credentials

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class BrowserAutofillPolicyInstrumentedTest {
  @Test
  fun packageQualifiedAddressBarResolvesOnAndroid() {
    val website = BrowserAutofillPolicy.resolveWebsite(
      "com.android.chrome",
      sequenceOf(
        BrowserAddressBarCandidate(
          resourceName = "com.android.chrome:id/url_bar",
          visible = true,
          values = listOf("https://accounts.example/login"),
        ),
      ),
    )

    assertEquals(BrowserWebsite("https", "accounts.example"), website)
  }

  @Test
  fun arbitraryHttpsHandlerCannotSupplyBrowserIdentity() {
    val website = BrowserAutofillPolicy.resolveWebsite(
      "com.example.https.handler",
      sequenceOf(
        BrowserAddressBarCandidate(
          resourceName = "com.example.https.handler:id/url_bar",
          visible = true,
          values = listOf("https://accounts.example"),
          contentDescription = "Address bar",
        ),
      ),
    )

    assertNull(website)
  }
}
