import { PermissionsAndroid, Platform } from "react-native";
import { requireOptionalNativeModule } from "expo-modules-core";

/**
 * JS side of modules/cryptex-agent-service: the special-use foreground service
 * that keeps the SSH agent approver connected, and its notifications. The
 * relay connection and all crypto stay in JS; Kotlin only owns the service,
 * the notifications and the reboot receiver.
 */

export type AgentNotificationAction = {
    action: "review" | "deny";
    requestId: string;
};

type AgentServiceModule = {
    /** Also remembered (or forgotten) for the next boot. */
    startService(): void;
    stopService(): void;
    isServiceRunning(): boolean;
    /** The user-visible device name (Settings > About phone), else the model. */
    getDeviceName(): string;
    /**
     * Posts or replaces the notification for one request. Private on the lock
     * screen (public version "Approval needed").
     */
    showRequestNotification(
        requestId: string,
        agentName: string,
        vaultLocked: boolean,
    ): void;
    cancelRequestNotification(requestId: string): void;
    /** Review and Deny taps not yet handled by JS (cold starts). */
    takePendingActions(): AgentNotificationAction[];
    areNotificationsEnabled(): boolean;
    openNotificationSettings(): boolean;
    /**
     * Ignores touches that pass through another app's window on top
     * (filterTouchesWhenObscured) and hides overlays on Android 12+.
     */
    setApprovalScreenProtected(enabled: boolean): void;
    /** Opens the system list of battery optimization settings. */
    openBatterySettings(): boolean;
    addListener(
        event: "onNotificationAction",
        listener: (event: AgentNotificationAction) => void,
    ): { remove: () => void };
};

const native =
    Platform.OS === "android"
        ? requireOptionalNativeModule<AgentServiceModule>("CryptexAgentService")
        : null;

export const HEADLESS_TASK_NAME = "CryptexAgentRuntime";

export const agentService = {
    available: native != null,
    start: () => native?.startService(),
    stop: () => native?.stopService(),
    isRunning: () => native?.isServiceRunning() ?? false,
    deviceName: () => native?.getDeviceName() ?? null,
    showRequest: (requestId: string, agentName: string, vaultLocked: boolean) =>
        native?.showRequestNotification(requestId, agentName, vaultLocked),
    cancelRequest: (requestId: string) =>
        native?.cancelRequestNotification(requestId),
    takePendingActions: (): AgentNotificationAction[] =>
        native?.takePendingActions() ?? [],
    notificationsEnabled: () => native?.areNotificationsEnabled() ?? false,
    openNotificationSettings: () => native?.openNotificationSettings() ?? false,
    setApprovalScreenProtected: (enabled: boolean) =>
        native?.setApprovalScreenProtected(enabled),
    openBatterySettings: () => native?.openBatterySettings() ?? false,
    addActionListener: (listener: (event: AgentNotificationAction) => void) =>
        native?.addListener("onNotificationAction", listener) ?? {
            remove: () => undefined,
        },
};

/** Asks for POST_NOTIFICATIONS on Android 13+; true when granted. */
export async function requestNotificationPermission(): Promise<boolean> {
    if (Platform.OS !== "android") return false;
    if (typeof Platform.Version === "number" && Platform.Version < 33)
        return true;
    const result = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
    );
    return result === PermissionsAndroid.RESULTS.GRANTED;
}
