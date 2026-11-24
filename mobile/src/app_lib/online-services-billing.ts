import Constants from "expo-constants";
import { Linking, Platform } from "react-native";
import { t } from "@lingui/core/macro";
import type { trpc } from "@/utils/trpc";
import * as stripe from "./stripe-billing";

export { checkoutReturnTarget } from "./stripe-billing";
export {
    confirmMembership,
    confirmationSchedules,
    startConfirmation,
    type ConfirmationRun,
} from "./billing-confirmation";

export type CheckoutTier = "premiumMonthly" | "premiumYearly";
export type StorePlan = { tier: CheckoutTier; price: string; trial: boolean };
/** Whether the account may get a trial, and whether the user was shown one. */
export type PlanTerms = { trialEligible: boolean; trial: boolean };
export type BillingResult =
    | { ok: true }
    /**
     * Membership is not confirmed yet: the sync after payment failed, the
     * store holds the payment, or the store account already subscribed.
     */
    | { ok: false; pending: "sync" | "store" | "owned" }
    /** The store offer differs from the one shown; nothing was bought. */
    | { ok: false; offerChanged: { trial: boolean } }
    | { ok: false; canceled: true }
    /** retryable is false when trying again cannot change the outcome. */
    | { ok: false; message: string; retryable?: false };
export function isGooglePlayBuild(): boolean {
    return (
        Platform?.OS === "android" &&
        Constants.expoConfig?.extra?.buildDetails?.distribution === "play"
    );
}

/** The app store that sells memberships in this build, if any. */
export function storeBilling(): "google_play" | "app_store" | null {
    if (Platform?.OS === "ios") return "app_store";
    return isGooglePlayBuild() ? "google_play" : null;
}

export async function purchaseMembership(
    tier: CheckoutTier = "premiumMonthly",
    terms: PlanTerms = { trialEligible: false, trial: false },
    onPaid?: () => void,
): Promise<BillingResult> {
    if (storeBilling()) {
        return (await import("./store-billing")).purchasePlan(
            tier,
            terms,
            onPaid,
        );
    }
    // Stripe checkout decides the trial on the server.
    return stripe.openCheckoutExternal(tier);
}
type BillingProvider = Awaited<
    ReturnType<typeof trpc.v1.payment.subscription.query>
>["provider"];
export type BillingManagement = "google_play" | "app_store" | "stripe" | null;

/** Where the current subscription is managed, or null when this build cannot link to it. */
export function billingManagement(
    provider: BillingProvider | undefined,
): BillingManagement {
    const store = storeBilling();
    // Store builds must not link to another payment method.
    if (provider === "google_play")
        return store === "app_store" ? null : "google_play";
    if (provider === "app_store")
        return store === "app_store" ? "app_store" : null;
    if (provider === "stripe") return store ? null : "stripe";
    return store ?? "stripe";
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
    if (management === "google_play" || management === "app_store") {
        const appStore = management === "app_store";
        try {
            await Linking.openURL(
                appStore
                    ? "https://apps.apple.com/account/subscriptions"
                    : googlePlaySubscriptionsUrl(),
            );
            return { ok: true } as const;
        } catch {
            return {
                ok: false,
                message: appStore
                    ? t`Could not open App Store subscriptions.`
                    : t`Could not open Google Play subscriptions.`,
            } as const;
        }
    }
    if (management === "stripe") return stripe.openCustomerPortalExternal();
    return {
        ok: false,
        message: t`This subscription cannot be managed from this app.`,
    } as const;
}
export async function loadStorePlans(trialEligible: boolean) {
    return (await import("./store-billing")).loadPlans(trialEligible);
}
export async function restoreStorePurchases() {
    return (await import("./store-billing")).restorePurchases();
}
