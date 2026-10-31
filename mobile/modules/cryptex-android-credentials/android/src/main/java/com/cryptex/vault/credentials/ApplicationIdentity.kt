package com.cryptex.vault.credentials

import android.content.Context
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.net.Uri
import android.os.Build
import androidx.core.app.LocaleManagerCompat
import androidx.core.os.ConfigurationCompat

/** Host resource overlays bind credential UI and routes to this app profile. */
internal fun Context.cryptexProviderName(): String = getString(R.string.cryptex_provider_name)

/**
 * Before Android 13, AppCompat applies the in-app language to activities only, so text built
 * in a service would follow the device language. LocaleManagerCompat reads the saved choice without an activity.
 */
internal fun Context.appLocalized(): Context {
  if (Build.VERSION.SDK_INT >= 33) return this
  val locales = LocaleManagerCompat.getApplicationLocales(this)
  if (locales.isEmpty) return this
  val config = Configuration(resources.configuration)
  ConfigurationCompat.setLocales(config, locales)
  return createConfigurationContext(config)
}
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
