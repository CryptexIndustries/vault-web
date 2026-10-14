package com.cryptex.vault.credentials

import android.app.assist.AssistStructure
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.text.InputType
import android.view.View
import android.view.autofill.AutofillId
import androidx.annotation.RequiresApi
import java.util.Locale
import java.util.UUID

internal data class PendingCredentialRequest(
  val id: String,
  val kind: String,
  val packageName: String?,
  val applicationLabel: String? = null,
  val webDomain: String? = null,
  val webScheme: String? = null,
  val warningType: String? = null,
  val usernameIds: List<AutofillId> = emptyList(),
  val emailIds: List<AutofillId> = emptyList(),
  val passwordIds: List<AutofillId> = emptyList(),
  val hasNewPasswordFields: Boolean = false,
  val saveTriggerId: AutofillId? = null,
  val username: String? = null,
  val email: String? = null,
  val password: String? = null,
  val createdAtElapsedMs: Long = SystemClock.elapsedRealtime(),
)

internal open class PendingCredentialRequestRegistry(
  private val now: () -> Long,
  private val scheduleExpiry: (Any, Long, () -> Unit) -> Unit,
  private val cancelExpiry: (Any) -> Unit,
) {
  @Volatile var current: PendingCredentialRequest? = null
    private set
  private var activeHandle: String? = null
  private var activeRequestId: String? = null
  private var expiryToken: Any? = null

  @Synchronized fun register(request: PendingCredentialRequest): String {
    cancelTimer()
    val handle = UUID.randomUUID().toString()
    current = request
    activeHandle = handle
    activeRequestId = request.id
    expireOrSchedule()
    return handle
  }

  @Synchronized fun resolveHandle(handle: String?): PendingCredentialRequest? {
    expireIfStale()
    return current?.takeIf { handle != null && handle == activeHandle }
  }

  // Keep only identity after expiry so the authorized host can close its relay.
  @Synchronized fun requestIdForHandle(handle: String?): String? {
    expireIfStale()
    return activeRequestId.takeIf { handle != null && handle == activeHandle }
  }

  @Synchronized fun markDelivered(requestId: String): Boolean {
    expireIfStale()
    val request = current?.takeIf { it.id == requestId } ?: return false
    cancelTimer()
    current = request.copy(createdAtElapsedMs = now())
    expireOrSchedule()
    return true
  }

  @Synchronized fun clear(requestId: String): Boolean {
    if (activeRequestId != requestId) return false
    clear()
    return true
  }

  @Synchronized fun clear() {
    cancelTimer()
    current = null
    activeHandle = null
    activeRequestId = null
  }

  private fun cancelTimer() {
    expiryToken?.let(cancelExpiry)
    expiryToken = null
  }

  private fun expireIfStale() {
    val request = current ?: return
    if (!isRequestFreshAt(request.createdAtElapsedMs, now())) {
      cancelTimer()
      current = null
    }
  }

  private fun expireOrSchedule() {
    expireIfStale()
    val request = current ?: return
    val token = Any()
    expiryToken = token
    // Freshness includes the last millisecond of the completion window.
    val delay = request.createdAtElapsedMs + REQUEST_FRESHNESS_MS + 1L - now()
    scheduleExpiry(token, delay.coerceAtLeast(0L)) {
      synchronized(this) {
        if (expiryToken === token) {
          cancelTimer()
          expireOrSchedule()
        }
      }
    }
  }
}

private val requestExpiryHandler by lazy { Handler(Looper.getMainLooper()) }

internal object PendingCredentialRequests : PendingCredentialRequestRegistry(
  now = SystemClock::elapsedRealtime,
  scheduleExpiry = { token, delay, action ->
    requestExpiryHandler.postAtTime(action, token, SystemClock.uptimeMillis() + delay)
  },
  cancelExpiry = { requestExpiryHandler.removeCallbacksAndMessages(it) },
) {
  @Volatile var requestDeliveredAtMs: Long = 0L

  fun resolve(intent: Intent?): PendingCredentialRequest? = resolveHandle(intent.pendingRequestHandle())

  fun requestId(intent: Intent?): String? = requestIdForHandle(intent.pendingRequestHandle())

  @Synchronized fun clearAll() {
    clear()
    requestDeliveredAtMs = 0L
  }
}

private const val REQUEST_FRESHNESS_MS = 60_000L
internal const val EXTRA_PENDING_REQUEST_HANDLE = "cryptex.internal.pendingRequestHandle"

private fun Intent?.pendingRequestHandle(): String? = runCatching {
  this?.getStringExtra(EXTRA_PENDING_REQUEST_HANDLE)
}.getOrNull()

internal fun Intent.putPendingRequestHandle(handle: String) {
  putExtra(EXTRA_PENDING_REQUEST_HANDLE, handle)
}

internal fun markRequestDelivered() {
  PendingCredentialRequests.requestDeliveredAtMs = SystemClock.elapsedRealtime()
}

internal fun isRequestFresh(request: PendingCredentialRequest? = null): Boolean {
  val createdAt = request?.createdAtElapsedMs
    ?: PendingCredentialRequests.requestDeliveredAtMs.takeIf { it != 0L }
    ?: return true
  return isRequestFreshAt(createdAt, SystemClock.elapsedRealtime())
}

private fun isRequestFreshAt(createdAt: Long, now: Long): Boolean {
  val age = now - createdAt
  return age in 0L..REQUEST_FRESHNESS_MS
}

private data class ParsedNode(
  val node: AssistStructure.ViewNode,
  val website: BrowserWebsite?,
  val windowIndex: Int,
  val role: CredentialFieldRole?,
)

private fun ParsedNode.isLoginField(): Boolean =
  role == CredentialFieldRole.PASSWORD || role == CredentialFieldRole.USERNAME ||
    role == CredentialFieldRole.EMAIL

@RequiresApi(Build.VERSION_CODES.O)
internal fun AssistStructure.findCredentialFields(
  context: Context,
  focusedWindowOnly: Boolean,
): PendingCredentialRequest? {
  val packageName = activityComponent?.packageName
  val nodes = buildList {
    fun visit(
      node: AssistStructure.ViewNode?,
      inheritedWebsite: BrowserWebsite?,
      windowIndex: Int,
    ) {
      if (node == null) return
      val website = node.website() ?: inheritedWebsite
      val role = if (node.autofillType == View.AUTOFILL_TYPE_TEXT) node.credentialRole() else null
      add(ParsedNode(node, website, windowIndex, role))
      repeat(node.childCount) { visit(node.getChildAt(it), website, windowIndex) }
    }
    repeat(windowNodeCount) { windowIndex ->
      visit(getWindowNodeAt(windowIndex).rootViewNode, null, windowIndex)
    }
  }

  val fillable = nodes.filter { it.node.autofillType == View.AUTOFILL_TYPE_TEXT }
  val focused = fillable.firstOrNull { it.node.isFocused && it.isLoginField() }
  val scopedNodes = if (focusedWindowOnly && focused != null) {
    nodes.filter { it.windowIndex == focused.windowIndex }
  } else {
    nodes
  }
  val scopedFillable = scopedNodes.filter { it.node.autofillType == View.AUTOFILL_TYPE_TEXT }
  val anchor = focused
    ?: scopedFillable.firstOrNull { it.role == CredentialFieldRole.PASSWORD }
    ?: scopedFillable.firstOrNull { it.isLoginField() }
    ?: return null

  val knownBrowser = BrowserAutofillPolicy.isKnownBrowser(packageName)
  val browserWebsite = if (knownBrowser) {
    scopedNodes.findUrlBarWebsite(packageName)
  } else {
    null
  }
  val targetWebsite = anchor.website ?: browserWebsite
  // A browser package is never a replacement for a missing website.
  if (knownBrowser && targetWebsite == null) return null
  val targetNodes = scopedFillable.filter { parsed ->
    websiteMatchesTarget(parsed.website, browserWebsite, targetWebsite)
  }
  val passwordNodes = targetNodes.filter { it.role == CredentialFieldRole.PASSWORD }
  val passwordIds = passwordNodes.mapNotNull { it.node.autofillId }
  val usernameIds = targetNodes.filter { it.role == CredentialFieldRole.USERNAME }
    .mapNotNull { it.node.autofillId }.distinct()
  val emailIds = targetNodes.filter { it.role == CredentialFieldRole.EMAIL }
    .mapNotNull { it.node.autofillId }.distinct()
  if (usernameIds.isEmpty() && emailIds.isEmpty() && passwordIds.isEmpty()) return null

  val warningType = if (knownBrowser) {
    browserFieldWarning(
      browserWebsite,
      targetWebsite,
      targetNodes.any { it.website == null && it.isLoginField() },
    )
  } else "unverified-app"
  val applicationLabel = packageName?.let { name ->
    runCatching {
      val info = context.packageManager.getApplicationInfo(name, 0)
      context.packageManager.getApplicationLabel(info).toString()
    }.getOrNull()
  }

  val hasNewPasswordFields = passwordNodes.any { it.node.isNewPasswordNode() }
  return PendingCredentialRequest(
    id = UUID.randomUUID().toString(),
    kind = "autofill-get",
    packageName = packageName,
    applicationLabel = applicationLabel,
    webDomain = targetWebsite?.domain,
    webScheme = targetWebsite?.scheme,
    warningType = warningType,
    usernameIds = usernameIds,
    emailIds = emailIds,
    passwordIds = passwordIds,
    hasNewPasswordFields = hasNewPasswordFields,
    saveTriggerId = if (hasNewPasswordFields) {
      scopedNodes.firstOrNull { it.node.isSaveTriggerNode() }?.node?.autofillId
    } else null,
  )
}

internal fun websiteMatchesTarget(
  fieldWebsite: BrowserWebsite?,
  fallbackWebsite: BrowserWebsite?,
  targetWebsite: BrowserWebsite?,
): Boolean = targetWebsite == null || (fieldWebsite ?: fallbackWebsite) == targetWebsite

internal fun browserFieldWarning(
  browserWebsite: BrowserWebsite?,
  targetWebsite: BrowserWebsite?,
  hasUnknownFieldOrigin: Boolean,
): String? = when {
  browserWebsite != null && targetWebsite != null && browserWebsite != targetWebsite ->
    "untrusted-web-context"
  browserWebsite == null || hasUnknownFieldOrigin -> "unverified-field-origin"
  targetWebsite?.scheme == "unknown" -> "unverified-web-scheme"
  else -> null
}

@RequiresApi(Build.VERSION_CODES.O)
private fun List<ParsedNode>.findUrlBarWebsite(packageName: String?): BrowserWebsite? =
  BrowserAutofillPolicy.resolveWebsite(
    packageName = packageName,
    candidates = asSequence().map { parsed ->
      val node = parsed.node
      val resourceName = if (
        node.idPackage != null && node.idType != null && node.idEntry != null
      ) {
        "${node.idPackage}:${node.idType}/${node.idEntry}"
      } else {
        null
      }
      BrowserAddressBarCandidate(
        resourceName = resourceName,
        visible = node.visibility == View.VISIBLE,
        values = listOf(
          node.autofillValue?.textValue?.toString(),
          node.text?.toString(),
        ),
        contentDescription = node.contentDescription?.toString(),
      )
    },
  )

@RequiresApi(Build.VERSION_CODES.O)
private fun AssistStructure.ViewNode.website(): BrowserWebsite? {
  val domain = webDomain?.lowercase(Locale.ROOT)?.trimEnd('.')?.takeIf(String::isNotEmpty)
    ?: return null
  val scheme = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
    when {
      webScheme.equals("http", ignoreCase = true) -> "http"
      webScheme.equals("https", ignoreCase = true) -> "https"
      else -> "unknown"
    }
  } else "unknown"
  return BrowserWebsite(scheme, domain)
}

private val SAVE_TRIGGER_TERMS = setOf(
  "create account",
  "sign up",
  "signup",
  "register",
  "change password",
  "update password",
  "save password",
  "set password",
  "reset password",
)

private val PASSWORD_INPUT_VARIATIONS = intArrayOf(
  InputType.TYPE_TEXT_VARIATION_PASSWORD,
  InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD,
  InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD,
)

@RequiresApi(Build.VERSION_CODES.O)
private fun AssistStructure.ViewNode.htmlAttribute(name: String): String? =
  htmlInfo?.attributes?.firstOrNull { it.first.equals(name, ignoreCase = true) }?.second

@RequiresApi(Build.VERSION_CODES.O)
private fun AssistStructure.ViewNode.autocompleteTokens(): List<String> =
  htmlAttribute("autocomplete")?.lowercase(Locale.ROOT)
    ?.split(Regex("\\s+"))?.filter(String::isNotEmpty).orEmpty()

@RequiresApi(Build.VERSION_CODES.O)
private fun AssistStructure.ViewNode.identityText(): String = listOfNotNull(
  htmlAttribute("name"),
  htmlAttribute("id"),
  htmlAttribute("type"),
  idEntry,
  hint?.toString(),
  contentDescription?.toString(),
).joinToString(" ")

@RequiresApi(Build.VERSION_CODES.O)
private fun AssistStructure.ViewNode.isNewPasswordNode(): Boolean {
  if (autofillHints.orEmpty().any { it.equals("newPassword", ignoreCase = true) }) return true
  if (autocompleteTokens().any { it == "new-password" }) return true
  return CredentialFieldPolicy.isNewPassword(identityText())
}

@RequiresApi(Build.VERSION_CODES.O)
private fun AssistStructure.ViewNode.isSaveTriggerNode(): Boolean {
  if (autofillId == null) return false
  val classNameValue = className?.toString().orEmpty().lowercase(Locale.ROOT)
  val htmlTag = htmlInfo?.tag.orEmpty().lowercase(Locale.ROOT)
  val htmlType = htmlAttribute("type").orEmpty().lowercase(Locale.ROOT)
  val buttonLike = isClickable ||
    classNameValue.contains("button") ||
    htmlTag == "button" ||
    (htmlTag == "input" && htmlType == "submit")
  if (!buttonLike) return false
  val identity = listOfNotNull(
    text?.toString(),
    hint?.toString(),
    contentDescription?.toString(),
    idEntry,
    htmlAttribute("value"),
    htmlAttribute("name"),
  ).joinToString(" ").lowercase(Locale.ROOT).replace(Regex("[^a-z0-9]+"), " ")
  return SAVE_TRIGGER_TERMS.any(identity::contains)
}

@RequiresApi(Build.VERSION_CODES.O)
private fun AssistStructure.ViewNode.credentialRole(): CredentialFieldRole? {
  val hints = autofillHints.orEmpty()
  val tokens = autocompleteTokens()
  val htmlType = htmlAttribute("type")
  val passwordInput = (inputType and InputType.TYPE_CLASS_TEXT) == InputType.TYPE_CLASS_TEXT &&
    PASSWORD_INPUT_VARIATIONS.any { it == (inputType and InputType.TYPE_MASK_VARIATION) }
  return CredentialFieldPolicy.classify(
    identity = identityText(),
    otp = tokens.any { it.contains("one-time-code") || it.contains("otp") },
    password = hints.any { it.contains("password", ignoreCase = true) } ||
      tokens.any { it == "current-password" || it == "new-password" } ||
      htmlType.equals("password", ignoreCase = true) || passwordInput,
    username = hints.any { it.contains("username", ignoreCase = true) } ||
      tokens.any { it == "username" },
    email = hints.any { it.contains("email", ignoreCase = true) } ||
      tokens.any { it == "email" } || htmlType.equals("email", ignoreCase = true),
  )
}
