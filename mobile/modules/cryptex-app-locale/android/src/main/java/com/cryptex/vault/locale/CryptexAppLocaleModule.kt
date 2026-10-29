package com.cryptex.vault.locale

import android.os.Build
import androidx.appcompat.app.AppCompatDelegate
import androidx.core.app.LocaleManagerCompat
import androidx.core.os.LocaleListCompat
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * The app language chosen in Settings. On Android 13+ this is the same value as
 * the system's per-app language setting.
 */
class CryptexAppLocaleModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("CryptexAppLocale")

    /** The chosen language tag, or null to follow the device. */
    Function("getAppLocale") {
      val context = appContext.reactContext ?: return@Function null
      // Before Android 13, AppCompat saves a new choice to disk asynchronously; while an
      // activity is open its in-memory value is current. Without one (headless start
      // after a reboot), only the saved value exists.
      val locales =
        if (Build.VERSION.SDK_INT < 33 && appContext.currentActivity != null) {
          AppCompatDelegate.getApplicationLocales()
        } else {
          LocaleManagerCompat.getApplicationLocales(context)
        }
      locales.get(0)?.toLanguageTag()
    }

    AsyncFunction("setAppLocale") { tag: String? ->
      AppCompatDelegate.setApplicationLocales(
        if (tag == null) LocaleListCompat.getEmptyLocaleList() else LocaleListCompat.forLanguageTags(tag),
      )
    }.runOnQueue(Queues.MAIN)
  }
}
