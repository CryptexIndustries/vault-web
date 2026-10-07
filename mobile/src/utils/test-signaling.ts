/**
 * Smoke-test custom Pusher-compatible signaling via vault-core init + HMAC auth.
 * Does not log secrets.
 */
import * as Synchronization from "@cryptex-industries/vault-core/synchronization";
import type { SignalingServerConfiguration } from "@cryptex-industries/vault-core/proto";
import { constructLinkPresenceChannelName } from "@cryptex-industries/vault-core/presence";
import { ulid } from "ulidx";

type SignalingTestResult =
    | { ok: true; message: string }
    | { ok: false; message: string };

export async function testSignalingServerConnection(
    server: SignalingServerConfiguration,
    timeoutMs = 15_000,
): Promise<SignalingTestResult> {
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

            const timer = setTimeout(() => finish(false), timeoutMs);

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
