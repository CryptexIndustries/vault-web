import { TRPCClientError } from "@trpc/client";
import { trpc } from "@/utils/trpc";
import { syncOnlineServicesRemoteConfiguration } from "@/app_lib/auth-session";
import {
    getVaultSessionGeneration,
    isSameActiveVaultSession,
} from "@/utils/vault-session";
import type { BillingConfirmation } from "./online-services-billing";

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
