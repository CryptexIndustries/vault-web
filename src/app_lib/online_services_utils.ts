import type { SignInResponse } from "next-auth/react";
import { signIn, signOut } from "next-auth/react";
import { z } from "zod";
import * as sodium from "libsodium-wrappers-sumo";
import { toast } from "react-toastify";
import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "../server/trpc";
import Pusher from "pusher-js";
import { env } from "../env/client.mjs";

const createTRPCClient = () => {
    return createTRPCProxyClient<AppRouter>({
        links: [
            httpBatchLink({
                url: "/api/trpc",
            }),
        ],
        transformer: superjson,
    });
};

/**
 * A function to check if cryptex-vault.com/app is available.
 */
const isOriginAvailable = async (): Promise<boolean> => {
    try {
        const res = await fetch("/api/health");
        return res.status === 200;
    } catch (e) {
        console.debug("Application origin is unreachable or is offline.", e);
        return false;
    }
};

//#region Sign up
export const signUpFormSchema = z.object({
    email: z.string().email(),
    captchaToken: z.string().nonempty("Captcha is required."),
});
export type SignUpFormSchemaType = z.infer<typeof signUpFormSchema>;
//#endregion Sign up

//#region Encryption
/**
 * Generates a public and private key pair using libsodium-wrappers-sumo.
 * @returns An object containing the public and private keys as b64 encoded strings
 */
export const generateKeyPair = async (): Promise<{
    publicKey: string;
    privateKey: string;
}> => {
    await sodium.ready;
    const { publicKey, privateKey } = sodium.crypto_sign_keypair();
    return {
        publicKey: sodium.to_base64(publicKey),
        privateKey: sodium.to_base64(privateKey),
    };
};

/**
 * Signs the provided data using the provided private key.
 * @param data Some data received from the server to sign
 * @param privateKey The user's private key
 * @returns The signature as a b64 encoded string
 */
const signData = async (data: string, privateKey: string): Promise<string> => {
    await sodium.ready;

    // console.warn(`|signData| Signing data: ${data} with key: ${privateKey}`);

    const signature = sodium.crypto_sign(
        sodium.from_string(data),
        sodium.from_base64(privateKey)
    );
    return sodium.to_base64(signature);
};
//#endregion Encryption

//#region Session managements - Authentication
const getNonce = async (): Promise<string> => {
    // Fetch the nonce from the server using trpc from outside the component
    const trpcClient = createTRPCClient();

    const authNonceRes = await trpcClient.credentials.generateAuthNonce.query();

    if (!authNonceRes?.length) {
        throw new Error("Failed to fetch auth nonce.");
    }

    return authNonceRes;
};

/**
 * Triggers the next-auth signin callback.
 * @param userID The user's ID - generated at signup
 * @param privateKey The user's private key - generated at signup
 */
const handleSignIn = async (
    userID: string,
    privateKey: string,
    captchaToken: string
): Promise<SignInResponse | undefined> => {
    const authNonce = await getNonce();

    const signature = await signData(authNonce, privateKey);

    // Trigger the signin callback
    return await signIn("cryptex-key-based", {
        redirect: false,
        userID,
        nonce: authNonce,
        signature,
        captchaToken,
    });
};

interface CryptexSignInResponse {
    success: boolean;
    offline: boolean;
    authResponse: SignInResponse | undefined;
}

/**
 * Signs the user in using the provided user ID and private key.
 * @param userID The user's ID - generated at signup
 * @param privateKey The user's private key - generated at signup
 * @returns An object containing the success status and the auth response
 * @see CryptexSignInResponse
 * @throws Does not throw an error, but logs and toasts an error message
 */
export const cryptexAccountSignIn = async (
    userID: string,
    privateKey: string,
    captchaToken: string
): Promise<CryptexSignInResponse> => {
    // If we're offline, don't try to sign in
    if (!(await isOriginAvailable())) {
        console.debug("Cannot sign in while offline.");
        toast.info("Offline mode enabled.", {
            closeButton: true,
        });
        return {
            success: false,
            authResponse: undefined,
            offline: true,
        };
    }

    try {
        const signinRes = await handleSignIn(userID, privateKey, captchaToken);

        if (!signinRes) {
            throw new Error("Failed to sign in.");
        }

        return {
            success: signinRes.ok,
            authResponse: signinRes,
            offline: false,
        };
    } catch (e) {
        console.error("Failed to sign in.", e);

        toast.error("Failed to sign in.", {
            closeButton: true,
        });
    }
    return {
        success: false,
        authResponse: undefined,
        offline: false,
    };
};

/**
 * Provides a nice interface for clearing the session and signing in.
 * This is triggered when the user unlocks the vault - whether or not they have a bound account.
 * @param userID The user's ID - generated at signup
 * @param privateKey The user's private key - generated at signup
 * @throws Does not throw an error, but logs and toasts an error message in case sign in fails
 */
export const cryptexAccountInit = async (
    captchaToken: string,
    userID?: string,
    privateKey?: string
): Promise<CryptexSignInResponse> => {
    try {
        await signOut({
            redirect: false,
        });
    } catch (e) {
        console.error("Failed to clean up session.", e);
    }

    // Perform the sign in if the user ID and private key are provided
    if (userID && privateKey) {
        return cryptexAccountSignIn(userID, privateKey, captchaToken);
    }

    // We return this in case the user ID and private key are not provided
    // AKA we just cleaned up the last session
    return {
        success: false,
        authResponse: undefined,
        offline: false,
    };
};
//#endregion Session management - Authentication

//#region Subscription
export const navigateToCheckout = async (): Promise<void> => {
    // const stripePriceID =
    //     process.env.NEXT_PUBLIC_STRIPE_PREMIUM_YEARLY_PRICE_ID;

    // if (!stripePriceID) {
    //     throw new Error("Stripe price ID is not defined.");
    // }

    // Get the checkout session from the server using trpc
    const trpcClient = createTRPCClient();

    const checkoutSessionURL = await trpcClient.payment.getCheckoutURL.query();

    if (!checkoutSessionURL?.length) {
        throw new Error("Failed to fetch checkout session URL.");
    }

    // Navigate to the checkout session URL
    location.replace(checkoutSessionURL);
};
//#endregion Subscription

//#region OnlineServices
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
        disableStats: true,
        enabledTransports: ["ws", "wss"],
        cluster: "",
        userAuthentication: {
            transport: "ajax",
            endpoint: "/api/pusher/auth",
        },
        channelAuthorization: {
            transport: "ajax",
            endpoint: "/api/pusher/channel-auth",
        },
    });

export const constructSyncChannelName = (
    ourCreationTimestamp: number,
    ourID: string,
    otherDeviceID: string,
    linkedAtTimestamp: number
): string => {
    // The senior device is the one that was created first
    const thisSenior = ourCreationTimestamp < linkedAtTimestamp;

    // If we're the senior device, we fill the senior device slot
    const seniorDevice = thisSenior ? ourID : otherDeviceID;

    // If we're the senior device, the other device is the junior device
    const juniorDevice = thisSenior ? otherDeviceID : ourID;

    return `presence-sync-${seniorDevice}_${juniorDevice}`;
};
//#endregion OnlineServices
