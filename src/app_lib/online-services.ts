import { z } from "zod";
import { trpc } from "../utils/trpc";

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
export const extractIDFromAPIKey = (apiKey: string): string => apiKey.slice(36);
export const constructLinkPresenceChannelName = (id: string) => {
    if (id?.includes("-")) {
        return `presence-link-${id.slice(36)}`;
    }

    return `presence-link-${id}`;
};
//#endregion Online Services
