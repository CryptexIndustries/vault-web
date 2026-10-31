/** Joins a presence channel on the server, which checks its key and secret. */
import * as Synchronization from "@cryptex-industries/vault-core/synchronization";
import type { SignalingServerConfiguration } from "@cryptex-industries/vault-core/proto";
import { constructLinkPresenceChannelName } from "@cryptex-industries/vault-core/presence";
import { ulid } from "ulidx";

export async function testSignalingServerConnection(
    server: SignalingServerConfiguration,
): Promise<{ ok: boolean; message: string }> {
    const syncId = ulid();
    const channelName = constructLinkPresenceChannelName(syncId);
    let pusher: ReturnType<typeof Synchronization.initPusherInstance> | null =
        null;

    try {
        const connection = Synchronization.initPusherInstance(server, syncId);
        pusher = connection;

        const connected = await new Promise<boolean>((resolve) => {
            let settled = false;
            const finish = (value: boolean) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolve(value);
            };

            const timer = setTimeout(() => finish(false), 15_000);

            connection.connection.bind("connected", () => {
                const channel = connection.subscribe(channelName);
                channel.bind("pusher:subscription_succeeded", () =>
                    finish(true),
                );
                channel.bind("pusher:subscription_error", () => finish(false));
            });
            connection.connection.bind("failed", () => finish(false));
            connection.connection.bind("unavailable", () => finish(false));
            connection.connection.bind("error", () => finish(false));
        });

        if (!connected) {
            return {
                ok: false,
                message:
                    "Could not connect or authorize presence channel. Check host, ports, key, and secret.",
            };
        }

        return {
            ok: true,
            message: "Signaling server reachable and presence auth succeeded.",
        };
    } catch (error) {
        return {
            ok: false,
            message:
                error instanceof Error
                    ? error.message
                    : "Signaling test failed.",
        };
    } finally {
        try {
            pusher?.disconnect();
        } catch {
            // ignore teardown errors
        }
    }
}
