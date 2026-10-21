"use client";

import { useEffect, useRef, useState } from "react";
import { Copy } from "lucide-react";

import { openCustomerPortal } from "@/app_lib/online-services";
import type { CheckoutTier } from "@/app_lib/online-services";
import type { GetSubscriptionOutputSchemaType } from "@cryptex-industries/api-contract";
import dynamic from "next/dynamic";
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardFooter,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

import { copyToClipboard, formatAccountDate } from "./utils";
import type { PurchasePlan } from "@/utils/purchase-onboarding";

import { PlanBenefits } from "./plan-benefits";

const EmbeddedCheckoutDialog = dynamic(
    () =>
        import("@/components/vault-dashboard/embedded-checkout-dialog").then(
            (mod) => mod.EmbeddedCheckoutDialog,
        ),
    { ssr: false },
);

const GOOGLE_PLAY_SUBSCRIPTIONS_URL =
    "https://play.google.com/store/account/subscriptions";

type RemoteConfig = {
    root?: boolean;
    canLink?: boolean;
    canPromoteDevices?: boolean;
    maxLinks?: number;
    managedEncryptedBackups?: boolean;
    passwordSharing?: boolean;
    sshAgentRelay?: boolean;
    maxSshAgents?: number;
    recoveryTokenCreatedAt?: Date | string | null;
};

type Subscription = {
    provider?: GetSubscriptionOutputSchemaType["provider"];
    productName?: string | null;
    status?: string | null;
    cancelAtPeriodEnd?: boolean | null;
    expiresAt?: Date | string | null;
    nonFree?: boolean;
    resourceStatus?: { linkedDevices?: number };
};

type AccountSummaryProps = {
    tierName: string;
    subscriptionStatus: string;
    subscription: Subscription | null | undefined;
    subscriptionReady?: boolean;
    remoteConfig: RemoteConfig | null | undefined;
    hasSession: boolean;
    deviceId: string | null | undefined;
    userId: string | null | undefined;
    onlineServicesBound: boolean;
    isConnected: boolean;
    onCheckoutComplete?: () => void | Promise<void>;
    checkoutPlan?: PurchasePlan | null;
    checkoutBlocked?: boolean;
    onPurchaseHandled?: () => void;
};

function StatusBadge({
    active,
    activeLabel,
    inactiveLabel,
}: {
    active: boolean;
    activeLabel: string;
    inactiveLabel: string;
}) {
    return (
        <Badge
            variant={active ? "default" : "secondary"}
            className={cn(
                "gap-1.5 font-normal",
                active && "bg-emerald-600/90 hover:bg-emerald-600/90",
            )}
        >
            <span
                className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    active ? "bg-emerald-100" : "bg-muted-foreground/50",
                )}
            />
            {active ? activeLabel : inactiveLabel}
        </Badge>
    );
}

export function AccountSummary({
    tierName,
    subscriptionStatus,
    subscription,
    subscriptionReady = true,
    remoteConfig,
    hasSession,
    deviceId,
    userId,
    onlineServicesBound,
    isConnected,
    onCheckoutComplete,
    checkoutPlan,
    checkoutBlocked = false,
    onPurchaseHandled,
}: AccountSummaryProps) {
    const [checkoutOpen, setCheckoutOpen] = useState(false);
    const [checkoutTier, setCheckoutTier] =
        useState<CheckoutTier>("premiumMonthly");
    const canUpgrade =
        hasSession &&
        subscriptionReady &&
        !!subscription &&
        !subscription.nonFree &&
        !checkoutBlocked;
    const purchasePlanHandledRef = useRef(false);
    useEffect(() => {
        if (
            !checkoutPlan ||
            !hasSession ||
            !subscriptionReady ||
            !subscription ||
            purchasePlanHandledRef.current
        )
            return;
        purchasePlanHandledRef.current = true;
        if (!subscription.nonFree) {
            setCheckoutTier(
                checkoutPlan === "yearly" ? "premiumYearly" : "premiumMonthly",
            );
            setCheckoutOpen(true);
        }
        onPurchaseHandled?.();
    }, [
        checkoutPlan,
        hasSession,
        subscriptionReady,
        subscription,
        onPurchaseHandled,
    ]);
    const linkedDeviceCount = subscription?.resourceStatus?.linkedDevices ?? 0;
    const billingDateLabel = subscription?.cancelAtPeriodEnd
        ? "Expires"
        : "Renews";
    const billingDate = formatAccountDate(subscription?.expiresAt);
    const canManageBilling = hasSession && !!subscription?.nonFree;
    // Store subscriptions can only be changed in the store that bills them.
    const provider = canManageBilling ? subscription.provider : null;
    const billingNote =
        provider === "google_play"
            ? "Billed through Google Play. Manage or cancel it in Google Play subscriptions."
            : provider === "app_store"
              ? "Billed through the App Store. Manage or cancel it in your Apple account settings."
              : null;

    // The plan comparison below already names the free tier.
    const isFree = !!subscription && !subscription.nonFree;
    const statusBadges = (
        <div className="flex flex-wrap gap-2">
            <StatusBadge
                active={isConnected}
                activeLabel="Connected"
                inactiveLabel="Not connected"
            />
            <StatusBadge
                active={!!remoteConfig?.root}
                activeLabel="Root device"
                inactiveLabel="Not root"
            />
            <StatusBadge
                active={!!remoteConfig?.recoveryTokenCreatedAt}
                activeLabel="Recovery backed up"
                inactiveLabel="No recovery phrase"
            />
        </div>
    );

    return (
        <div className="space-y-4">
            {isFree ? (
                statusBadges
            ) : (
                <Card>
                    <CardHeader className="pb-3">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                            <CardTitle className="text-lg">
                                {tierName}
                            </CardTitle>
                            <Badge variant="outline">
                                {subscriptionStatus}
                            </Badge>
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-3 pb-3">
                        {subscription?.nonFree ? (
                            <p className="text-sm text-muted-foreground">
                                {billingDateLabel}{" "}
                                <span className="font-medium text-foreground">
                                    {billingDate}
                                </span>
                            </p>
                        ) : subscription ? null : (
                            <p className="text-sm text-muted-foreground">
                                Sign in to view billing details.
                            </p>
                        )}
                        {statusBadges}
                    </CardContent>
                    {canManageBilling ? (
                        <CardFooter className="flex flex-col items-stretch gap-3 border-t pt-4">
                            <div className="flex flex-wrap gap-2">
                                {provider === "google_play" ? (
                                    <Button asChild variant="outline" size="sm">
                                        <a
                                            href={GOOGLE_PLAY_SUBSCRIPTIONS_URL}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                        >
                                            Manage billing
                                        </a>
                                    </Button>
                                ) : provider === "app_store" ? null : (
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={() =>
                                            void openCustomerPortal()
                                        }
                                    >
                                        Manage billing
                                    </Button>
                                )}
                            </div>
                            {billingNote ? (
                                <p className="text-xs text-muted-foreground">
                                    {billingNote}
                                </p>
                            ) : null}
                        </CardFooter>
                    ) : null}
                </Card>
            )}

            <PlanBenefits
                access={remoteConfig}
                subscribed={!!subscription?.nonFree}
                linkedDevices={linkedDeviceCount}
                upgrade={{
                    tier: checkoutTier,
                    onTierChange: setCheckoutTier,
                    onUpgrade: () => setCheckoutOpen(true),
                    canUpgrade,
                    checkoutOpen,
                }}
            />

            <Accordion type="single" collapsible>
                <AccordionItem value="advanced" className="border-none">
                    <AccordionTrigger className="rounded-lg border px-4 py-3 hover:no-underline">
                        Advanced details
                    </AccordionTrigger>
                    <AccordionContent className="pt-3">
                        <div className="space-y-3 rounded-lg border p-4 text-sm">
                            {userId ? (
                                <div className="space-y-2">
                                    <Label className="text-xs text-muted-foreground">
                                        User ID
                                    </Label>
                                    <div className="flex flex-wrap items-center gap-2">
                                        <p className="min-w-0 flex-1 break-all font-mono text-xs">
                                            {userId}
                                        </p>
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            className="shrink-0 gap-2"
                                            onClick={() =>
                                                void copyToClipboard(
                                                    userId,
                                                    "User ID",
                                                )
                                            }
                                        >
                                            <Copy className="h-3.5 w-3.5" />
                                            Copy
                                        </Button>
                                    </div>
                                </div>
                            ) : null}
                            <div className="space-y-1">
                                <Label className="text-xs text-muted-foreground">
                                    Device ID
                                </Label>
                                <p className="break-all font-mono text-xs">
                                    {deviceId ?? "-"}
                                </p>
                            </div>
                            <div className="flex justify-between gap-3">
                                <span className="text-muted-foreground">
                                    Vault binding
                                </span>
                                <span className="font-medium">
                                    {onlineServicesBound
                                        ? "Registered"
                                        : "Not registered"}
                                </span>
                            </div>
                        </div>
                    </AccordionContent>
                </AccordionItem>
            </Accordion>

            <EmbeddedCheckoutDialog
                open={checkoutOpen}
                onOpenChange={setCheckoutOpen}
                tier={checkoutTier}
                onComplete={onCheckoutComplete}
            />
        </div>
    );
}
