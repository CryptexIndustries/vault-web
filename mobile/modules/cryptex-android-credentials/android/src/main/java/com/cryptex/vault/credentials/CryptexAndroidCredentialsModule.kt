package com.cryptex.vault.credentials

import android.content.Intent
import android.content.ContentResolver
import android.content.ComponentName
import android.os.Bundle
import android.os.Build
import android.provider.Settings
import android.service.autofill.Dataset
import android.util.Base64
import android.util.Log
import android.view.autofill.AutofillManager
import android.view.autofill.AutofillValue
import androidx.credentials.CredentialManager
import androidx.annotation.RequiresApi
import androidx.credentials.CreatePasswordRequest
import androidx.credentials.CreatePasswordResponse
import androidx.credentials.CreatePublicKeyCredentialRequest
import androidx.credentials.CreatePublicKeyCredentialResponse
import androidx.credentials.GetCredentialResponse
import androidx.credentials.GetPasswordOption
import androidx.credentials.GetPublicKeyCredentialOption
import androidx.credentials.PasswordCredential
import androidx.credentials.PublicKeyCredential
import androidx.credentials.exceptions.domerrors.InvalidStateError
import androidx.credentials.exceptions.publickeycredential.CreatePublicKeyCredentialDomException
import androidx.credentials.provider.PendingIntentHandler
import androidx.credentials.provider.CallingAppInfo
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.security.MessageDigest

private const val BROWSER_PROVIDER_SUFFIX = ".AutofillThirdPartyModeContentProvider"
private const val BROWSER_PROVIDER_PATH = "autofill_third_party_mode"
private const val BROWSER_PROVIDER_COLUMN = "autofill_third_party_state"
private val BROWSER_INTEGRATIONS = listOf(
  Triple("com.android.chrome", "Chrome", "stable"),
  Triple("com.chrome.beta", "Chrome Beta", "beta"),
  Triple("com.brave.browser", "Brave", "stable"),
  Triple("com.vivaldi.browser", "Vivaldi", "stable"),
)

private fun providerRequestId(intent: Intent) =
  "provider-${intent.data?.getQueryParameter("requestId") ?: PendingCredentialRequests.requestDeliveredAtMs}"

class CryptexAndroidCredentialsModule : Module() {
  companion object {
    private const val TAG = "CryptexPasskey"
  }

  private data class OriginResolution(
    val origin: String? = null,
    val callerType: String,
    val errorCode: String? = null,
  ) {
    fun toMap(): Map<String, Any?> = mapOf(
      "origin" to origin,
      "callerType" to callerType,
      "errorCode" to errorCode,
    )
  }

  private val context get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private fun activeRequestIntent(): Intent {
    val hostIntent = appContext.throwingActivity.intent
    return if (CredentialRequestBridge.accepts(hostIntent)) {
      CredentialRequestBridge.requestIntent ?: hostIntent
    } else {
      hostIntent
    }
  }

  private fun activeProviderIntent(): Intent? =
    CredentialRequestBridge.requestIntent.takeIf {
      CredentialRequestBridge.accepts(appContext.throwingActivity.intent)
    }

  private fun isActiveProviderRequest(requestId: String): Boolean {
    val intent = activeProviderIntent() ?: return false
    return intent.hasProviderCredentialRequest() && isRequestFresh() && providerRequestId(intent) == requestId
  }

  private fun requestId(intent: Intent): String? {
    PendingCredentialRequests.requestId(intent)?.let { return it }
    if (intent !== activeProviderIntent()) return null
    return if (intent.hasProviderCredentialRequest()) providerRequestId(intent) else null
  }

  /** Clears only the consumed request. This also removes captured password extras. */
  private fun consumeRequest(requestId: String): Boolean {
    val active = activeRequestIntent()
    val hostIntent = appContext.throwingActivity.intent
    val authorizedHost = CredentialRequestBridge.accepts(hostIntent)
    val activeId = requestId(active)
    if (activeId != requestId) return false
    val scrub: (Intent?) -> Unit = { candidate ->
      if (candidate != null && requestId(candidate) == requestId) {
        candidate.replaceExtras(Bundle())
        candidate.data = null
        candidate.action = Intent.ACTION_MAIN
      }
    }
    scrub(active)
    if (authorizedHost && active !== hostIntent) {
      hostIntent.replaceExtras(Bundle())
      hostIntent.data = null
      hostIntent.action = Intent.ACTION_MAIN
    } else {
      scrub(hostIntent)
    }
    PendingCredentialRequests.clear(requestId)
    return true
  }

  /** Cancels the exact active request and closes its relay without touching a newer request. */
  private fun cancelActiveRequest(
    requestId: String,
    returnToCaller: Boolean = true,
  ): Boolean {
    val hostActivity = appContext.throwingActivity
    val relay = CredentialRequestBridge.resultActivity
    if (!consumeRequest(requestId)) return false
    CryptexAccessibilityService.cancelRequest(requestId)
    if (relay != null) {
      CredentialRequestBridge.clear()
      finishCredentialRelay(
        relay, hostActivity, android.app.Activity.RESULT_CANCELED,
        returnToCaller = returnToCaller,
      )
    } else if (!returnToCaller) {
      // Expiry discovered on resume must not close the app the user just opened.
      return true
    } else {
      hostActivity.moveTaskToBack(true)
    }
    return true
  }

  @RequiresApi(Build.VERSION_CODES.P)
  private fun providerOrigin(signingInfo: android.content.pm.SigningInfo): String {
    val certificate = signingInfo.apkContentsSigners.first().toByteArray()
    val hash = MessageDigest.getInstance("SHA-256").digest(certificate)
    return "android:apk-key-hash:${Base64.encodeToString(hash, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)}"
  }

  private fun containsWebOrigin(info: CallingAppInfo): Boolean = info.isOriginPopulated()

  @RequiresApi(Build.VERSION_CODES.P)
  private fun validatesAssetLink(rpId: String, info: CallingAppInfo): OriginResolution = try {
    val multipleSigners = info.signingInfo.hasMultipleSigners()
    val certificates = if (multipleSigners) {
      info.signingInfo.apkContentsSigners
    } else {
      info.signingInfo.signingCertificateHistory ?: info.signingInfo.apkContentsSigners
    }
    val fingerprints = certificates.map { certificate ->
      MessageDigest.getInstance("SHA-256")
        .digest(certificate.toByteArray())
        .joinToString(":") { "%02X".format(it) }
    }.toSet()
    val linked = PasskeyAssetLinks.verify(rpId, info.packageName, fingerprints, multipleSigners)
    if (linked) {
      OriginResolution(providerOrigin(info.signingInfo), "app")
    } else {
      OriginResolution(callerType = "app", errorCode = "PASSKEY_ASSET_LINK_NOT_FOUND")
    }
  } catch (error: Exception) {
    OriginResolution(
      callerType = "app",
      errorCode = when (error) {
        is NoSuchElementException, is IllegalArgumentException -> "PASSKEY_SIGNING_CERTIFICATE_INVALID"
        else -> "PASSKEY_ASSET_LINK_CHECK_FAILED"
      },
    )
  }

  private fun privilegedOrigin(info: CallingAppInfo): OriginResolution {
    val allowlist = try {
      context.resources.openRawResource(R.raw.passkey_privileged_callers)
        .bufferedReader(Charsets.UTF_8).use { it.readText() }
    } catch (_: Exception) {
      return OriginResolution(callerType = "browser", errorCode = "PASSKEY_BROWSER_ALLOWLIST_UNAVAILABLE")
    }
    return try {
      OriginResolution(info.getOrigin(allowlist), "browser")
    } catch (_: Exception) {
      OriginResolution(callerType = "browser", errorCode = "PASSKEY_BROWSER_NOT_TRUSTED")
    }
  }

  private fun validatedPasskeyOrigin(info: CallingAppInfo, rpId: String): OriginResolution {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) {
      return OriginResolution(callerType = "unknown", errorCode = "PASSKEY_PLATFORM_UNSUPPORTED")
    }
    if (containsWebOrigin(info)) return privilegedOrigin(info)
    return validatesAssetLink(rpId, info)
  }

  private fun finish(result: Intent, requestId: String): Boolean {
    val hostActivity = appContext.throwingActivity
    val relay = CredentialRequestBridge.resultActivity
      ?.takeIf { CredentialRequestBridge.accepts(hostActivity.intent) }
      ?: return false
    if (!consumeRequest(requestId)) return false
    CredentialRequestBridge.clear()
    finishCredentialRelay(relay, hostActivity, android.app.Activity.RESULT_OK, result)
    return true
  }

  override fun definition() = ModuleDefinition {
    Name("CryptexAndroidCredentials")
    Events("onCredentialRequest")

    OnNewIntent { intent ->
      appContext.throwingActivity.intent = intent
      val autofillRequest = PendingCredentialRequests.resolve(activeRequestIntent())
        ?.takeIf(::isRequestFresh)
      val providerIntent = activeProviderIntent()
      val hasProviderRequest = providerIntent?.hasProviderCredentialRequest() == true
      if (autofillRequest != null || hasProviderRequest) {
        if (hasProviderRequest) markRequestDelivered()
        sendEvent(
          "onCredentialRequest",
          mapOf("id" to (autofillRequest?.id ?: providerRequestId(providerIntent!!))),
        )
      }
    }

    Function("isAutofillEnabled") {
      Build.VERSION.SDK_INT >= 26 &&
        context.getSystemService(AutofillManager::class.java).hasEnabledAutofillServices()
    }

    Function("openAutofillSettings") {
      val intent = if (Build.VERSION.SDK_INT >= 26) {
        Intent(Settings.ACTION_REQUEST_SET_AUTOFILL_SERVICE).apply {
          data = android.net.Uri.parse("package:${context.packageName}")
        }
      } else Intent(Settings.ACTION_SETTINGS)
      appContext.throwingActivity.startActivity(intent)
    }

    Function("isAccessibilityAutofillEnabled") {
      val expected = CryptexAccessibilityService.componentName(context)
      Settings.Secure.getString(
        context.contentResolver,
        Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES,
      ).orEmpty().split(':').mapNotNull(ComponentName::unflattenFromString).any { it == expected }
    }

    Function("openAccessibilityAutofillSettings") {
      appContext.throwingActivity.startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
    }

    Function("isInlineSuggestionsEnabled") {
      AutofillPreferences.inlineSuggestionsEnabled(context)
    }

    Function("setInlineSuggestionsEnabled") { enabled: Boolean ->
      AutofillPreferences.setInlineSuggestionsEnabled(context, enabled)
    }

    Function("getBrowserAutofillIntegrations") {
      BROWSER_INTEGRATIONS.map { (packageName, label, channel) ->
        val uri = android.net.Uri.Builder()
          .scheme(ContentResolver.SCHEME_CONTENT)
          .authority(packageName + BROWSER_PROVIDER_SUFFIX)
          .path(BROWSER_PROVIDER_PATH)
          .build()
        var available = false
        var enabled = false
        runCatching {
          context.contentResolver.query(
            uri,
            arrayOf(BROWSER_PROVIDER_COLUMN),
            null,
            null,
            null,
          )?.use { cursor ->
            if (cursor.moveToFirst()) {
              val column = cursor.getColumnIndex(BROWSER_PROVIDER_COLUMN)
              if (column >= 0) {
                available = true
                enabled = cursor.getInt(column) != 0
              }
            }
          }
        }
        mapOf(
          "packageName" to packageName,
          "label" to label,
          "channel" to channel,
          "available" to available,
          "enabled" to enabled,
        )
      }
    }

    Function("openBrowserAutofillSettings") { packageName: String ->
      if (BROWSER_INTEGRATIONS.none { it.first == packageName }) return@Function false
      val intent = Intent(Intent.ACTION_APPLICATION_PREFERENCES).apply {
        addCategory(Intent.CATEGORY_DEFAULT)
        addCategory(Intent.CATEGORY_APP_BROWSER)
        addCategory(Intent.CATEGORY_PREFERENCE)
        setPackage(packageName)
      }
      if (intent.resolveActivity(context.packageManager) == null) return@Function false
      appContext.throwingActivity.startActivity(intent)
      true
    }

    Function("openCredentialProviderSettings") {
      if (Build.VERSION.SDK_INT < 34) return@Function false
      runCatching {
        CredentialManager.create(context).createSettingsPendingIntent().send()
      }.isSuccess
    }

    Function("isCredentialProviderAvailable") {
      Build.VERSION.SDK_INT >= 34
    }

    Function("getPendingRequest") {
      val activityIntent = activeRequestIntent()
      val providerIntent = activeProviderIntent()
      val requestedKind = activityIntent.data?.getQueryParameter("kind")
      val credentialId = activityIntent.data?.getQueryParameter("credentialId")
      val beginGet = providerIntent?.let(PendingIntentHandler::retrieveBeginGetCredentialRequest)
      val get = providerIntent?.let(PendingIntentHandler::retrieveProviderGetCredentialRequest)
      val create = providerIntent?.let(PendingIntentHandler::retrieveProviderCreateCredentialRequest)
      val hasProviderRequest = beginGet != null || get != null || create != null
      if (hasProviderRequest) {
        if (PendingCredentialRequests.requestDeliveredAtMs == 0L) markRequestDelivered()
        if (!isRequestFresh()) {
          cancelActiveRequest(
            providerRequestId(activityIntent),
            returnToCaller = false,
          )
          return@Function null
        }
      }
      val autofill = PendingCredentialRequests.resolve(activityIntent)
        .takeUnless { hasProviderRequest }
      if (!hasProviderRequest && autofill == null) {
        PendingCredentialRequests.requestId(activityIntent)?.let { expiredId ->
          cancelActiveRequest(expiredId, returnToCaller = false)
        }
      }
      if (autofill != null) {
        if (!isRequestFresh(autofill)) {
          cancelActiveRequest(
            autofill.id,
            returnToCaller = false,
          )
          return@Function null
        }
        mapOf(
          "id" to autofill.id,
          "kind" to autofill.kind,
          "packageName" to autofill.packageName,
          "applicationLabel" to autofill.applicationLabel,
          "webDomain" to autofill.webDomain,
          "webScheme" to autofill.webScheme,
          "warningType" to autofill.warningType,
          "username" to autofill.username,
          "email" to autofill.email,
          "password" to autofill.password,
        )
      } else {
        if (beginGet != null) {
          return@Function mapOf(
            "id" to providerRequestId(activityIntent),
            "kind" to "provider-unlock",
            "packageName" to beginGet.callingAppInfo?.packageName,
          )
        }
        if (get != null) {
          val option = when (requestedKind) {
            "provider-passkey-get" -> get.credentialOptions
              .firstOrNull { it is GetPublicKeyCredentialOption }
            "provider-password-get" -> get.credentialOptions
              .firstOrNull { it is GetPasswordOption }
            else -> get.credentialOptions.firstOrNull()
          }
          val kind = when (option) {
            is GetPublicKeyCredentialOption -> "provider-passkey-get"
            else -> "provider-password-get"
          }
          mapOf(
            "id" to providerRequestId(activityIntent),
            "kind" to (requestedKind ?: kind),
            "credentialId" to credentialId,
            "packageName" to get.callingAppInfo.packageName,
            "requestJson" to (option as? GetPublicKeyCredentialOption)?.requestJson,
            "clientDataHash" to (option as? GetPublicKeyCredentialOption)?.clientDataHash?.let {
              Base64.encodeToString(it, Base64.NO_WRAP)
            },
          )
        } else {
          val callingRequest = create?.callingRequest
          if (create == null || callingRequest == null) null else mapOf(
            "id" to providerRequestId(activityIntent),
            "kind" to when (callingRequest) {
              is CreatePublicKeyCredentialRequest -> "provider-passkey-create"
              else -> "provider-password-create"
            },
            "packageName" to create.callingAppInfo?.packageName,
            "username" to (callingRequest as? CreatePasswordRequest)?.id,
            "password" to (callingRequest as? CreatePasswordRequest)?.password,
            "requestJson" to (callingRequest as? CreatePublicKeyCredentialRequest)?.requestJson,
            "clientDataHash" to (callingRequest as? CreatePublicKeyCredentialRequest)?.clientDataHash?.let {
              Base64.encodeToString(it, Base64.NO_WRAP)
            },
          )
        }
      }
    }

    Function("setProviderCredentials") {
      credentials: List<Map<String, Any?>>, timeoutMinutes: Double ->
      val providerCredentials = credentials.mapNotNull { value ->
        val vaultId = value["vaultId"] as? String ?: return@mapNotNull null
        ProviderCredential(
          vaultId = vaultId,
          name = value["name"] as? String ?: "Credential",
          username = value["username"] as? String,
          rpId = value["rpId"] as? String,
          passkeyCredentialId = value["passkeyCredentialId"] as? String,
          passkeyDiscoverable = value["passkeyDiscoverable"] as? Boolean ?: false,
          passkeyUsername = value["passkeyUsername"] as? String,
          passkeyDisplayName = value["passkeyDisplayName"] as? String,
        )
      }
      ProviderCredentialCache.replace(providerCredentials, timeoutMinutes)
    }

    Function("clearProviderCredentials") {
      ProviderCredentialCache.clear()
    }

    Function("refreshProviderSession") { timeoutMinutes: Double ->
      ProviderCredentialCache.refresh(timeoutMinutes)
    }

    Function("backgroundProviderSession") { timeoutMinutes: Double ->
      ProviderCredentialCache.background(timeoutMinutes)
    }

    Function("resumeProviderSession") { timeoutMinutes: Double ->
      ProviderCredentialCache.resume(timeoutMinutes)
    }

    AsyncFunction("setSensitiveClipboardString") { text: String ->
      SensitiveClipboard.set(context, text)
    }

    Function("clearSensitiveClipboardIfOwned") {
      SensitiveClipboard.clearIfOwned()
    }

    Function("expireSensitiveClipboard") {
      SensitiveClipboard.clearIfExpired()
    }

    AsyncFunction("resolvePendingPasskeyOrigin") { rpId: String ->
      val activityIntent = activeProviderIntent() ?: return@AsyncFunction OriginResolution(
        callerType = "unknown",
        errorCode = "PASSKEY_CALLER_INFO_MISSING",
      ).toMap()
      val info = PendingIntentHandler.retrieveProviderGetCredentialRequest(activityIntent)
        ?.callingAppInfo
        ?: PendingIntentHandler.retrieveProviderCreateCredentialRequest(activityIntent)
          ?.callingAppInfo
        ?: return@AsyncFunction OriginResolution(
          callerType = "unknown",
          errorCode = "PASSKEY_CALLER_INFO_MISSING",
        ).toMap()
      val resolution = validatedPasskeyOrigin(info, rpId)
      if (resolution.errorCode != null) {
        Log.w(TAG, "Passkey origin resolution failed code=${resolution.errorCode} caller=${resolution.callerType}")
      }
      resolution.toMap()
    }

    AsyncFunction("resolvePendingWebOrigin") {
      val activityIntent = activeProviderIntent() ?: return@AsyncFunction null
      val info = PendingIntentHandler.retrieveProviderGetCredentialRequest(
        activityIntent,
      )?.callingAppInfo ?: return@AsyncFunction null
      privilegedOrigin(info).origin
    }

    Function("completeAutofill") {
      requestId: String, username: String, email: String, password: String ->
      val pending = PendingCredentialRequests.resolve(activeRequestIntent())
      if (
        pending == null || pending.id != requestId || pending.kind != "autofill-get" ||
        !isRequestFresh(pending) || !ProviderCredentialCache.isUnlocked()
      ) {
        PendingCredentialRequests.clear(requestId)
        return@Function false
      }
      val dataset = Dataset.Builder().apply {
        if (username.isNotEmpty()) {
          pending.usernameIds.distinct().forEach { setValue(it, AutofillValue.forText(username)) }
        }
        val emailValue = email.ifEmpty { username }
        if (emailValue.isNotEmpty()) {
          pending.emailIds.distinct().forEach { setValue(it, AutofillValue.forText(emailValue)) }
        }
        pending.passwordIds.distinct().forEach { setValue(it, AutofillValue.forText(password)) }
      }.build()
      val result = Intent().putExtra(AutofillManager.EXTRA_AUTHENTICATION_RESULT, dataset)
      finish(result, requestId)
    }

    Function("completeAccessibilityAutofill") {
      requestId: String, username: String, email: String, password: String, totp: String ->
      val pending = PendingCredentialRequests.resolve(activeRequestIntent())
      if (
        pending == null || pending.id != requestId || pending.kind != "accessibility-get" ||
        !isRequestFresh(pending) || !ProviderCredentialCache.isUnlocked()
      ) {
        CryptexAccessibilityService.cancelRequest(requestId)
        PendingCredentialRequests.clear(requestId)
        return@Function false
      }
      val completed = CryptexAccessibilityService.completeFill(
        requestId,
        username,
        email,
        password,
        totp,
      )
      if (completed) {
        if (!consumeRequest(requestId)) {
          CryptexAccessibilityService.cancelRequest(requestId)
          return@Function false
        }
        appContext.throwingActivity.moveTaskToBack(true)
      }
      completed
    }

    Function("completeProviderPassword") { requestId: String, username: String, password: String ->
      if (!ProviderCredentialCache.isUnlocked()) return@Function false
      if (!isActiveProviderRequest(requestId)) return@Function false
      val activityIntent = activeProviderIntent() ?: return@Function false
      val request = PendingIntentHandler.retrieveProviderGetCredentialRequest(
        activityIntent,
      ) ?: return@Function false
      if (request.credentialOptions.none { it is GetPasswordOption }) return@Function false
      val result = Intent()
      PendingIntentHandler.setGetCredentialResponse(
        result,
        GetCredentialResponse(PasswordCredential(username, password)),
      )
      finish(result, requestId)
    }

    Function("completeProviderUnlock") { requestId: String ->
      if (!ProviderCredentialCache.isUnlocked()) return@Function false
      if (!isActiveProviderRequest(requestId)) return@Function false
      val activityIntent = activeProviderIntent() ?: return@Function false
      val request = PendingIntentHandler.retrieveBeginGetCredentialRequest(
        activityIntent,
      ) ?: return@Function false
      val result = Intent()
      PendingIntentHandler.setBeginGetCredentialResponse(
        result,
        buildProviderResponse(context, request),
      )
      finish(result, requestId)
    }

    Function("completeProviderPasskeyGet") { requestId: String, responseJson: String ->
      if (!ProviderCredentialCache.isUnlocked()) return@Function false
      if (!isActiveProviderRequest(requestId)) return@Function false
      val activityIntent = activeProviderIntent() ?: return@Function false
      val request = PendingIntentHandler.retrieveProviderGetCredentialRequest(
        activityIntent,
      ) ?: return@Function false
      if (request.credentialOptions.none { it is GetPublicKeyCredentialOption }) {
        return@Function false
      }
      val result = Intent()
      PendingIntentHandler.setGetCredentialResponse(
        result,
        GetCredentialResponse(PublicKeyCredential(responseJson)),
      )
      finish(result, requestId).also { completed ->
        if (completed) Log.i(TAG, "Passkey response sent operation=assert")
      }
    }

    Function("completeProviderPasskeyCreate") { requestId: String, responseJson: String ->
      if (!ProviderCredentialCache.isUnlocked()) return@Function false
      if (!isActiveProviderRequest(requestId)) return@Function false
      val activityIntent = activeProviderIntent() ?: return@Function false
      if (PendingIntentHandler.retrieveProviderCreateCredentialRequest(
        activityIntent,
      )?.callingRequest !is CreatePublicKeyCredentialRequest) return@Function false
      val result = Intent()
      PendingIntentHandler.setCreateCredentialResponse(
        result,
        CreatePublicKeyCredentialResponse(responseJson),
      )
      finish(result, requestId).also { completed ->
        if (completed) Log.i(TAG, "Passkey response sent operation=create")
      }
    }

    Function("completeProviderPasswordCreate") { requestId: String ->
      if (!ProviderCredentialCache.isUnlocked()) return@Function false
      if (!isActiveProviderRequest(requestId)) return@Function false
      val activityIntent = activeProviderIntent() ?: return@Function false
      if (PendingIntentHandler.retrieveProviderCreateCredentialRequest(
        activityIntent,
      )?.callingRequest !is CreatePasswordRequest) return@Function false
      val result = Intent()
      PendingIntentHandler.setCreateCredentialResponse(result, CreatePasswordResponse())
      finish(result, requestId)
    }

    Function("rejectExcludedPasskeyCreate") { requestId: String ->
      if (!isActiveProviderRequest(requestId)) return@Function false
      val activityIntent = activeProviderIntent() ?: return@Function false
      if (PendingIntentHandler.retrieveProviderCreateCredentialRequest(
        activityIntent,
      )?.callingRequest !is CreatePublicKeyCredentialRequest) return@Function false
      val result = Intent()
      PendingIntentHandler.setCreateCredentialException(
        result,
        CreatePublicKeyCredentialDomException(
          InvalidStateError(),
          "A matching passkey already exists",
        ),
      )
      finish(result, requestId)
    }

    Function("dismissRequest") { requestId: String? ->
      val activeIntent = activeRequestIntent()
      val providerIntent = activeProviderIntent()
      val hasProviderRequest = providerIntent?.hasProviderCredentialRequest() == true
      val activeId = if (hasProviderRequest) providerRequestId(providerIntent!!) else PendingCredentialRequests.requestId(activeIntent)
      if (requestId != null && activeId != requestId) return@Function
      val consumedId = requestId ?: activeId
      if (consumedId != null) cancelActiveRequest(consumedId)
    }
  }
}
