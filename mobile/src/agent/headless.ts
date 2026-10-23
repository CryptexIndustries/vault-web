import { AppRegistry } from "react-native";

import { HEADLESS_TASK_NAME } from "./agent-service";

/**
 * The agent service runs this task whenever it starts (app start, reboot,
 * update, or Android restarting it). While a headless task runs, React
 * Native keeps JS timers going in the background, which the relay
 * keep-alive and reconnects need. So the task stays pending until the
 * runtime stops. The vault stays locked: requests only post notifications
 * until the user unlocks.
 */
AppRegistry.registerHeadlessTask(HEADLESS_TASK_NAME, () => async () => {
    const { agentRuntime } = await import("./agent-app");
    const { notificationActions } = await import("./notification-actions");
    // Deny taps work with no UI running (after a reboot or a swipe-away):
    // listen and take stored ones before requests come in.
    notificationActions.listen();
    if (!agentRuntime.running) await agentRuntime.reload();
    await agentRuntime.whenStopped();
});
