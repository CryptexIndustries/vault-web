import { createHmac, webcrypto } from "node:crypto";
import { TextEncoder } from "node:util";

import { describe, expect, it } from "@jest/globals";

import { authorizePresenceChannel } from "../pusher-auth";

Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: webcrypto,
});
Object.defineProperty(globalThis, "TextEncoder", {
    configurable: true,
    value: TextEncoder,
});

/**
 * Golden vectors match the Node `pusher` SDK authorizeChannel wire format:
 *   auth = key + ":" + hex(HMAC-SHA256(secret, socketId + ":" + channel + ":" + channel_data))
 *   channel_data = JSON.stringify(userData)
 */
describe("authorizePresenceChannel (Pusher presence HMAC)", () => {
    const key = "app-key-abc";
    const secret = "app-secret-xyz";
    const socketId = "1234.5678";
    const channelName = "presence-sync-01HTESTCHANNEL";
    const userData = {
        user_id: "01HUSERID0000000000000000",
        user_info: { id: "01HUSERID0000000000000000" },
    };

    const channelData = JSON.stringify(userData);
    const expectedSignature = createHmac("sha256", secret)
        .update(`${socketId}:${channelName}:${channelData}`)
        .digest("hex");
    const expectedAuth = `${key}:${expectedSignature}`;

    it("matches the Node pusher SDK wire format", async () => {
        const result = await authorizePresenceChannel({
            key,
            secret,
            socketId,
            channelName,
            userData,
        });

        expect(result.channel_data).toBe(channelData);
        expect(result.auth).toBe(expectedAuth);
    });

    it("authorizes presence channel data", async () => {
        const result = await authorizePresenceChannel({
            key,
            secret,
            socketId,
            channelName,
            userData,
        });

        expect(result.channel_data).toBe(channelData);
        expect(result.auth).toBe(expectedAuth);
    });

    it("rejects invalid socket id", async () => {
        await expect(
            authorizePresenceChannel({
                key,
                secret,
                socketId: "not-a-socket",
                channelName,
                userData,
            }),
        ).rejects.toThrow(/Invalid socket id/);
    });

    it("rejects missing user_id", async () => {
        await expect(
            authorizePresenceChannel({
                key,
                secret,
                socketId,
                channelName,
                userData: { user_id: "" },
            }),
        ).rejects.toThrow(/user_id/);
    });
});
