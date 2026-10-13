import Constants from "expo-constants";
import { Linking, Platform } from "react-native";
import type { trpc } from "@/utils/trpc";
import * as stripe from "./stripe-billing";

export { checkoutReturnTarget } from "./stripe-billing";
export { refreshSubscriptionAfterExternalBilling } from "./billing-confirmation";

export type CheckoutTier = "premiumMonthly" | "premiumYearly";
export type StorePlan = { tier: CheckoutTier; price: string };
export type BillingResult =
    | { ok: true }
    | {
          ok: false;
          message: string;
          canceled?: boolean;
          pending?: boolean;
          /** False when trying again cannot change the outcome. */
          retryable?: false;
      };
export type BillingConfirmation = {
    generation: number;
    deadline: number;
    nextPollAt: number;
    attempts: number;
    subscription: Awaited<
        ReturnType<typeof trpc.v1.payment.subscription.query>
    > | null;
};
export function isGooglePlayBuild(): boolean {
    return (
        Platform?.OS === "android" &&
        Constants.expoConfig?.extra?.buildDetails?.distribution === "play"
    );
}

export async function purchaseMembership(
    tier: CheckoutTier = "premiumMonthly",
): Promise<BillingResult> {
    if (isGooglePlayBuild()) {
        return (await import("./google-play-billing")).purchaseGooglePlayPlan(
            tier,
        );
    }
    return stripe.openCheckoutExternal(tier);
}
type BillingProvider = NonNullable<
    BillingConfirmation["subscription"]
>["provider"];
export type BillingManagement = "google_play" | "stripe" | null;

/** Where the current subscription is managed, or null when this build cannot link to it. */
export function billingManagement(
    provider: BillingProvider | undefined,
): BillingManagement {
    if (provider === "google_play") return "google_play";
    if (provider === "app_store") return null;
    // Google Play builds must not link to another payment method.
    if (provider === "stripe") return isGooglePlayBuild() ? null : "stripe";
    return isGooglePlayBuild() ? "google_play" : "stripe";
}

/** Play builds open their own subscription; other builds cannot know which app bought it. */
function googlePlaySubscriptionsUrl() {
    const url = "https://play.google.com/store/account/subscriptions";
    const sku = process.env.EXPO_PUBLIC_GOOGLE_PLAY_MONTHLY_PRODUCT_ID;
    const appPackage = Constants.expoConfig?.android?.package;
    if (!isGooglePlayBuild() || !sku || !appPackage) return url;
    return `${url}?sku=${encodeURIComponent(sku)}&package=${encodeURIComponent(appPackage)}`;
}

export async function openBillingManagement(
    management: BillingManagement = billingManagement(undefined),
) {
    if (management === "google_play") {
        try {
            await Linking.openURL(googlePlaySubscriptionsUrl());
            return { ok: true } as const;
        } catch {
            return {
                ok: false,
                message: "Could not open Google Play subscriptions.",
            } as const;
        }
    }
    if (management === "stripe") return stripe.openCustomerPortalExternal();
    return {
        ok: false,
        message: "This subscription cannot be managed from this app.",
    } as const;
}
export async function loadStorePlans() {
    return (await import("./google-play-billing")).loadGooglePlayPlans();
}
export async function restoreStorePurchases() {
    return (await import("./google-play-billing")).restoreGooglePlayPurchases();
}
export async function checkStorePurchaseStatus() {
    return (
        await import("./google-play-billing")
    ).checkGooglePlayPurchaseStatus();
}
