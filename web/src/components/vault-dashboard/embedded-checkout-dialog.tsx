"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
    EmbeddedCheckout,
    EmbeddedCheckoutProvider,
} from "@stripe/react-stripe-js";
import { TRPCClientError } from "@trpc/client";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { toast } from "sonner";

import {
    fetchCheckoutClientSecret,
    type CheckoutTier,
} from "@/app_lib/online-services";
import { env } from "@/env/public";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { SubscriptionLegalNotice } from "@/components/vault-dashboard/subscription-legal-notice";

type EmbeddedCheckoutDialogProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onComplete?: () => void | Promise<void>;
    tier?: CheckoutTier;
};

export function EmbeddedCheckoutDialog({
    open,
    onOpenChange,
    onComplete,
    tier = "premiumMonthly",
}: EmbeddedCheckoutDialogProps) {
    const [checkoutKey, setCheckoutKey] = useState(0);
    const [clientSecret, setClientSecret] = useState<string | null>(null);
    const [stripePromise, setStripePromise] =
        useState<Promise<Stripe | null> | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [loadingSession, setLoadingSession] = useState(false);

    const handleOpenChange = useCallback(
        (nextOpen: boolean) => {
            if (!nextOpen) {
                setCheckoutKey((current) => current + 1);
                setClientSecret(null);
                setStripePromise(null);
                setLoadError(null);
                setLoadingSession(false);
            }
            onOpenChange(nextOpen);
        },
        [onOpenChange],
    );

    useEffect(() => {
        if (!open) {
            return;
        }

        let cancelled = false;
        setLoadingSession(true);
        setLoadError(null);
        setClientSecret(null);
        setStripePromise(null);

        void (async () => {
            try {
                const secret = await fetchCheckoutClientSecret(tier);

                if (cancelled) {
                    return;
                }

                setClientSecret(secret);
                setStripePromise(
                    loadStripe(env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY),
                );
            } catch (error) {
                if (cancelled) {
                    return;
                }

                if (error instanceof TRPCClientError) {
                    toast.error(error.message);
                    handleOpenChange(false);
                    return;
                }

                setLoadError("Could not start checkout.");
            } finally {
                if (!cancelled) {
                    setLoadingSession(false);
                }
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [open, tier, checkoutKey, handleOpenChange]);

    const options = useMemo(
        () => ({
            clientSecret: clientSecret ?? "",
            onComplete: () => {
                handleOpenChange(false);
                void onComplete?.();
            },
        }),
        [clientSecret, handleOpenChange, onComplete],
    );

    const checkoutReady = open && !!clientSecret && !!stripePromise;

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="top-[4vh] grid max-h-[min(92vh,100dvh)] max-w-2xl translate-x-[-50%] translate-y-0 grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0">
                <DialogHeader className="shrink-0 border-b px-6 py-4">
                    <DialogTitle>Upgrade subscription</DialogTitle>
                    <DialogDescription>
                        Complete checkout without leaving Cryptex Vault.
                    </DialogDescription>
                </DialogHeader>
                <div className="min-h-0 overflow-y-auto overscroll-contain px-6 py-4">
                    {checkoutReady ? (
                        <div className="min-h-[420px]" key={checkoutKey}>
                            <EmbeddedCheckoutProvider
                                stripe={stripePromise}
                                options={options}
                            >
                                <EmbeddedCheckout />
                            </EmbeddedCheckoutProvider>
                        </div>
                    ) : open ? (
                        <p className="text-sm text-muted-foreground">
                            {loadError ??
                                (loadingSession
                                    ? "Preparing checkout..."
                                    : "Loading checkout...")}
                        </p>
                    ) : null}
                    {open ? (
                        <SubscriptionLegalNotice className="mt-4 border-t pt-4" />
                    ) : null}
                </div>
            </DialogContent>
        </Dialog>
    );
}
