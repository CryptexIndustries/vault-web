import { TRPCClientError } from "@trpc/client";
import { trpc } from "@/utils/trpc";
import { syncOnlineServicesRemoteConfiguration } from "@/app_lib/auth-session";
import {
    getVaultSessionGeneration,
    isSameActiveVaultSession,
} from "@/utils/vault-session";

/**
 * Seconds from the start at which each check runs. Stores sync RevenueCat
 * (5 a minute) before each read; Stripe only reads, keeping 3 of the 10
 * subscription reads a minute free for the Account screen.
 */
export const confirmationSchedules = {
    store: [0, 5, 20, 35, 50, 65, 80],
    stripe: [0, 3, 8, 15, 25, 35, 50, 65, 80],
    /** Back from Stripe Checkout without a return link. */
    returned: [0, 5, 15],
    once: [0],
} as const;

/** Progress is kept here so a loop paused in the background resumes on schedule. */
export type ConfirmationRun = {
    schedule: readonly number[];
    /** afterFirst: the purchase just synced, so the first check only reads. */
    sync: "always" | "afterFirst" | "never";
    startedAt: number;
    next: number;
    delay: number;
};

export function startConfirmation(
    schedule: readonly number[],
    sync: ConfirmationRun["sync"],
): ConfirmationRun {
    return { schedule, sync, startedAt: Date.now(), next: 0, delay: 0 };
}

let lastCheckAt = -Infinity;
/** Recent RevenueCat syncs, from purchases, restores and checks alike. */
const syncTimes: number[] = [];

function wait(ms: number, signal?: AbortSignal) {
    if (ms <= 0) return Promise.resolve();
    return new Promise<void>((resolve) => {
        const done = () => {
            clearTimeout(timer);
            signal?.removeEventListener("abort", done);
            resolve();
        };
        const timer = setTimeout(done, ms);
        signal?.addEventListener("abort", done, { once: true });
    });
}

/** Waits for a free slot so syncs stay within 5 per rolling minute. */
export async function syncRevenueCat(signal?: AbortSignal) {
    for (;;) {
        while (syncTimes.length && syncTimes[0] <= Date.now() - 60000)
            syncTimes.shift();
        if (syncTimes.length < 5) break;
        await wait(syncTimes[0] + 60000 - Date.now(), signal);
        if (signal?.aborted) return;
    }
    syncTimes.push(Date.now());
    await trpc.v1.payment.syncRevenueCat.mutate();
}

/**
 * Runs the remaining checks until membership is active. Returns null when
 * aborted or the vault session changed. Otherwise returns the paid
 * subscription, or no subscription and whether the last check was offline.
 */
export async function confirmMembership(
    run: ConfirmationRun,
    signal: AbortSignal,
) {
    const generation = getVaultSessionGeneration();
    const current = () =>
        !signal.aborted && isSameActiveVaultSession(generation);
    let offline = false;
    while (run.next < run.schedule.length) {
        const due = run.startedAt + run.schedule[run.next] * 1000 + run.delay;
        // A manual check waits for a free slot instead of hitting the limits.
        await wait(
            (run.schedule === confirmationSchedules.once
                ? Math.max(due, lastCheckAt + 15000)
                : due) - Date.now(),
            signal,
        );
        if (!current()) return null;
        const sync =
            run.sync === "always" ||
            (run.sync === "afterFirst" && run.next > 0);
        // Checks missed while paused collapse into this one.
        let next = run.next;
        while (
            next < run.schedule.length &&
            run.startedAt + run.schedule[next] * 1000 + run.delay <= Date.now()
        )
            next++;
        lastCheckAt = Date.now();
        let failure: unknown;
        let subscription;
        if (sync)
            await syncRevenueCat(signal).catch((error) => {
                failure = error;
            });
        try {
            subscription = await trpc.v1.payment.subscription.query(undefined, {
                signal,
            });
        } catch (error) {
            failure = error;
        }
        // An interrupted check runs again on resume.
        if (!current()) return null;
        run.next = next;
        if (subscription?.nonFree) {
            await syncOnlineServicesRemoteConfiguration().catch(
                () => undefined,
            );
            // Confirming stays on screen long enough to read.
            await wait(run.startedAt + 800 - Date.now(), signal);
            return current() ? { subscription, offline: false } : null;
        }
        offline =
            failure !== undefined &&
            !(failure instanceof TRPCClientError && failure.data);
        if (
            failure instanceof TRPCClientError &&
            failure.data?.code === "TOO_MANY_REQUESTS"
        )
            run.delay += 15000;
    }
    return { subscription: null, offline };
}
