package com.cryptex.vault.credentials

import android.app.Activity
import android.content.Intent

/** Debug-only activities recreate the requesting/relay/host task arrangement. */
object CredentialHandoffTestState {
  @Volatile var resumed: Activity? = null
  @Volatile var resultCode: Int? = null
  @Volatile var resultValue: String? = null
}

open class CredentialHandoffTrackedActivity : Activity() {
  override fun onResume() {
    super.onResume()
    CredentialHandoffTestState.resumed = this
  }
}

class CredentialHandoffCallerActivity : CredentialHandoffTrackedActivity() {
  @Deprecated("Activity result callback is intentional: it models the provider relay contract.")
  override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
    super.onActivityResult(requestCode, resultCode, data)
    if (requestCode == 73) {
      CredentialHandoffTestState.resultCode = resultCode
      CredentialHandoffTestState.resultValue = data?.getStringExtra("result")
    }
  }
}

class CredentialHandoffRelayActivity : CredentialHandoffTrackedActivity()
class CredentialHandoffUnrelatedActivity : CredentialHandoffTrackedActivity()
class CredentialHandoffHostActivity : CredentialHandoffTrackedActivity()
