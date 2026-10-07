package com.cryptex.vault.credentials

import android.content.Context
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri

/** Host resource overlays bind credential UI and routes to this app profile. */
internal fun Context.cryptexProviderName(): String = getString(R.string.cryptex_provider_name)
internal fun Intent.isOwnedByPackage(packageName: String): Boolean = component?.packageName == packageName

internal fun Context.isOwnActivityClass(className: String?): Boolean {
  if (className.isNullOrBlank()) return false
  return try {
    packageManager.getActivityInfo(ComponentName(packageName, className), 0).packageName == packageName
  } catch (_: PackageManager.NameNotFoundException) {
    false
  }
}

internal fun Context.cryptexCredentialRequestUri(query: String? = null): Uri {
  val scheme = getString(R.string.cryptex_app_scheme)
  return Uri.parse("$scheme://credential-request" + (query?.let { "?$it" } ?: ""))
}
