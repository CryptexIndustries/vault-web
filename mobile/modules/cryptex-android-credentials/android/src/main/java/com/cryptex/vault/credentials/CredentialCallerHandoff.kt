package com.cryptex.vault.credentials

import android.app.Activity
import android.app.ActivityManager
import android.content.Intent

/**
 * Both Credential Manager and autofill put the relay in the requesting task.
 * Resume that existing result chain before finishing its relay. Backgrounding
 * MainActivity alone can expose the launcher when it sits between the tasks.
 */
internal fun returnCredentialCallerToFront(relay: Activity): Boolean = runCatching {
  relay.getSystemService(ActivityManager::class.java).moveTaskToFront(relay.taskId, 0)
  true
}.getOrDefault(false)

/** Called only after the module has consumed the exact authorized request. */
internal fun finishCredentialRelay(
  relay: Activity,
  host: Activity,
  resultCode: Int,
  result: Intent? = null,
  returnToCaller: Boolean = true,
) {
  relay.setResult(resultCode, result)
  val callerForegrounded = returnToCaller && returnCredentialCallerToFront(relay)
  relay.finish()
  if (returnToCaller && !callerForegrounded) host.moveTaskToBack(true)
}
