import Pusher from "pusher-js";
import { z } from "zod";
import { env } from "../env/client.mjs";
import { createAuthHeader, trpc } from "../utils/trpc";

/**
 * A function to check if cryptex-vault.com/app is available.
 */
// const isOriginAvailable = async (): Promise<boolean> => {
//     try {
//         const res = await fetch("/api/health");
//         return res.status === 200;
//     } catch (e) {
//         console.debug("Application origin is unreachable or is offline.", e);
//         return false;
//     }
// };

//#region Sign up
export const signUpFormSchema = z.object({
    captchaToken: z.string().min(1, "Captcha is required."),
});
export type SignUpFormSchemaType = z.infer<typeof signUpFormSchema>;
//#endregion Sign up

//#region Subscription
export const openCustomerPortal = async () => {
    const customerPortalURL =
        await trpc.v1.payment.customerPortal.query(undefined);

    if (customerPortalURL) window.open(customerPortalURL, "_blank");
};

export const navigateToCheckout = async (): Promise<void> => {
    const checkoutSessionURL = await trpc.v1.payment.checkoutURL.query();

    if (!checkoutSessionURL?.length) {
        throw new Error("Failed to fetch checkout session URL.");
    }

    // Navigate to the checkout session URL
    location.replace(checkoutSessionURL);
};
//#endregion Subscription

//#region Online Services - Synchronization
export const newWebRTCConnection = async (): Promise<RTCPeerConnection> => {
    return new RTCPeerConnection({
        iceServers: [
            {
                urls: "stun:rtc.cryptex-vault.com:5349",
            },
            {
                urls: "turn:rtc.cryptex-vault.com:5349",
                username: "cryx",
                credential: "cryx",
            },
            {
                urls: "stun:stun.l.google.com:19302",
            },
            {
                urls: "stun:stun1.l.google.com:19302",
            },
            {
                urls: "stun:stun2.l.google.com:19302",
            },
            {
                urls: "stun:stun.ekiga.net",
            },
        ],
    });
};

export const newWSPusherInstance = (): Pusher =>
    new Pusher(env.NEXT_PUBLIC_PUSHER_APP_KEY, {
        wsHost: env.NEXT_PUBLIC_PUSHER_APP_HOST,
        wsPort: parseInt(env.NEXT_PUBLIC_PUSHER_APP_PORT) ?? 6001,
        wssPort: parseInt(env.NEXT_PUBLIC_PUSHER_APP_PORT) ?? 6001,
        forceTLS: env.NEXT_PUBLIC_PUSHER_APP_TLS,
        // encrypted: true,
        enableStats: false,
        enabledTransports: ["ws", "wss"],
        cluster: "",
        userAuthentication: {
            transport: "ajax",
            endpoint: "",
            headersProvider: createAuthHeader,
            customHandler: (req, next) => {
                console.debug("Pusher auth request", req, next);
                // return next(req);
            },
        },
        channelAuthorization: {
            transport: "ajax",
            endpoint: "",
            headersProvider: createAuthHeader,
            customHandler: async (req, next) => {
                // console.debug("Pusher auth channel request", req, next);

                try {
                    const data =
                        await trpc.v1.device.signalingAuthChannel.query({
                            channel_name: req.channelName,
                            socket_id: req.socketId,
                        });

                    return next(null, data);
                } catch (e) {
                    console.error("Failed to authorize Pusher channel", e);
                    return next(e as Error, null);
                }
            },
        },
    });

export const constructSyncChannelName = (
    ourCreationTimestamp: number,
    ourID: string,
    otherDeviceID: string,
    linkedAtTimestamp: number,
): string => {
    // The senior device is the one that was created first
    const thisSenior = ourCreationTimestamp < linkedAtTimestamp;

    // If we're the senior device, we fill the senior device slot
    const seniorDevice = thisSenior ? ourID : otherDeviceID;

    // If we're the senior device, the other device is the junior device
    const juniorDevice = thisSenior ? otherDeviceID : ourID;

    return `presence-sync-${seniorDevice}_${juniorDevice}`;
};

export const extractIDFromAPIKey = (apiKey: string): string => apiKey.slice(36);
export const constructLinkPresenceChannelName = (apiKey: string) => {
    const apiKeyID = apiKey.slice(36);
    return `presence-link-${apiKeyID}`;
};
//#endregion Online Services
