package com.cryptex.vault.credentials

import android.content.ComponentName
import android.content.Intent
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ApplicationIdentityInstrumentedTest {
  @Test fun launchMustBelongToTheSameInstalledProfile() {
    val production = "com.cryptexindustries.vault"
    val preprod = "$production.preprod"
    for ((own, foreign) in listOf(production to preprod, preprod to production)) {
      assertTrue(Intent().setComponent(ComponentName(own, "$own.MainActivity")).isOwnedByPackage(own))
      assertFalse(Intent().setComponent(ComponentName(foreign, "$foreign.MainActivity")).isOwnedByPackage(own))
      assertFalse(Intent(Intent.ACTION_VIEW).isOwnedByPackage(own))
    }
  }

  @Test fun credentialRoutesUseTheInstalledHostsSchemeWithoutChangingProviderPayload() {
    val context = InstrumentationRegistry.getInstrumentation().targetContext
    val query = "kind=provider-passkey-get&credentialId=fixture&requestId=42"
    val uri = context.cryptexCredentialRequestUri(query)
    assertEquals(context.getString(R.string.cryptex_app_scheme), uri.scheme)
    assertEquals("credential-request", uri.host)
    assertEquals("provider-passkey-get", uri.getQueryParameter("kind"))
    assertEquals("fixture", uri.getQueryParameter("credentialId"))
    assertEquals("42", uri.getQueryParameter("requestId"))
  }

  @Test fun libraryActivitiesBelongToTheHostEvenWhenTheirClassNamespaceDiffers() {
    val context = InstrumentationRegistry.getInstrumentation().targetContext
    val relay = CredentialRequestActivity::class.java.name
    assertFalse(relay.startsWith(context.packageName))
    assertTrue(context.isOwnActivityClass(relay))
    assertFalse(context.isOwnActivityClass("android.app.AlertDialog"))
    assertFalse(context.isOwnActivityClass("android.widget.Button"))
    assertFalse(context.isOwnActivityClass("com.cryptexindustries.vault.MainActivity"))
    assertFalse(context.isOwnActivityClass("com.cryptexindustries.vault.preprod.MainActivity"))
    assertFalse(context.isOwnActivityClass(null))
  }
}
