import type { SignInResponse } from "next-auth/react";
import { signIn, signOut } from "next-auth/react";
import { z } from "zod";
import * as sodium from "libsodium-wrappers-sumo";
import { toast } from "react-toastify";
import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "../server/trpc";

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

/**
 * A function to check if cryptex-vault.com/app is available.
 */
export const isOriginAvailable = async (): Promise<boolean> => {
    try {
        const res = await fetch("/api/health");
        return res.status === 200;
    } catch (e) {
        console.debug("Application origin is unreachable or is offline.", e);
        return false;
    }
};

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
            autoClose: 3000,
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
            autoClose: 3000,
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

    debugger;

    if (!checkoutSessionURL?.length) {
        throw new Error("Failed to fetch checkout session URL.");
    }

    // Navigate to the checkout session URL
    location.replace(checkoutSessionURL);
};
//#endregion Subscription
