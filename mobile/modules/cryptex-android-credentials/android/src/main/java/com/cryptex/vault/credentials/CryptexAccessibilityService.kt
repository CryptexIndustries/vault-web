package com.cryptex.vault.credentials

import android.accessibilityservice.AccessibilityService
import android.app.AlertDialog
import android.content.ComponentName
import android.content.Intent
import android.graphics.PixelFormat
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.text.InputType
import android.util.Log
import android.view.Gravity
import android.view.WindowManager
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.core.content.ContextCompat
import java.lang.ref.WeakReference
import java.util.UUID

private const val ACCESSIBILITY_LOG_TAG = "CryptexAccessibility"

private data class AccessibilityTarget(
  val packageName: String,
  val applicationLabel: String?,
  val website: BrowserWebsite?,
  val windowId: Int,
)

private data class AccessibilitySession(
  val request: PendingCredentialRequest,
  val target: AccessibilityTarget,
  val focusedRole: CredentialFieldRole?,
)

private data class AccessibilityFill(
  val session: AccessibilitySession,
  val username: String,
  val email: String,
  val password: String,
  val totp: String,
)

private data class SuppressedAccessibilityTarget(
  val target: AccessibilityTarget,
  val untilElapsedMs: Long,
)

private data class ClassifiedAccessibilityNode(
  val node: AccessibilityNodeInfo,
  val role: CredentialFieldRole,
  val isNewPassword: Boolean = false,
)

/**
 * Explicit, opt-in fallback for login surfaces that do not expose Android's
 * Autofill Framework. It never keeps form text while observing events: field
 * values are read only after the user chooses Save login from the overlay.
 */
class CryptexAccessibilityService : AccessibilityService() {
  companion object {
    @Volatile private var activeService = WeakReference<CryptexAccessibilityService>(null)
    @Volatile private var activeSession: AccessibilitySession? = null

    fun componentName(context: android.content.Context) =
      ComponentName(context, CryptexAccessibilityService::class.java)

    fun completeFill(
      requestId: String,
      username: String,
      email: String,
      password: String,
      totp: String,
    ): Boolean = activeService.get()?.completeFillInternal(
      requestId,
      username,
      email,
      password,
      totp,
    ) ?: false

    fun cancelRequest(requestId: String?) {
      activeService.get()?.cancelRequestInternal(requestId)
    }

    fun cancelPendingFill() {
      activeService.get()?.let { service ->
        service.pendingFill?.let { service.cancelRequestInternal(it.session.request.id) }
      }
    }
  }

  private val handler = Handler(Looper.getMainLooper())
  private val windowManager by lazy { getSystemService(WindowManager::class.java) }
  private var overlayButton: Button? = null
  private var offeredPackage: String? = null
  @Volatile private var pendingFill: AccessibilityFill? = null
  private var suppressedTarget: SuppressedAccessibilityTarget? = null

  override fun onServiceConnected() {
    activeService = WeakReference(this)
    activeSession?.let { session ->
      if (!isRequestFresh(session.request)) activeSession = null
    }
  }

  override fun onAccessibilityEvent(event: AccessibilityEvent?) {
    val eventPackage = event?.packageName?.toString()
    if (eventPackage == packageName) {
      val activityOpened = event.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED &&
        isOwnActivityClass(event.className?.toString())
      if (activityOpened) hideOverlay()
      return
    }
    val eventSource = event?.source
    val credentialFieldInteraction = eventPackage != null &&
      eventSource?.let(::classifyCredentialField) != null
    if (credentialFieldInteraction) {
      if (suppressedTarget?.target?.packageName != eventPackage) suppressedTarget = null
      offeredPackage = eventPackage
    }

    when (event?.eventType) {
      AccessibilityEvent.TYPE_VIEW_FOCUSED,
      AccessibilityEvent.TYPE_VIEW_ACCESSIBILITY_FOCUSED -> {
        handler.postDelayed({ refreshOverlay(eventPackage.takeIf { credentialFieldInteraction }) }, 100L)
      }
      AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED,
      AccessibilityEvent.TYPE_WINDOWS_CHANGED -> {
        handler.postDelayed({ refreshOverlay() }, 150L)
      }
      AccessibilityEvent.TYPE_VIEW_CLICKED -> {
        handler.postDelayed({ refreshOverlay(eventPackage.takeIf { credentialFieldInteraction }) }, 150L)
      }
      AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED -> {
        if (overlayButton != null) handler.postDelayed({ refreshOverlay() }, 150L)
      }
    }
  }

  override fun onInterrupt() {
    hideOverlay()
    cancelRequestInternal(null)
  }

  override fun onDestroy() {
    hideOverlay()
    cancelRequestInternal(null)
    handler.removeCallbacksAndMessages(null)
    if (activeService.get() === this) activeService.clear()
    super.onDestroy()
  }

  private fun showOverlay() {
    if (overlayButton != null) return
    val button = Button(this).apply {
      text = cryptexProviderName()
      contentDescription = "Open ${cryptexProviderName()} autofill fallback"
      isAllCaps = false
      setTextColor(android.graphics.Color.parseColor("#FCF8EC"))
      setTextSize(android.util.TypedValue.COMPLEX_UNIT_SP, 13f)
      minHeight = (48 * resources.displayMetrics.density).toInt()
      setBackgroundResource(R.drawable.cryptex_accessibility_pill)
      ContextCompat.getDrawable(this@CryptexAccessibilityService, R.drawable.ic_cryptex_brand)?.let {
        val size = (24 * resources.displayMetrics.density).toInt()
        it.setBounds(0, 0, size, size)
        setCompoundDrawablesRelative(it, null, null, null)
        compoundDrawablePadding = (8 * resources.displayMetrics.density).toInt()
      }
      setOnClickListener { showActionMenu() }
    }
    val params = WindowManager.LayoutParams(
      WindowManager.LayoutParams.WRAP_CONTENT,
      WindowManager.LayoutParams.WRAP_CONTENT,
      WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
        WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
      PixelFormat.TRANSLUCENT,
    ).apply {
      gravity = Gravity.TOP or Gravity.END
      x = 16
      y = 96
    }
    runCatching { windowManager.addView(button, params) }
      .onSuccess { overlayButton = button }
      .onFailure { error ->
        Log.e(ACCESSIBILITY_LOG_TAG, "Unable to show the autofill fallback action", error)
      }
  }

  private fun hideOverlay() {
    overlayButton?.let { button ->
      runCatching { windowManager.removeView(button) }
    }
    overlayButton = null
  }

  private fun showActionMenu() {
    val target = currentTarget()
    if (target == null) {
      Log.w(ACCESSIBILITY_LOG_TAG, "Autofill target was no longer available")
      return
    }
    val density = resources.displayMetrics.density
    val content = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      setPadding((20 * density).toInt(), (8 * density).toInt(), (20 * density).toInt(), 0)
    }
    fun action(title: String, subtitle: String, onPress: () -> Unit) = Button(this).apply {
      text = "$title\n$subtitle"
      contentDescription = "$title. $subtitle"
      isAllCaps = false
      gravity = Gravity.START or Gravity.CENTER_VERTICAL
      setTextColor(Color.parseColor("#FCF8EC"))
      setTextSize(android.util.TypedValue.COMPLEX_UNIT_SP, 14f)
      setLineSpacing(0f, 1.15f)
      minHeight = (68 * density).toInt()
      val background = GradientDrawable().apply {
        setColor(Color.parseColor("#22293A"))
        cornerRadius = 6 * density
      }
      setBackground(background)
      setPadding((16 * density).toInt(), (8 * density).toInt(), (16 * density).toInt(), (8 * density).toInt())
      val params = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        LinearLayout.LayoutParams.WRAP_CONTENT,
      ).apply { bottomMargin = (8 * density).toInt() }
      layoutParams = params
      setOnClickListener { onPress() }
    }
    lateinit var dialog: AlertDialog
    content.addView(action("Autofill login", "Choose a saved login from your vault") {
      dialog.dismiss()
      handler.postDelayed({ beginFillRequest(target) }, 100L)
    })
    content.addView(action("Save login", "Read the form and review it in Cryptex Vault") {
      dialog.dismiss()
      handler.postDelayed({ beginSaveRequest(target) }, 100L)
    })
    dialog = AlertDialog.Builder(this)
      .setIcon(R.drawable.ic_cryptex_brand)
      .setTitle(cryptexProviderName())
      .setMessage("Choose an action for ${target.displayLabel()}.")
      .setView(content)
      .setNegativeButton("Dismiss for this visit") { _, _ ->
        suppressedTarget = SuppressedAccessibilityTarget(
          target,
          android.os.SystemClock.elapsedRealtime() + 5 * 60_000L,
        )
        hideOverlay()
      }
      .create()
    dialog.window?.setType(WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY)
    dialog.show()
    styleOverlayDialog(dialog)
  }

  private fun AccessibilityTarget.displayLabel(): String =
    website?.let { "${it.scheme}://${it.domain}" } ?: applicationLabel ?: packageName

  private fun styleOverlayDialog(dialog: AlertDialog) {
    dialog.window?.setBackgroundDrawable(GradientDrawable().apply {
      setColor(Color.parseColor("#181D2B"))
      cornerRadius = 12 * resources.displayMetrics.density
      setStroke((1 * resources.displayMetrics.density).toInt(), Color.parseColor("#2A3348"))
    })
    dialog.findViewById<TextView>(android.R.id.message)?.setTextColor(Color.parseColor("#8A93A8"))
    val titleId = resources.getIdentifier("alertTitle", "id", "android")
    dialog.findViewById<TextView>(titleId)?.setTextColor(Color.parseColor("#FCF8EC"))
    listOf(AlertDialog.BUTTON_POSITIVE, AlertDialog.BUTTON_NEGATIVE).forEach { which ->
      dialog.getButton(which)?.apply {
        setTextColor(Color.parseColor("#FF5668"))
        isAllCaps = false
      }
    }
  }

  private fun refreshOverlay(triggerPackage: String? = null) {
    if (pendingFill != null) {
      hideOverlay()
      return
    }
    val root = rootInActiveWindow
    val rootPackage = root?.packageName?.toString()
    val fields = root?.classifiedCredentialFields().orEmpty()
    val target = root?.let { currentTarget(it, requireFieldInteraction = false) }
    val suppression = suppressedTarget
    if (suppression != null && (
      android.os.SystemClock.elapsedRealtime() > suppression.untilElapsedMs ||
        target != null && target != suppression.target
      )) {
      suppressedTarget = null
    }
    if (suppressedTarget?.target == target) {
      hideOverlay()
      return
    }
    val sameOfferedPackage = offeredPackage == rootPackage
    val shouldOffer = rootPackage != null && rootPackage != packageName && (
      fields.isNotEmpty() &&
        (fields.any { it.node.isFocused } || triggerPackage == rootPackage) ||
        overlayButton != null && sameOfferedPackage
      )
    if (shouldOffer) {
      offeredPackage = rootPackage
      showOverlay()
    } else {
      offeredPackage = null
      hideOverlay()
    }
  }

  private fun beginFillRequest(expectedTarget: AccessibilityTarget) {
    val target = currentTarget(expectedTarget)
    if (target == null) {
      Log.w(ACCESSIBILITY_LOG_TAG, "Autofill target was no longer available")
      return
    }
    val request = target.toRequest("accessibility-get")
    val requestFields = observedTargetRoot(target.packageName)
      ?.classifiedCredentialFields()
      .orEmpty()
    cancelRequestInternal(null)
    activeSession = AccessibilitySession(
      request,
      target,
      requestFields.firstOrNull { it.node.isFocused }?.role,
    )
    val handle = PendingCredentialRequests.register(request)
    launchCredentialRequest(request, handle)
  }

  private fun beginSaveRequest(expectedTarget: AccessibilityTarget) {
    val root = observedTargetRoot(expectedTarget.packageName) ?: return
    val target = currentTarget(root, requireFieldInteraction = false)
      ?.takeIf { it == expectedTarget }
      ?: return
    val fields = root.classifiedCredentialFields()
    val passwordFields = fields.filter { it.role == CredentialFieldRole.PASSWORD }
    val candidatePasswordFields = passwordFields.filter { it.isNewPassword }
      .ifEmpty { passwordFields }
    val passwordValues = candidatePasswordFields
      .mapNotNull { it.node.readFormValue() }
      .filterNot(String::looksRedacted)
      .distinct()
    if (passwordValues.size > 1) {
      Toast.makeText(this, "The password fields do not match.", Toast.LENGTH_LONG).show()
      return
    }
    val password = candidatePasswordFields.asReversed().asSequence()
      .mapNotNull { it.node.readFormValue() }
      .firstOrNull { value -> value in passwordValues }
    val explicitUsername = fields.asSequence()
      .filter { it.role == CredentialFieldRole.USERNAME }
      .mapNotNull { it.node.readFormValue() }
      .firstOrNull(String::isNotBlank).orEmpty()
    val email = fields.asSequence()
      .filter { it.role == CredentialFieldRole.EMAIL }
      .mapNotNull { it.node.readFormValue() }
      .firstOrNull(String::isNotBlank).orEmpty()
    val request = target.toRequest(
      kind = "accessibility-save",
      username = explicitUsername.ifEmpty { email },
      email = email.takeIf { explicitUsername.isNotEmpty() && it.isNotEmpty() },
      password = password,
    )
    cancelRequestInternal(null)
    val handle = PendingCredentialRequests.register(request)
    launchCredentialRequest(request, handle)
  }

  private fun launchCredentialRequest(request: PendingCredentialRequest, handle: String) {
    hideOverlay()
    val launch = packageManager.getLaunchIntentForPackage(packageName)
    if (launch == null || !launch.isOwnedByPackage(packageName)) {
      Log.e(ACCESSIBILITY_LOG_TAG, "Unable to open the credential review screen")
      return
    }
    launch.action = Intent.ACTION_VIEW
    launch.data = cryptexCredentialRequestUri()
    launch.putPendingRequestHandle(handle)
    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    PendingCredentialRequests.markDelivered(request.id)
    startActivity(launch)
  }

  private fun completeFillInternal(
    requestId: String,
    username: String,
    email: String,
    password: String,
    totp: String,
  ): Boolean {
    val session = activeSession ?: return false
    if (session.request.id != requestId || session.request.kind != "accessibility-get") {
      cancelRequestInternal(requestId)
      return false
    }
    if (!ProviderCredentialCache.isUnlocked()) return false
    cancelRequestInternal(null)
    val acceptedSession = session.copy(
      request = session.request.copy(createdAtElapsedMs = android.os.SystemClock.elapsedRealtime()),
    )
    activeSession = acceptedSession
    val fill = AccessibilityFill(acceptedSession, username, email, password, totp)
    pendingFill = fill
    scheduleFillAttempts(fill)
    return true
  }

  private fun cancelRequestInternal(requestId: String?) {
    if (requestId == null || activeSession?.request?.id == requestId) {
      pendingFill?.let(handler::removeCallbacksAndMessages)
      activeSession = null
      pendingFill = null
    }
  }

  private fun scheduleFillAttempts(expected: AccessibilityFill) {
    val start = SystemClock.uptimeMillis()
    listOf(200L, 600L, 1_200L, 2_000L).forEach { delay ->
      handler.postAtTime({ applyPendingFill(expected) }, expected, start + delay)
    }
    handler.postAtTime({
      if (pendingFill === expected) {
        Toast.makeText(this, "Cryptex Vault couldn't fill this form. Try standard autofill.", Toast.LENGTH_LONG).show()
        cancelRequestInternal(expected.session.request.id)
      }
    }, expected, start + 3_000L)
  }

  private fun applyPendingFill(fill: AccessibilityFill) {
    if (pendingFill !== fill) return
    if (!ProviderCredentialCache.isUnlocked() || !isRequestFresh(fill.session.request)) {
      cancelRequestInternal(fill.session.request.id)
      return
    }
    val root = rootInActiveWindow ?: return
    val activePackage = root.packageName?.toString() ?: return
    if (activePackage != fill.session.target.packageName) return
    val currentTarget = currentTarget(root) ?: return
    if (currentTarget != fill.session.target) return

    val fields = root.classifiedCredentialFields()
    val requestedFocusedRole = fill.session.focusedRole
    val suppliedValue = { role: CredentialFieldRole ->
      when (role) {
        CredentialFieldRole.USERNAME -> fill.username
        CredentialFieldRole.EMAIL -> fill.email.ifEmpty { fill.username }
        CredentialFieldRole.PASSWORD -> fill.password
        CredentialFieldRole.OTP -> fill.totp
      }
    }
    var filledAny = false
    var failedAny = false
    fields.forEach { field ->
      val value = suppliedValue(field.role)
      if (value.isNotEmpty() &&
        (requestedFocusedRole != CredentialFieldRole.OTP || field.role == CredentialFieldRole.OTP)
      ) {
        val arguments = Bundle().apply {
          putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, value)
        }
        val accepted = field.node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, arguments)
        if (accepted) filledAny = true else failedAny = true
      }
    }
    if (filledAny) {
      cancelRequestInternal(fill.session.request.id)
      if (failedAny) {
        Toast.makeText(this, "Some fields could not be filled. Check the form.", Toast.LENGTH_LONG).show()
      }
    }
  }

  private fun observedTargetRoot(expectedPackage: String? = offeredPackage): AccessibilityNodeInfo? {
    val activeRoot = rootInActiveWindow
    val activePackage = activeRoot?.packageName?.toString()
    if (
      activeRoot != null && activePackage != packageName &&
      (expectedPackage == null || activePackage == expectedPackage)
    ) return activeRoot
    return windows.asSequence()
      .mapNotNull { it.root }
      .firstOrNull { it.packageName?.toString() == expectedPackage }
  }

  private fun currentTarget(expectedTarget: AccessibilityTarget): AccessibilityTarget? {
    val root = observedTargetRoot(expectedTarget.packageName) ?: return null
    return currentTarget(root, requireFieldInteraction = false)
      ?.takeIf { it == expectedTarget }
  }

  private fun currentTarget(
    root: AccessibilityNodeInfo? = observedTargetRoot(),
    requireFieldInteraction: Boolean = true,
  ): AccessibilityTarget? {
    root ?: return null
    val currentPackage = root.packageName?.toString() ?: offeredPackage ?: return null
    if (currentPackage == packageName) return null
    val fields = root.classifiedCredentialFields()
    if (fields.isEmpty()) return null
    if (
      requireFieldInteraction &&
      fields.none { it.node.isFocused } &&
      offeredPackage != currentPackage
    ) return null
    val browser = BrowserAutofillPolicy.isKnownBrowser(currentPackage)
    val website = if (browser) {
      root.findBrowserWebsite(currentPackage)
        ?: return null // Never substitute a browser package for an unknown website.
    } else null
    val label = runCatching {
      val info = packageManager.getApplicationInfo(currentPackage, 0)
      packageManager.getApplicationLabel(info).toString()
    }.getOrNull()
    return AccessibilityTarget(currentPackage, label, website, root.windowId)
  }

  private fun AccessibilityTarget.toRequest(
    kind: String,
    username: String? = null,
    email: String? = null,
    password: String? = null,
  ) = PendingCredentialRequest(
    id = UUID.randomUUID().toString(),
    kind = kind,
    packageName = packageName,
    applicationLabel = applicationLabel,
    webDomain = website?.domain,
    webScheme = website?.scheme,
    warningType = when (website?.scheme) {
      null -> "unverified-app"
      "unknown" -> "unverified-web-scheme"
      else -> null
    },
    username = username,
    email = email,
    password = password,
  )
}

private fun AccessibilityNodeInfo.classifiedCredentialFields(): List<ClassifiedAccessibilityNode> =
  buildList {
    fun visit(node: AccessibilityNodeInfo?) {
      if (node == null) return
      if (node.isVisibleToUser && node.isEnabled && node.isEditableCredentialCandidate()) {
        classifyCredentialField(node)?.let { role ->
          add(
            ClassifiedAccessibilityNode(
              node,
              role,
              role == CredentialFieldRole.PASSWORD && node.isNewPasswordField(),
            ),
          )
        }
      }
      repeat(node.childCount) { visit(node.getChild(it)) }
    }
    visit(this@classifiedCredentialFields)
  }

private fun classifyCredentialField(node: AccessibilityNodeInfo): CredentialFieldRole? {
  if (!node.isEditableCredentialCandidate()) return null
  return CredentialFieldPolicy.classify(
    identity = node.credentialIdentity(),
    password = node.isPassword || node.inputType.isPasswordInput(),
    email = node.inputType and InputType.TYPE_MASK_VARIATION == InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS,
  )
}

private fun AccessibilityNodeInfo.isEditableCredentialCandidate(): Boolean =
  isEditable || actionList.any { it.id == AccessibilityNodeInfo.ACTION_SET_TEXT } ||
    className == "android.widget.EditText"

private fun AccessibilityNodeInfo.credentialIdentity(): String = listOfNotNull(
  viewIdResourceName?.substringAfterLast('/'),
  safeHintText(),
  contentDescription?.toString(),
).joinToString(" ")

private fun AccessibilityNodeInfo.isNewPasswordField(): Boolean =
  CredentialFieldPolicy.isNewPassword(credentialIdentity())

private fun Int.isPasswordInput(): Boolean {
  if (this and InputType.TYPE_CLASS_TEXT != InputType.TYPE_CLASS_TEXT) return false
  return when (this and InputType.TYPE_MASK_VARIATION) {
    InputType.TYPE_TEXT_VARIATION_PASSWORD,
    InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD,
    InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD -> true
    else -> false
  }
}

private fun AccessibilityNodeInfo.findBrowserWebsite(packageName: String): BrowserWebsite? {
  val candidates = mutableListOf<BrowserAddressBarCandidate>()
  fun visit(node: AccessibilityNodeInfo?) {
    if (node == null) return
    candidates += BrowserAddressBarCandidate(
      resourceName = node.viewIdResourceName,
      visible = node.isVisibleToUser,
      values = listOf(node.text?.toString()),
      contentDescription = node.contentDescription?.toString(),
    )
    repeat(node.childCount) { visit(node.getChild(it)) }
  }
  visit(this)
  return BrowserAutofillPolicy.resolveWebsite(packageName, candidates.asSequence())
}

private fun AccessibilityNodeInfo.readFormValue(): String? =
  text?.toString()?.trim()?.takeIf(String::isNotEmpty)

private fun String.looksRedacted(): Boolean =
  isNotEmpty() && all { it == '\u2022' || it == '\u25cf' || it == '*' || it == '\u00b7' }

private fun AccessibilityNodeInfo.safeHintText(): String? =
  if (Build.VERSION.SDK_INT >= 26) hintText?.toString() else null
