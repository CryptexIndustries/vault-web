import { trpc } from "@/utils/trpc";
import type {
    PurchasesStoreProduct,
    SubscriptionOption,
} from "react-native-purchases";
import {
    getUnlockedVault,
    onlineServicesDataAtom,
    onlineServicesStore,
    vaultStore,
    unlockedVaultMetadataAtom,
} from "@/utils/atoms";
import {
    getVaultSessionGeneration,
    isSameActiveVaultSession,
} from "@/utils/vault-session";
import {
    isGooglePlayBuild,
    type BillingResult,
    type CheckoutTier,
    type PlanTerms,
    type StorePlan,
} from "./online-services-billing";
import { refreshSubscriptionAfterExternalBilling } from "./billing-confirmation";

class BillingError extends Error {}

let sdk: typeof import("react-native-purchases").default | undefined;
let queue: Promise<unknown> = Promise.resolve();
let authEpoch = 0;
onlineServicesStore.sub(onlineServicesDataAtom, () => {
    if (!onlineServicesStore.get(onlineServicesDataAtom)?.sessionToken) {
        authEpoch++;
        clearGooglePlayBillingIdentity();
    }
});

vaultStore.sub(unlockedVaultMetadataAtom, () => {
    if (!vaultStore.get(unlockedVaultMetadataAtom))
        clearGooglePlayBillingIdentity();
});

function serialized<T>(operation: () => Promise<T>): Promise<T> {
    const result = queue.then(operation);
    queue = result.catch(() => undefined);
    return result;
}
function configuration() {
    const apiKey = process.env.EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY ?? "";
    const plans: Record<CheckoutTier, [string, string]> = {
        premiumMonthly: [
            process.env.EXPO_PUBLIC_GOOGLE_PLAY_MONTHLY_PRODUCT_ID ?? "",
            process.env.EXPO_PUBLIC_GOOGLE_PLAY_MONTHLY_BASE_PLAN_ID ?? "",
        ],
        premiumYearly: [
            process.env.EXPO_PUBLIC_GOOGLE_PLAY_YEARLY_PRODUCT_ID ?? "",
            process.env.EXPO_PUBLIC_GOOGLE_PLAY_YEARLY_BASE_PLAN_ID ?? "",
        ],
    };
    if (
        !isGooglePlayBuild() ||
        !apiKey.startsWith("goog_") ||
        !Object.values(plans).flat().every(Boolean) ||
        plans.premiumMonthly.join(":") === plans.premiumYearly.join(":")
    ) {
        throw new BillingError(
            "Google Play billing is not configured. Please update the app.",
        );
    }
    return { apiKey, plans };
}
function captureSession() {
    const generation = getVaultSessionGeneration();
    const vault = getUnlockedVault();
    const session = onlineServicesStore.get(onlineServicesDataAtom);
    const userId = vault.OnlineServices?.UserID;
    if (
        !isSameActiveVaultSession(generation) ||
        !userId ||
        !session?.sessionToken ||
        session.deviceId !== vault.OnlineServices?.DeviceId ||
        (session.sessionExpiresAt ?? 0) <= Date.now()
    ) {
        throw new BillingError(
            "Connect your account and unlock your vault before using Google Play billing.",
        );
    }
    return { generation, userId, deviceId: session.deviceId, authEpoch };
}
function assertSession(session: ReturnType<typeof captureSession>) {
    const current = captureSession();
    if (
        current.generation !== session.generation ||
        current.userId !== session.userId ||
        current.deviceId !== session.deviceId ||
        current.authEpoch !== session.authEpoch
    ) {
        throw new BillingError(
            "Your account changed. Reopen Membership before using Google Play billing.",
        );
    }
}
async function prepare(
    session: ReturnType<typeof captureSession>,
    apiKey: string,
    purchasing = false,
) {
    const customer = await trpc.v1.payment.revenueCatCustomer.query();
    assertSession(session);
    if (!customer.enabled || !customer.appUserId.trim()) {
        throw new BillingError(
            "Google Play billing is unavailable for this account.",
        );
    }
    if (purchasing && !customer.canPurchase) {
        throw new BillingError(
            "This account cannot purchase a Google Play subscription. Restore purchases or refresh Membership.",
        );
    }
    sdk ??= (await import("react-native-purchases")).default;
    if (!(await sdk.isConfigured())) {
        assertSession(session);
        sdk.configure({ apiKey, appUserID: customer.appUserId });
    } else if ((await sdk.getAppUserID()) !== customer.appUserId) {
        assertSession(session);
        await sdk.logIn(customer.appUserId);
    }
    assertSession(session);
    return sdk;
}
// Play returns these new-customer offers only to eligible Google accounts.
const trialOffers: Record<CheckoutTier, string> = {
    premiumMonthly: "trial-14d-monthly",
    premiumYearly: "trial-14d-yearly",
};
function isExpectedOption(
    option: SubscriptionOption | undefined,
    tier: CheckoutTier,
    trial: boolean,
): option is SubscriptionOption {
    // billingPeriod and fullPricePhase describe the last pricing phase.
    const free = option?.pricingPhases[0];
    return (
        !!option &&
        option.billingPeriod?.iso8601 ===
            (tier === "premiumMonthly" ? "P1M" : "P1Y") &&
        option.fullPricePhase?.recurrenceMode === 1 &&
        !option.isPrepaid &&
        option.installmentsInfo == null &&
        option.pricingPhases.length === (trial ? 2 : 1) &&
        (!trial ||
            (free?.price.amountMicros === 0 &&
                free.offerPaymentMode === "FREE_TRIAL" &&
                free.billingCycleCount === 1 &&
                ["P2W", "P14D"].includes(free.billingPeriod.iso8601)))
    );
}
function selectOption(
    products: PurchasesStoreProduct[],
    tier: CheckoutTier,
    [productId, basePlanId]: [string, string],
    trialEligible: boolean,
) {
    const options = products
        .flatMap((product) => product.subscriptionOptions ?? [])
        .filter((option) => option.productId === productId);
    const offer = options.find(
        (option) => option.id === `${basePlanId}:${trialOffers[tier]}`,
    );
    // A missing or unexpected offer falls back to the base plan.
    if (trialEligible && isExpectedOption(offer, tier, true)) {
        return { option: offer, trial: true };
    }
    const option = options.find(
        (option) => option.id === basePlanId && option.isBasePlan,
    );
    if (!isExpectedOption(option, tier, false)) {
        throw new BillingError(
            "The selected Google Play subscription is unavailable. Please try again later.",
        );
    }
    return { option, trial: false };
}
function hasSubscription(
    active: string[],
    config: ReturnType<typeof configuration>,
) {
    return active.some((id) =>
        Object.values(config.plans).some(
            ([product]) => id === product || id.startsWith(`${product}:`),
        ),
    );
}
function failure(error: unknown): BillingResult {
    const code =
        typeof error === "object" && error && "code" in error
            ? String(error.code)
            : "";
    if (
        code === "1" ||
        (typeof error === "object" &&
            error &&
            "userCancelled" in error &&
            error.userCancelled === true)
    )
        return {
            ok: false,
            canceled: true,
            message: "Purchase canceled. Your membership has not changed.",
        };
    if (code === "20")
        return {
            ok: false,
            pending: true,
            message:
                "Payment is pending in Google Play. Membership will update after payment is approved.",
        };
    // Purchases stay with the account that bought them; RevenueCat refuses transfers.
    if (["6", "7", "13"].includes(code))
        return {
            ok: false,
            retryable: false,
            message:
                "This Google Play subscription belongs to another Cryptex Vault account. Use the vault that bought it, or cancel the subscription in Google Play before buying again.",
        };
    return {
        ok: false,
        message:
            error instanceof BillingError
                ? error.message
                : code === "10"
                  ? "Could not connect to Google Play. Check your connection and try again."
                  : code === "3"
                    ? "Google Play couldn't complete the purchase. Check your payment method in Google Play."
                    : "Google Play billing could not complete. Please try again.",
    };
}
async function syncMembership(
    session: ReturnType<typeof captureSession>,
    pendingMessage: string,
): Promise<BillingResult> {
    assertSession(session);
    try {
        await trpc.v1.payment.syncRevenueCat.mutate();
    } catch {
        assertSession(session);
        return { ok: false, pending: true, message: pendingMessage };
    }
    assertSession(session);
    // Only the backend subscription endpoint grants membership.
    return { ok: true };
}
export async function loadGooglePlayPlans(
    trialEligible = false,
): Promise<StorePlan[]> {
    const config = configuration();
    return serialized(async () => {
        // Store prices are public; only payment operations identify an account.
        sdk ??= (await import("react-native-purchases")).default;
        if (!(await sdk.isConfigured()))
            sdk.configure({ apiKey: config.apiKey });
        const productIds = Object.values(config.plans).map(
            ([product]) => product,
        );
        const products = await sdk.getProducts([...new Set(productIds)]);
        return (Object.keys(config.plans) as CheckoutTier[]).map((tier) => {
            const { option, trial } = selectOption(
                products,
                tier,
                config.plans[tier],
                trialEligible,
            );
            return {
                tier,
                price: option.fullPricePhase!.price.formatted,
                trial,
            };
        });
    });
}
export async function purchaseGooglePlayPlan(
    tier: CheckoutTier,
    terms: PlanTerms = { trialEligible: false, trial: false },
): Promise<BillingResult> {
    try {
        const session = captureSession();
        const config = configuration();
        return await serialized(async () => {
            const purchases = await prepare(session, config.apiKey, true);
            const customer = await purchases.getCustomerInfo();
            if (hasSubscription(customer.activeSubscriptions, config)) {
                return {
                    ok: false,
                    pending: true,
                    message:
                        "Google Play already has an active subscription. Membership confirmation is pending.",
                };
            }
            const products = await purchases.getProducts([
                config.plans[tier][0],
            ]);
            assertSession(session);
            const { option, trial } = selectOption(
                products,
                tier,
                config.plans[tier],
                terms.trialEligible,
            );
            // Never buy different terms than the ones the user saw.
            if (trial !== terms.trial) {
                return {
                    ok: false,
                    offerChanged: { trial },
                    message: trial
                        ? "This plan now starts with a 14-day free trial. Check the plan and try again."
                        : "The free trial is no longer available for this plan. Check the plan and try again.",
                };
            }
            await purchases.purchaseSubscriptionOption(option);
            return syncMembership(
                session,
                "Payment completed. Membership confirmation is pending. Restore purchases or refresh Membership shortly.",
            );
        });
    } catch (error) {
        return failure(error);
    }
}
export async function restoreGooglePlayPurchases(): Promise<BillingResult> {
    try {
        const session = captureSession();
        const config = configuration();
        return await serialized(async () => {
            const purchases = await prepare(session, config.apiKey);
            await purchases.restorePurchases();
            return syncMembership(
                session,
                "Purchases restored. Membership confirmation is pending. Refresh Membership shortly.",
            );
        });
    } catch (error) {
        return failure(error);
    }
}
/** Checking confirmation never starts a purchase or restores store ownership. */
export async function checkGooglePlayPurchaseStatus(): Promise<BillingResult> {
    try {
        const session = captureSession();
        return await serialized(async () => {
            assertSession(session);
            await trpc.v1.payment.syncRevenueCat.mutate();
            assertSession(session);
            const subscription = await refreshSubscriptionAfterExternalBilling(
                "resume",
                new AbortController().signal,
            );
            assertSession(session);
            return subscription?.nonFree
                ? { ok: true }
                : {
                      ok: false,
                      pending: true,
                      message:
                          "Membership confirmation is pending. Check status again shortly.",
                  };
        });
    } catch (error) {
        return failure(error);
    }
}
/** Logout waits for native operations and skips a superseded lock or sign-out. */
export function clearGooglePlayBillingIdentity(): void {
    if (!sdk) return;
    void serialized(async () => {
        try {
            captureSession();
            return;
        } catch {
            /* Still locked or signed out. */
        }
        if (sdk && (await sdk.isConfigured()) && !(await sdk.isAnonymous()))
            await sdk.logOut();
    }).catch(() => undefined);
}
