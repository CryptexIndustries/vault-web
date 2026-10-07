package com.cryptex.vault.credentials

import android.content.pm.PackageManager
import androidx.credentials.provider.CallingAppInfo
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.security.MessageDigest
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class PasskeyCallerInstrumentedTest {
  private val context = InstrumentationRegistry.getInstrumentation().targetContext
  private fun bundledList() = context.resources.openRawResource(R.raw.passkey_privileged_callers)
    .bufferedReader(Charsets.UTF_8).use { it.readText() }
  private val signingInfo get() = context.packageManager.getPackageInfo(
    context.packageName, PackageManager.GET_SIGNING_CERTIFICATES,
  ).signingInfo!!

  @Test fun bundledListIsAvailableWithoutANetworkRequest() {
    val apps = JSONObject(bundledList()).getJSONArray("apps")
    assertTrue(apps.length() > 0)
    for (index in 0 until apps.length()) {
      val info = apps.getJSONObject(index).getJSONObject("info")
      assertTrue(info.getString("package_name").isNotBlank())
      val signatures = info.getJSONArray("signatures")
      assertTrue(signatures.length() > 0)
      for (cert in 0 until signatures.length()) {
        val entry = signatures.getJSONObject(cert)
        assertTrue(entry.getString("build") in setOf("release", "userdebug"))
        assertTrue(Regex("(?:[0-9A-F]{2}:){31}[0-9A-F]{2}")
          .matches(entry.getString("cert_fingerprint_sha256")))
      }
    }
  }

  @Test fun bundledListRejectsForgedBrowserCertificatesAndUnknownPackages() {
    val apps = JSONObject(bundledList()).getJSONArray("apps")
    for (index in 0 until apps.length()) {
      val packageName = apps.getJSONObject(index).getJSONObject("info").getString("package_name")
      val caller = CallingAppInfo(packageName, signingInfo, "https://example.com")
      assertThrows(IllegalStateException::class.java) { caller.getOrigin(bundledList()) }
    }
    val unknown = CallingAppInfo("com.example.untrusted", signingInfo, "https://example.com")
    assertThrows(IllegalStateException::class.java) { unknown.getOrigin(bundledList()) }
  }

  @Test fun androidXStillRequiresBothThePackageAndCertificate() {
    val signature = signingInfo.apkContentsSigners.first()
    val fingerprint = MessageDigest.getInstance("SHA-256").digest(signature.toByteArray())
      .joinToString(":") { "%02X".format(it) }
    val list = JSONObject().put("apps", JSONArray().put(JSONObject().put("type", "android").put(
      "info", JSONObject().put("package_name", "com.example.trusted").put("signatures", JSONArray().put(
        JSONObject().put("build", "release").put("cert_fingerprint_sha256", fingerprint),
      )),
    ))).toString()
    assertEquals("https://example.com", CallingAppInfo("com.example.trusted", signingInfo,
      "https://example.com").getOrigin(list))
    assertThrows(IllegalStateException::class.java) {
      CallingAppInfo("com.example.other", signingInfo, "https://example.com").getOrigin(list)
    }
    assertThrows(IllegalStateException::class.java) {
      val otherSigningInfo = context.packageManager.getPackageInfo(
        "android", PackageManager.GET_SIGNING_CERTIFICATES,
      ).signingInfo!!
      CallingAppInfo("com.example.trusted", otherSigningInfo, "https://example.com").getOrigin(list)
    }
  }
}
