package com.cryptex.vault.agent

import android.content.Context
import android.content.Intent
import android.util.Log
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.ReactInstanceEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext

/**
 * Runs the JS task "CryptexAgentRuntime" for as long as the foreground service runs.
 *
 * React Native pauses JS timers while the activity is paused unless a headless task is
 * active, so the task is started whether or not the app UI is alive (allowed in foreground).
 * The task has no timeout; JS should keep its promise pending until the runtime stops.
 *
 * HeadlessJsTaskService.startTask holds a partial wake lock until the service is destroyed.
 * For a task that lasts hours that drains the battery, so this service starts the task
 * itself without that wake lock. The connection relies on network wakeups instead.
 */
class CryptexAgentHeadlessService : HeadlessJsTaskService() {
  companion object {
    private const val TAG = "CryptexAgentService"
    private const val TASK_NAME = "CryptexAgentRuntime"

    fun start(context: Context) {
      try {
        context.startService(Intent(context, CryptexAgentHeadlessService::class.java))
      } catch (error: IllegalStateException) {
        Log.w(TAG, "SSH agent runtime could not start", error)
      }
    }

    fun stop(context: Context) {
      context.stopService(Intent(context, CryptexAgentHeadlessService::class.java))
    }
  }

  private var activeTaskId: Int? = null
  private var starting = false
  private var destroyed = false

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (activeTaskId != null || starting) return START_NOT_STICKY
    val current = try {
      reactContext
    } catch (error: IllegalStateException) {
      Log.w(TAG, "React host is not available", error)
      stopSelf()
      return START_NOT_STICKY
    }
    if (current != null) {
      runTask(current)
      return START_NOT_STICKY
    }
    val host = reactHost
    if (host == null) {
      Log.w(TAG, "SSH agent runtime needs the React Native new architecture")
      stopSelf()
      return START_NOT_STICKY
    }
    starting = true
    host.addReactInstanceEventListener(
      object : ReactInstanceEventListener {
        override fun onReactContextInitialized(context: ReactContext) {
          host.removeReactInstanceEventListener(this)
          UiThreadUtil.runOnUiThread {
            starting = false
            if (!destroyed) runTask(context)
          }
        }
      },
    )
    host.start()
    return START_NOT_STICKY
  }

  private fun runTask(context: ReactContext) {
    val config = HeadlessJsTaskConfig(TASK_NAME, Arguments.createMap(), 0L, true)
    val tasks = HeadlessJsTaskContext.getInstance(context)
    tasks.addTaskEventListener(this)
    try {
      activeTaskId = tasks.startTask(config)
    } catch (error: RuntimeException) {
      Log.w(TAG, "SSH agent runtime task did not start", error)
      stopSelf()
    }
  }

  override fun onHeadlessJsTaskStart(taskId: Int) = Unit

  override fun onHeadlessJsTaskFinish(taskId: Int) {
    // Listeners hear about every app task; only ours ends this service.
    if (taskId != activeTaskId) return
    activeTaskId = null
    stopSelf()
  }

  override fun onDestroy() {
    destroyed = true
    starting = false
    val taskId = activeTaskId
    activeTaskId = null
    val context = try {
      reactContext
    } catch (_: IllegalStateException) {
      null
    }
    super.onDestroy()
    // Mark the JS task finished so React Native can pause timers again.
    if (taskId != null && context != null) HeadlessJsTaskContext.getInstance(context).finishTask(taskId)
  }
}
