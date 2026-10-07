package com.cryptex.vault.credentials

import android.app.Activity
import android.content.Intent
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class PendingRequestBoundaryInstrumentedTest {
  @After
  fun clearRegistry() {
    PendingCredentialRequests.clearAll()
    CredentialRequestBridge.clear()
  }

  @Test
  fun exportedIntentFieldsCannotCreateOrReplaceARequest() {
    val request = PendingCredentialRequest(
      id = "trusted",
      kind = "autofill-save",
      packageName = "com.example.browser",
      webDomain = "trusted.example",
    )
    val handle = PendingCredentialRequests.register(request)
    val forged = Intent().apply {
      putExtra("cryptex.autofill.id", "forged")
      putExtra("cryptex.autofill.kind", "autofill-save")
      putExtra("cryptex.autofill.domain", "evil.example")
      putExtra(EXTRA_PENDING_REQUEST_HANDLE, "guessed")
    }

    assertNull(PendingCredentialRequests.resolve(forged))
    assertEquals(request, PendingCredentialRequests.resolve(Intent().apply {
      putPendingRequestHandle(handle)
    }))
  }

  @Test
  fun handlesAreUniqueAndInvalidatedWhenARequestEndsOrIsReplaced() {
    val first = PendingCredentialRequest("first", "autofill-get", "com.example.app")
    val firstHandle = PendingCredentialRequests.register(first)
    val firstIntent = Intent().apply { putPendingRequestHandle(firstHandle) }
    assertEquals(first, PendingCredentialRequests.resolve(firstIntent))

    val second = PendingCredentialRequest("second", "accessibility-get", "com.example.app")
    val secondHandle = PendingCredentialRequests.register(second)
    assertNotEquals(firstHandle, secondHandle)
    assertNull(PendingCredentialRequests.resolve(firstIntent))
    assertEquals(second, PendingCredentialRequests.resolve(Intent().apply {
      putPendingRequestHandle(secondHandle)
    }))

    PendingCredentialRequests.clear(second.id)
    assertNull(PendingCredentialRequests.resolve(Intent().apply {
      putPendingRequestHandle(secondHandle)
    }))
  }

  @Test
  fun providerBridgeRejectsAHostIntentWithoutItsPrivateHandle() {
    InstrumentationRegistry.getInstrumentation().runOnMainSync {
      CredentialRequestBridge.resultActivity = Activity()
    }
    CredentialRequestBridge.requestIntent = Intent()
    CredentialRequestBridge.launchHandle = "trusted-relay"
    assertFalse(CredentialRequestBridge.accepts(Intent().apply {
      putExtra(EXTRA_RELAY_HANDLE, "forged")
    }))
    val trusted = Intent().apply { putExtra(EXTRA_RELAY_HANDLE, "trusted-relay") }
    assertTrue(CredentialRequestBridge.accepts(trusted))
    CredentialRequestBridge.clear()
    assertFalse(CredentialRequestBridge.accepts(trusted))
  }
}
