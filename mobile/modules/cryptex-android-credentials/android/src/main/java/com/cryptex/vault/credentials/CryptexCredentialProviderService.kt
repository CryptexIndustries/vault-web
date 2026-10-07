package com.cryptex.vault.credentials

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.CancellationSignal
import android.os.OutcomeReceiver
import android.os.SystemClock
import android.os.Handler
import android.os.Looper
import androidx.annotation.RequiresApi
import androidx.credentials.exceptions.ClearCredentialException
import androidx.credentials.exceptions.CreateCredentialException
import androidx.credentials.exceptions.CreateCredentialUnknownException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.GetCredentialUnknownException
import androidx.credentials.provider.AuthenticationAction
import androidx.credentials.provider.BeginCreateCredentialRequest
import androidx.credentials.provider.BeginCreatePasswordCredentialRequest
import androidx.credentials.provider.BeginCreatePublicKeyCredentialRequest
import androidx.credentials.provider.BeginCreateCredentialResponse
import androidx.credentials.provider.BeginGetCredentialRequest
import androidx.credentials.provider.BeginGetCredentialResponse
import androidx.credentials.provider.BeginGetPasswordOption
import androidx.credentials.provider.BeginGetPublicKeyCredentialOption
import androidx.credentials.provider.CreateEntry
import androidx.credentials.provider.CredentialProviderService
import androidx.credentials.provider.PasswordCredentialEntry
import androidx.credentials.provider.ProviderClearCredentialStateRequest
import androidx.credentials.provider.PublicKeyCredentialEntry
import org.json.JSONObject
import java.util.concurrent.atomic.AtomicInteger

data class ProviderCredential(
  val vaultId: String,
  val name: String,
  val username: String?,
  val rpId: String?,
  val passkeyCredentialId: String?,
  val passkeyDiscoverable: Boolean,
  val passkeyUsername: String?,
  val passkeyDisplayName: String?,
)

object ProviderCredentialCache {
  @Volatile private var unlocked: Boolean = false
  @Volatile private var expired: Boolean = false
  @Volatile private var backgrounded: Boolean = false
  @Volatile private var backgroundedAtElapsedMs: Long = 0L
  @Volatile private var expiresAtElapsedMs: Long = 0L
  @Volatile var credentials: List<ProviderCredential> = emptyList()
    private set
  private val expiryHandler = Handler(Looper.getMainLooper())
  private val expiryAction = Runnable {
    synchronized(this) {
      if (unlocked && SystemClock.elapsedRealtime() >= expiresAtElapsedMs) expire()
    }
  }

  private fun expire() {
    expiryHandler.removeCallbacks(expiryAction)
    unlocked = false
    expired = true
    expiresAtElapsedMs = 0L
    credentials = emptyList()
    CryptexAccessibilityService.cancelPendingFill()
  }

  private fun scheduleExpiry() {
    expiryHandler.removeCallbacks(expiryAction)
    if (expiresAtElapsedMs != Long.MAX_VALUE) {
      expiryHandler.postDelayed(
        expiryAction,
        (expiresAtElapsedMs - SystemClock.elapsedRealtime()).coerceAtLeast(0L),
      )
    }
  }

  @Synchronized
  fun replace(next: List<ProviderCredential>, timeoutMinutes: Double) {
    if (expired || (unlocked && SystemClock.elapsedRealtime() >= expiresAtElapsedMs)) {
      expire()
      return
    }
    val firstPublication = !unlocked
    credentials = next
    unlocked = true
    if (firstPublication) {
      expiresAtElapsedMs = Long.MAX_VALUE
      if (backgrounded) background(timeoutMinutes) else refresh(timeoutMinutes)
    }
  }

  @Synchronized
  fun refresh(timeoutMinutes: Double) {
    if (!unlocked) return
    if (SystemClock.elapsedRealtime() >= expiresAtElapsedMs) {
      expire()
      return
    }
    if (backgrounded) return
    expiresAtElapsedMs = if (timeoutMinutes <= 0) {
      Long.MAX_VALUE
    } else {
      SystemClock.elapsedRealtime() + (timeoutMinutes * 60_000).toLong()
    }
    scheduleExpiry()
  }

  @Synchronized
  fun background(timeoutMinutes: Double) {
    // A short background stint gets a fresh window, just as the UI policy does.
    if (expired || (unlocked && !isUnlocked())) return
    if (!backgrounded) {
      backgrounded = true
      backgroundedAtElapsedMs = SystemClock.elapsedRealtime()
    }
    expiresAtElapsedMs = if (timeoutMinutes <= 0) {
      Long.MAX_VALUE
    } else {
      backgroundedAtElapsedMs + (timeoutMinutes * 60_000).toLong()
    }
    if (SystemClock.elapsedRealtime() >= expiresAtElapsedMs) {
      expire()
      return
    }
    scheduleExpiry()
  }

  @Synchronized
  fun resume(timeoutMinutes: Double) {
    if (!isUnlocked()) return
    backgrounded = false
    backgroundedAtElapsedMs = 0L
    refresh(timeoutMinutes)
  }

  @Synchronized
  fun isUnlocked(): Boolean {
    if (unlocked && SystemClock.elapsedRealtime() >= expiresAtElapsedMs) expire()
    return unlocked
  }

  @Synchronized
  fun clear() {
    expiryHandler.removeCallbacks(expiryAction)
    unlocked = false
    expired = false
    backgrounded = false
    backgroundedAtElapsedMs = 0L
    expiresAtElapsedMs = 0L
    credentials = emptyList()
    CryptexAccessibilityService.cancelPendingFill()
  }
}

private val requestCode = AtomicInteger()

internal fun openCredentialRequest(
  context: Context,
  kind: String,
  credentialId: String? = null,
): PendingIntent {
  val id = requestCode.incrementAndGet()
  val query = buildString {
    append("kind=").append(Uri.encode(kind))
    credentialId?.let { append("&credentialId=").append(Uri.encode(it)) }
    append("&requestId=").append(id)
  }
  val intent = Intent(
    Intent.ACTION_VIEW,
    context.cryptexCredentialRequestUri(query),
  ).apply {
    setClass(context, CredentialRequestActivity::class.java)
  }
  return PendingIntent.getActivity(
    context,
    id,
    intent,
    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
  )
}

internal fun buildProviderResponse(
  context: Context,
  request: BeginGetCredentialRequest,
): BeginGetCredentialResponse {
  val response = BeginGetCredentialResponse.Builder()
  request.beginGetCredentialOptions.forEach { option ->
    when (option) {
      is BeginGetPasswordOption -> ProviderCredentialCache.credentials.asSequence()
        .filter { !it.username.isNullOrBlank() }
        .forEach { credential ->
          response.addCredentialEntry(
            PasswordCredentialEntry.Builder(
              context,
              credential.username!!,
              openCredentialRequest(context, "provider-password-get", credential.vaultId),
              option,
            ).setDisplayName(credential.name).build(),
          )
        }
      is BeginGetPublicKeyCredentialOption -> {
        val requestJson = runCatching { JSONObject(option.requestJson) }.getOrNull()
        val rpId = requestJson?.optString("rpId")
        val allowed = requestJson?.optJSONArray("allowCredentials")
        val allowedIds = buildSet {
          if (allowed != null) for (index in 0 until allowed.length()) {
            allowed.optJSONObject(index)?.optString("id")?.takeIf { it.isNotBlank() }?.let(::add)
          }
        }
        ProviderCredentialCache.credentials.asSequence()
          .filter {
            !it.passkeyCredentialId.isNullOrBlank() &&
              it.rpId?.equals(rpId, ignoreCase = true) == true &&
              (
                (allowedIds.isEmpty() && it.passkeyDiscoverable) ||
                  it.passkeyCredentialId in allowedIds
                )
          }
          .forEach { credential ->
            response.addCredentialEntry(
              PublicKeyCredentialEntry.Builder(
                context,
                credential.passkeyUsername ?: credential.name,
                openCredentialRequest(
                  context,
                  "provider-passkey-get",
                  credential.passkeyCredentialId,
                ),
                option,
              ).setDisplayName(credential.passkeyDisplayName ?: credential.name).build(),
            )
          }
      }
    }
  }
  return response.build()
}

@RequiresApi(Build.VERSION_CODES.UPSIDE_DOWN_CAKE)
class CryptexCredentialProviderService : CredentialProviderService() {

  override fun onBeginGetCredentialRequest(
    request: BeginGetCredentialRequest,
    cancellationSignal: CancellationSignal,
    callback: OutcomeReceiver<BeginGetCredentialResponse, GetCredentialException>,
  ) {
    if (cancellationSignal.isCanceled) return
    if (!ProviderCredentialCache.isUnlocked()) {
      callback.onResult(
        BeginGetCredentialResponse.Builder().addAuthenticationAction(
          AuthenticationAction(
            "Unlock ${cryptexProviderName()}",
            openCredentialRequest(this, "provider-unlock"),
          ),
        ).build(),
      )
      return
    }
    runCatching { buildProviderResponse(applicationContext, request) }
      .onSuccess(callback::onResult)
      .onFailure {
        callback.onError(GetCredentialUnknownException("Could not read credentials"))
      }
  }

  override fun onBeginCreateCredentialRequest(
    request: BeginCreateCredentialRequest,
    cancellationSignal: CancellationSignal,
    callback: OutcomeReceiver<BeginCreateCredentialResponse, CreateCredentialException>,
  ) {
    if (cancellationSignal.isCanceled) return
    val kind = when (request) {
      is BeginCreatePublicKeyCredentialRequest -> "provider-passkey-create"
      is BeginCreatePasswordCredentialRequest -> "provider-password-create"
      else -> {
        callback.onError(CreateCredentialUnknownException("Unsupported credential type"))
        return
      }
    }
    callback.onResult(
      BeginCreateCredentialResponse.Builder()
        .addCreateEntry(CreateEntry(cryptexProviderName(), openCredentialRequest(this, kind)))
        .build(),
    )
  }

  override fun onClearCredentialStateRequest(
    request: ProviderClearCredentialStateRequest,
    cancellationSignal: CancellationSignal,
    callback: OutcomeReceiver<Void?, ClearCredentialException>,
  ) {
    if (cancellationSignal.isCanceled) return
    PendingCredentialRequests.clearAll()
    ProviderCredentialCache.clear()
    callback.onResult(null)
  }
}
