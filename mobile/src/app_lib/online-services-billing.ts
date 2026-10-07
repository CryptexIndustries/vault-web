import { Linking } from "react-native";
import Constants from "expo-constants";
import { TRPCClientError } from "@trpc/client";

import { trpc } from "@/utils/trpc";
import { onlineServicesLog } from "@/utils/logging";
import { syncOnlineServicesRemoteConfiguration } from "@/app_lib/auth-session";
import {
    getVaultSessionGeneration,
    isSameActiveVaultSession,
} from "@/utils/vault-session";

export type CheckoutTier = "premiumMonthly" | "premiumYearly";
type Subscription = Awaited<
    ReturnType<typeof trpc.v1.payment.subscription.query>
>;
export type BillingConfirmation = {
    generation: number;
    deadline: number;
    nextPollAt: number;
    attempts: number;
    subscription: Subscription | null;
};

/**
 * Open Stripe Customer Portal in the system browser (not an embedded WebView).
 */
export async function openCustomerPortalExternal(): Promise<
    { ok: true } | { ok: false; message: string }
> {
    const generation = getVaultSessionGeneration();
    try {
        if (!isSameActiveVaultSession(generation))
            throw new Error("Vault session expired.");
        const customerPortalURL = await trpc.v1.payment.customerPortal.query({
            returnTarget: checkoutReturnTarget(),
        });

        if (!customerPortalURL) {
            return {
                ok: false,
                message: "Billing portal is not available yet.",
            };
        }

        const portalURL = new URL(customerPortalURL);
        if (
            portalURL.protocol !== "https:" ||
            portalURL.hostname !== "billing.stripe.com" ||
            portalURL.username ||
            portalURL.password
        ) {
            throw new Error("Billing portal did not return a Stripe URL.");
        }

        const canOpen = await Linking.canOpenURL(customerPortalURL);
        if (!canOpen) {
            return {
                ok: false,
                message: "Cannot open billing portal URL on this device.",
            };
        }

        if (!isSameActiveVaultSession(generation))
            throw new Error("Vault session expired.");
        await Linking.openURL(customerPortalURL);
        return { ok: true };
    } catch {
        onlineServicesLog.error("Failed to open customer portal");
        return { ok: false, message: "Could not open billing portal." };
    }
}

export function checkoutReturnTarget(): "mobile-production" | "mobile-preprod" {
    const scheme = Constants.expoConfig?.scheme;
    if (scheme === "cryptex") return "mobile-production";
    if (scheme === "cryptex-preprod") return "mobile-preprod";
    throw new Error("This app's checkout return scheme is not configured.");
}

/** Create an authenticated hosted checkout, then give only its URL to the browser. */
export async function openCheckoutExternal(
    tier: CheckoutTier = "premiumMonthly",
): Promise<{ ok: true } | { ok: false; message: string }> {
    const generation = getVaultSessionGeneration();
    try {
        if (!isSameActiveVaultSession(generation))
            throw new Error("Vault session expired.");
        const url = await trpc.v1.payment.checkoutSession.query({
            tier,
            uiMode: "hosted",
            returnTarget: checkoutReturnTarget(),
        });
        const checkoutURL = new URL(url);
        if (
            checkoutURL.protocol !== "https:" ||
            checkoutURL.hostname !== "checkout.stripe.com" ||
            checkoutURL.username ||
            checkoutURL.password
        ) {
            throw new Error("Checkout did not return a Stripe URL.");
        }
        if (!(await Linking.canOpenURL(url))) {
            return {
                ok: false,
                message: "Cannot open Stripe Checkout on this device.",
            };
        }
        if (!isSameActiveVaultSession(generation)) {
            return {
                ok: false,
                message: "Unlock your vault again before opening checkout.",
            };
        }
        await Linking.openURL(url);
        return { ok: true };
    } catch {
        onlineServicesLog.error("Failed to open Stripe Checkout");
        return {
            ok: false,
            message: "Could not open Stripe Checkout. Please try again.",
        };
    }
}

/** The return link requests a refresh. Only the authenticated API proves membership. */
export async function refreshSubscriptionAfterExternalBilling(
    outcome: "success" | "cancel" | "resume",
    signal: AbortSignal,
    confirmation: BillingConfirmation = {
        generation: getVaultSessionGeneration(),
        deadline: Date.now() + 60000,
        nextPollAt: 0,
        attempts: 0,
        subscription: null,
    },
) {
    const generation = getVaultSessionGeneration();
    const isCurrent = () =>
        !signal.aborted &&
        confirmation.generation === generation &&
        isSameActiveVaultSession(generation);
    // The subscription endpoint allows ten requests per minute. Reserve room
    // for the account screen's normal query and final cache refresh.
    const attempts = 7;
    while (
        confirmation.attempts < attempts &&
        (!confirmation.subscription ||
            (outcome === "success" && !confirmation.subscription.nonFree))
    ) {
        if (!isCurrent()) return null;
        if (Date.now() > confirmation.deadline) break;
        if (confirmation.nextPollAt > Date.now()) {
            await new Promise<void>((resolve) => {
                const done = () => {
                    clearTimeout(timer);
                    signal.removeEventListener("abort", done);
                    resolve();
                };
                const timer = setTimeout(
                    done,
                    Math.min(
                        confirmation.nextPollAt - Date.now(),
                        Math.max(0, confirmation.deadline - Date.now()),
                    ),
                );
                signal.addEventListener("abort", done, { once: true });
            });
            if (!isCurrent()) return null;
            if (Date.now() > confirmation.deadline) break;
        }
        confirmation.attempts++;
        confirmation.nextPollAt = Date.now() + 10000;
        try {
            const subscription = await trpc.v1.payment.subscription.query(
                undefined,
                { signal },
            );
            if (!isCurrent()) return null;
            confirmation.subscription = subscription;
        } catch (error) {
            if (!isCurrent()) return null;
            if (
                !(
                    outcome === "success" &&
                    error instanceof TRPCClientError &&
                    error.data?.code === "TOO_MANY_REQUESTS"
                )
            )
                throw error;
            if (
                confirmation.attempts === attempts &&
                !confirmation.subscription
            )
                throw error;
        }
        if (!isCurrent()) return null;
        if (outcome !== "success" || confirmation.subscription?.nonFree) break;
    }
    if (!isCurrent()) return null;
    await syncOnlineServicesRemoteConfiguration();
    return isCurrent() ? confirmation.subscription : null;
}
