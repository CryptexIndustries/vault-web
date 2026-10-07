package com.cryptex.vault.credentials

import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.Intent
import android.graphics.BlendMode
import android.graphics.drawable.Icon
import android.os.Build
import android.os.CancellationSignal
import android.service.autofill.AutofillService
import android.service.autofill.Dataset
import android.service.autofill.FillCallback
import android.service.autofill.FillRequest
import android.service.autofill.FillResponse
import android.service.autofill.InlinePresentation
import android.service.autofill.SaveCallback
import android.service.autofill.SaveInfo
import android.service.autofill.SaveRequest
import android.view.autofill.AutofillValue
import android.widget.RemoteViews
import androidx.annotation.RequiresApi
import androidx.autofill.inline.UiVersions
import androidx.autofill.inline.v1.InlineSuggestionUi

@RequiresApi(Build.VERSION_CODES.O)
class CryptexAutofillService : AutofillService() {
  override fun onFillRequest(
    request: FillRequest,
    cancellationSignal: CancellationSignal,
    callback: FillCallback,
  ) {
    if (cancellationSignal.isCanceled) return
    val structure = request.fillContexts.lastOrNull()?.structure
    if (structure?.activityComponent?.packageName == packageName) {
      callback.onSuccess(null)
      return
    }
    val pending = structure?.findCredentialFields(
      context = applicationContext,
      focusedWindowOnly = true,
    )
    if (pending == null || cancellationSignal.isCanceled) {
      callback.onSuccess(null)
      return
    }
    val handle = PendingCredentialRequests.register(pending)

    val presentation = providerPresentation("Open ${cryptexProviderName()}")
    val authentication = credentialRequestPendingIntent(pending, handle)
    val inlinePresentation = buildInlinePresentation(request, authentication)
    val dataset = Dataset.Builder(presentation).apply {
      (pending.usernameIds + pending.emailIds + pending.passwordIds).distinct().forEach { id ->
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && inlinePresentation != null) {
          setValue(id, null, presentation, inlinePresentation)
        } else {
          setValue(id, null)
        }
      }
      setAuthentication(authentication.intentSender)
    }.build()

    val response = FillResponse.Builder().addDataset(dataset)
    buildSaveInfo(request, pending)?.let(response::setSaveInfo)
    if (!cancellationSignal.isCanceled) callback.onSuccess(response.build())
  }

  override fun onSaveRequest(request: SaveRequest, callback: SaveCallback) {
    val structures = request.fillContexts.map { it.structure }
    if (structures.any { it.activityComponent?.packageName == packageName }) {
      callback.onSuccess()
      return
    }
    val forms = structures.mapNotNull {
      it.findCredentialFields(
        context = applicationContext,
        focusedWindowOnly = false,
      )
    }
    if (forms.isEmpty()) {
      callback.onSuccess()
      return
    }

    val values = mutableMapOf<android.view.autofill.AutofillId, String>()
    fun visit(node: android.app.assist.AssistStructure.ViewNode) {
      node.autofillId?.let { id ->
        node.autofillValue?.textValue?.toString()?.let { values[id] = it }
      }
      repeat(node.childCount) { visit(node.getChildAt(it)) }
    }
    structures.forEach { structure ->
      repeat(structure.windowNodeCount) { visit(structure.getWindowNodeAt(it).rootViewNode) }
    }

    val fields = forms.asReversed().firstOrNull { it.passwordIds.isNotEmpty() } ?: forms.last()
    val relatedForms = forms.filter { it.hasSameSaveTarget(fields) }
    val password = relatedForms.asReversed().asSequence()
      .flatMap { it.passwordIds.asSequence() }
      .mapNotNull(values::get)
      .firstOrNull(String::isNotEmpty)
    if (password == null) {
      callback.onSuccess()
      return
    }
    val explicitUsername = relatedForms.asReversed().asSequence()
      .flatMap { it.usernameIds.asSequence() }
      .mapNotNull(values::get)
      .firstOrNull(String::isNotEmpty)
      .orEmpty()
    val email = relatedForms.asReversed().asSequence()
      .flatMap { it.emailIds.asSequence() }
      .mapNotNull(values::get)
      .firstOrNull(String::isNotEmpty)
      .orEmpty()
    val username = explicitUsername.ifEmpty { email }
    val separateEmail = email.takeIf { explicitUsername.isNotEmpty() && it.isNotEmpty() }
    val pending = fields.copy(
      kind = "autofill-save",
      username = username,
      email = separateEmail,
      password = password,
    )
    val handle = PendingCredentialRequests.register(pending)
    val intentSender = credentialRequestPendingIntent(pending, handle).intentSender
    if (Build.VERSION.SDK_INT >= 28) {
      callback.onSuccess(intentSender)
    } else {
      callback.onSuccess()
      startActivity(credentialRequestIntent(handle).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
  }

  private fun providerPresentation(label: String): RemoteViews =
    RemoteViews(packageName, R.layout.cryptex_autofill_presentation).apply {
      setImageViewResource(R.id.cryptex_autofill_icon, R.drawable.ic_cryptex_brand)
      setTextViewText(R.id.cryptex_autofill_label, label)
    }

  private fun PendingCredentialRequest.hasSameSaveTarget(
    other: PendingCredentialRequest,
  ): Boolean {
    if (packageName != other.packageName) return false
    if (webDomain == null && other.webDomain == null) return true
    return webDomain == other.webDomain && webScheme == other.webScheme
  }

  private fun credentialRequestIntent(handle: String): Intent =
    Intent(Intent.ACTION_VIEW, cryptexCredentialRequestUri()).apply {
      setClass(this@CryptexAutofillService, CredentialRequestActivity::class.java)
      putPendingRequestHandle(handle)
    }

  private fun credentialRequestPendingIntent(request: PendingCredentialRequest, handle: String): PendingIntent =
    PendingIntent.getActivity(
      this,
      request.id.hashCode(),
      credentialRequestIntent(handle),
      PendingIntent.FLAG_CANCEL_CURRENT or PendingIntent.FLAG_MUTABLE,
    )

  @SuppressLint("RestrictedApi")
  private fun buildInlinePresentation(
    request: FillRequest,
    authentication: PendingIntent,
  ): InlinePresentation? {
    if (Build.VERSION.SDK_INT < 30 || !AutofillPreferences.inlineSuggestionsEnabled(this)) {
      return null
    }
    return request.inlineSuggestionsRequest?.inlinePresentationSpecs?.firstOrNull()?.takeIf { spec ->
      UiVersions.getVersions(spec.style).contains(UiVersions.INLINE_UI_VERSION_1)
    }?.let { spec ->
      val brandIcon = Icon.createWithResource(this, R.drawable.ic_cryptex_brand).apply {
        if (Build.VERSION.SDK_INT >= 29) setTintBlendMode(BlendMode.DST)
      }
      val content = InlineSuggestionUi.newContentBuilder(authentication)
        .setStartIcon(brandIcon)
        .setTitle(cryptexProviderName())
        .setSubtitle("Select a login")
        .setContentDescription("Open ${cryptexProviderName()} login suggestions")
        .build()
      InlinePresentation(content.slice, spec, false)
    }
  }

  private fun buildSaveInfo(request: FillRequest, pending: PendingCredentialRequest): SaveInfo? {
    if (request.flags and FillRequest.FLAG_COMPATIBILITY_MODE_REQUEST != 0) return null
    val identityIds = pending.usernameIds + pending.emailIds
    val isDelayedIdentityStep =
      Build.VERSION.SDK_INT >= 29 && pending.passwordIds.isEmpty() && identityIds.isNotEmpty()
    if (pending.passwordIds.isEmpty() && !isDelayedIdentityStep) return null
    val requiredIds = if (isDelayedIdentityStep) identityIds else pending.passwordIds
    val saveType = if (pending.passwordIds.isEmpty()) {
      SaveInfo.SAVE_DATA_TYPE_USERNAME
    } else {
      SaveInfo.SAVE_DATA_TYPE_USERNAME or SaveInfo.SAVE_DATA_TYPE_PASSWORD
    }
    return SaveInfo.Builder(
      saveType,
      requiredIds.distinct().toTypedArray(),
    ).apply {
      if (isDelayedIdentityStep) {
        setFlags(SaveInfo.FLAG_DELAY_SAVE)
      } else {
        identityIds.distinct().takeIf { it.isNotEmpty() }?.let {
          setOptionalIds(it.toTypedArray())
        }
        if (pending.hasNewPasswordFields) {
          setFlags(SaveInfo.FLAG_SAVE_ON_ALL_VIEWS_INVISIBLE)
          if (Build.VERSION.SDK_INT >= 28) {
            pending.saveTriggerId?.let(::setTriggerId)
          }
        }
      }
    }.build()
  }
}
