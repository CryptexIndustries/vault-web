import { z } from "zod";
import { toast } from "sonner";
import { trpc } from "../utils/trpc";
import { onlineServicesLog } from "../utils/logging";

//#region Sign up
export const signUpFormSchema = z.object({
    captchaToken: z.string().min(1, "Captcha is required."),
});
export type SignUpFormSchemaType = z.infer<typeof signUpFormSchema>;
//#endregion Sign up

//#region Subscription
export type CheckoutTier = "premiumMonthly" | "premiumYearly";

export async function fetchCheckoutClientSecret(
    tier: CheckoutTier = "premiumMonthly",
): Promise<string> {
    const clientSecret = await trpc.v1.payment.checkoutSession.query({ tier });

    if (!clientSecret?.length) {
        throw new Error("Failed to start checkout.");
    }

    return clientSecret;
}

export const openCustomerPortal = async () => {
    try {
        const customerPortalURL =
            await trpc.v1.payment.customerPortal.query(undefined);

        if (customerPortalURL) {
            window.open(customerPortalURL, "_blank", "noopener,noreferrer");
            return;
        }

        toast.error("Billing portal is not available yet.");
    } catch {
        toast.error("Could not open billing portal.");
    }
};

const SUBSCRIPTION_ACTIVATION_POLL_MS = 500;
const SUBSCRIPTION_ACTIVATION_MAX_ATTEMPTS = 120;

function throwIfCheckoutFinalizationAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
        throw new DOMException("Checkout finalization aborted", "AbortError");
    }
}

async function delayForSubscriptionPoll(
    ms: number,
    signal?: AbortSignal,
): Promise<void> {
    throwIfCheckoutFinalizationAborted(signal);

    await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
        }, ms);

        const onAbort = () => {
            clearTimeout(timer);
            signal?.removeEventListener("abort", onAbort);
            reject(
                new DOMException("Checkout finalization aborted", "AbortError"),
            );
        };

        signal?.addEventListener("abort", onAbort);
    });

    throwIfCheckoutFinalizationAborted(signal);
}

async function waitForPaidSubscription(signal?: AbortSignal): Promise<boolean> {
    for (
        let attempt = 0;
        attempt < SUBSCRIPTION_ACTIVATION_MAX_ATTEMPTS;
        attempt++
    ) {
        throwIfCheckoutFinalizationAborted(signal);

        const subscription = await trpc.v1.payment.subscription.query();
        if (subscription.nonFree) {
            return true;
        }

        if (attempt + 1 >= SUBSCRIPTION_ACTIVATION_MAX_ATTEMPTS) {
            break;
        }

        await delayForSubscriptionPoll(SUBSCRIPTION_ACTIVATION_POLL_MS, signal);
    }

    return false;
}

async function refreshCheckoutClientState(
    options?: FinalizeCheckoutCompletionOptions,
): Promise<void> {
    const { syncOnlineServicesRemoteConfiguration } =
        await import("./auth-session");
    await syncOnlineServicesRemoteConfiguration();
    await options?.onSynced?.();
}

export type FinalizeCheckoutCompletionOptions = {
    onSynced?: () => void | Promise<void>;
    /** When aborted (e.g. account dialog closed), polling stops silently. */
    signal?: AbortSignal;
};

export type CheckoutTrpcUtils = {
    v1: {
        payment: {
            subscription: {
                invalidate: () => Promise<void>;
                refetch: () => Promise<unknown>;
            };
            customerPortal: {
                invalidate: () => Promise<void>;
            };
        };
        user: {
            configuration: {
                invalidate: () => Promise<void>;
                refetch: () => Promise<unknown>;
            };
        };
    };
};

/** Invalidate and refetch subscription + configuration after checkout. */
export async function refreshCheckoutTrpcCaches(
    utils: CheckoutTrpcUtils,
): Promise<void> {
    await utils.v1.payment.subscription.invalidate();
    await utils.v1.user.configuration.invalidate();
    await utils.v1.payment.customerPortal.invalidate();
    await Promise.all([
        utils.v1.payment.subscription.refetch(),
        utils.v1.user.configuration.refetch(),
    ]);
}

/** Poll until webhook tier is visible, refresh client caches, then toast. */
export async function finalizeCheckoutCompletion(
    options?: FinalizeCheckoutCompletionOptions,
): Promise<void> {
    const toastId = toast.loading("Activating subscription...");

    try {
        throwIfCheckoutFinalizationAborted(options?.signal);

        const activated = await waitForPaidSubscription(options?.signal);
        await refreshCheckoutClientState(options);

        if (activated) {
            toast.success("Subscription upgraded.", { id: toastId });
            return;
        }

        toast.message(
            "Payment received. Your plan may take a moment to update.",
            {
                id: toastId,
            },
        );
    } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
            toast.dismiss(toastId);
            return;
        }

        toast.error("Could not confirm subscription update.", { id: toastId });
        onlineServicesLog.error("Checkout finalization failed", { error });
    }
}
//#endregion Subscription

//#region Online Services - Synchronization
export const constructLinkPresenceChannelName = (id: string) => {
    return `presence-link-${id}`;
};
//#endregion Online Services
