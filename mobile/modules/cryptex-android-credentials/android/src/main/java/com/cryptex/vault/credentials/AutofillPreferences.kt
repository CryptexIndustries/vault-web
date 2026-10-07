package com.cryptex.vault.credentials

import android.content.Context

internal object AutofillPreferences {
  private const val FILE_NAME = "cryptex_autofill"
  private const val INLINE_KEY = "inline_suggestions"

  fun inlineSuggestionsEnabled(context: Context): Boolean =
    context.getSharedPreferences(FILE_NAME, Context.MODE_PRIVATE)
      .getBoolean(INLINE_KEY, true)

  fun setInlineSuggestionsEnabled(context: Context, enabled: Boolean) {
    context.getSharedPreferences(FILE_NAME, Context.MODE_PRIVATE)
      .edit()
      .putBoolean(INLINE_KEY, enabled)
      .apply()
  }
}
