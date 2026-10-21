import { Approver } from "@cryptex-industries/vault-core/agent/approver";
import type { WebSocketLike } from "@cryptex-industries/vault-core/agent/approver-types";
import { HOSTED_RELAY_URL } from "@cryptex-industries/vault-core/agent/relay-client";
import { env } from "@/env/public";
import {
    onlineServicesDataAtom,
    onlineServicesStore,
    unlockedVaultMetadataAtom,
    vaultGet,
    vaultStore,
} from "@/utils/atoms";
import { vaultLog } from "@/utils/logging";
import { isCloudServicesEnabled } from "@/utils/online-services-api-url";
import { isVaultAutoLockDue } from "@/utils/vault-auto-lock";
import { persistVaultMutation } from "@/utils/vault-mutations";
import { getVaultDEKFromSession } from "@/utils/vault-session";
import type { LockManagerLike } from "./tab-leadership";
import {
    browserDeviceName,
    WebAgentHost,
    type AgentNotifications,
} from "./web-agent-host";

/** The hosted relay this deployment uses (Online Services). */
export function hostedRelayUrl(): string {
    return env.NEXT_PUBLIC_RELAY_URL.trim() || HOSTED_RELAY_URL;
}

/**
 * Browser notifications for requests that arrive while the tab is hidden.
 * Only the agent name: no host, key or process details.
 */
function browserNotifications(): AgentNotifications {
    const shown = new Map<string, Notification>();
    const close = (id: string) => {
        shown.get(id)?.close();
        shown.delete(id);
    };
    return {
        show(id, agentName, onClick) {
            if (
                typeof Notification === "undefined" ||
                Notification.permission !== "granted"
            )
                return;
            close(id);
            try {
                const notification = new Notification(
                    `SSH request from ${agentName}`,
                    {
                        body: "Review it in Cryptex Vault",
                        tag: `cryptex-agent-${id}`,
                    },
                );
                notification.onclick = () => {
                    onClick();
                    close(id);
                };
                shown.set(id, notification);
            } catch (error) {
                // Some mobile browsers only allow service worker notifications.
                vaultLog.warn("Couldn't show the SSH request notification", {
                    error,
                });
            }
        },
        close,
        closeAll() {
            for (const id of shown.keys()) close(id);
        },
    };
}

/**
 * Asks for notification permission when the user connects their first
 * agent. Call it from the click, so the browser sees a user gesture.
 */
export function askForNotificationPermission() {
    if (
        typeof Notification === "undefined" ||
        Notification.permission !== "default"
    )
        return;
    void Notification.requestPermission().catch(() => undefined);
}

export function createBrowserAgentHost(): WebAgentHost {
    return new WebAgentHost({
        getVault: vaultGet,
        canSign: () =>
            vaultStore.get(unlockedVaultMetadataAtom) !== null &&
            getVaultDEKFromSession().isOk() &&
            !isVaultAutoLockDue(),
        persist: async (kind, mutate) =>
            (
                await persistVaultMutation(kind, async (current) => ({
                    vault: await mutate(current),
                    result: undefined,
                }))
            ).isOk(),
        hostedRelayUrl: hostedRelayUrl(),
        deviceName: () => browserDeviceName(navigator.userAgent),
        requestPass: async (key) => {
            if (
                !isCloudServicesEnabled() ||
                !onlineServicesStore.get(onlineServicesDataAtom)?.sessionToken
            )
                return null;
            const { trpc } = await import("@/utils/trpc");
            return trpc.v1.relay.pass.mutate({ key });
        },
        locks: (navigator as Navigator & { locks?: LockManagerLike }).locks,
        notifications: browserNotifications(),
        isVisible: () => document.visibilityState === "visible",
        focusWindow: () => window.focus(),
        createApprover: (host) => new Approver(host),
        openWebSocket: (url, protocols) =>
            new WebSocket(url, protocols) as unknown as WebSocketLike,
        fetch: (...args) => fetch(...args),
        sign: async (key, publicBlob, data, flags, options) => {
            // Loads the key parsing and curve code only when a request is approved.
            const { signSSH } =
                await import("@cryptex-industries/vault-core/vault-utils/ssh-sign");
            return signSSH(key, publicBlob, data, flags, options);
        },
        log: (message, detail) =>
            vaultLog.info(`Agent: ${message}`, { detail }),
    });
}
