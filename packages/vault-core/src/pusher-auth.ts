/**
 * Wire-compatible Pusher presence-channel HMAC authorizer.
 *
 * Matches the Node `pusher` SDK `authorizeChannel` output for presence channels:
 *   auth = `${key}:${hmac_sha256_hex(secret, `${socketId}:${channel}:${channel_data}`)}`
 *   channel_data = JSON.stringify(userData)
 *
 * Uses Web Crypto on every supported platform. Keeping Node-only imports out
 * of this module is intentional: Metro must be able to bundle the same source
 * for React Native.
 */

export type PresenceChannelUserData = {
    user_id: string;
    user_info?: Record<string, unknown>;
};

export type PresenceChannelAuthResponse = {
    auth: string;
    channel_data: string;
};

export type AuthorizePresenceChannelInput = {
    key: string;
    secret: string;
    socketId: string;
    channelName: string;
    userData: PresenceChannelUserData;
};

function assertValidSocketId(socketId: string): void {
    if (
        typeof socketId !== "string" ||
        socketId === "" ||
        !/^\d+\.\d+$/.test(socketId)
    ) {
        throw new Error(`Invalid socket id: '${socketId}'`);
    }
}

function assertValidChannelName(channelName: string): void {
    if (
        typeof channelName !== "string" ||
        channelName === "" ||
        /[^A-Za-z0-9_\-=@,.;]/.test(channelName)
    ) {
        throw new Error(`Invalid channel name: '${channelName}'`);
    }
    if (channelName.length > 200) {
        throw new Error(`Channel name too long: '${channelName}'`);
    }
}

function utf8Bytes(value: string): Uint8Array {
    return new TextEncoder().encode(value);
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) {
        throw new Error("Web Crypto HMAC is unavailable on this platform.");
    }

    const key = await subtle.importKey(
        "raw",
        utf8Bytes(secret) as BufferSource,
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
    );
    const sig = await subtle.sign(
        "HMAC",
        key,
        utf8Bytes(message) as BufferSource,
    );
    return Array.from(new Uint8Array(sig))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}

/**
 * Authorize a Pusher presence (or private) channel membership.
 * For presence channels, `userData` is required and becomes `channel_data`.
 */
export async function authorizePresenceChannel(
    input: AuthorizePresenceChannelInput,
): Promise<PresenceChannelAuthResponse> {
    const { key, secret, socketId, channelName, userData } = input;

    assertValidSocketId(socketId);
    assertValidChannelName(channelName);

    if (!userData?.user_id) {
        throw new Error("Presence channel auth requires userData.user_id");
    }

    const channelData = JSON.stringify(userData);
    const signaturePayload = `${socketId}:${channelName}:${channelData}`;
    const signature = await hmacSha256Hex(secret, signaturePayload);

    return {
        auth: `${key}:${signature}`,
        channel_data: channelData,
    };
}
