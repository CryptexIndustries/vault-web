"use client";

import { useState } from "react";
import { Copy, Lock } from "lucide-react";

import { openCustomerPortal } from "@/app_lib/online-services";
import type { CheckoutTier } from "@/app_lib/online-services";
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
import { SubscriptionLegalNotice } from "@/components/vault-dashboard/subscription-legal-notice";
import { CheckoutTierPicker } from "@/components/vault-dashboard/checkout-tier-picker";

const EmbeddedCheckoutDialog = dynamic(
    () =>
        import("@/components/vault-dashboard/embedded-checkout-dialog").then(
            (mod) => mod.EmbeddedCheckoutDialog,
        ),
    { ssr: false },
);

type RemoteConfig = {
    root?: boolean;
    canLink?: boolean;
    canPromoteDevices?: boolean;
    alwaysConnected?: boolean;
    canFeatureVote?: boolean;
    maxLinks?: number;
    recoveryTokenCreatedAt?: Date | string | null;
};

type Subscription = {
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
    remoteConfig: RemoteConfig | null | undefined;
    hasSession: boolean;
    deviceId: string | null | undefined;
    userId: string | null | undefined;
    passkeyBound: boolean;
    isConnected: boolean;
    onCheckoutComplete?: () => void | Promise<void>;
};

type LockedPerk = {
    label: string;
    detail: string;
};

function buildLockedPerks(
    remoteConfig: RemoteConfig | null | undefined,
    tierAccessLoaded: boolean,
): LockedPerk[] {
    if (!tierAccessLoaded) return [];

    const perks: LockedPerk[] = [];
    const linkedDeviceLimit = remoteConfig?.maxLinks ?? 0;
    const canLinkDevices = !!remoteConfig?.canLink && linkedDeviceLimit > 0;

    if (!remoteConfig?.canLink) {
        perks.push({
            label: "Online Services sync",
            detail: "Upgrade to unlock encrypted synchronization.",
        });
    }
    if (!canLinkDevices) {
        perks.push({
            label: "Linked devices",
            detail: "Upgrade to link more devices to your account.",
        });
    }
    if (!remoteConfig?.canPromoteDevices) {
        perks.push({
            label: "Root device promotion",
            detail: "Upgrade to promote trusted devices.",
        });
    }
    if (!remoteConfig?.alwaysConnected) {
        perks.push({
            label: "Always-connected access",
            detail: "Upgrade to keep Online Services always available.",
        });
    }
    if (!remoteConfig?.canFeatureVote) {
        perks.push({
            label: "Feature voting",
            detail: "Upgrade to vote on upcoming features.",
        });
    }

    return perks;
}

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
    remoteConfig,
    hasSession,
    deviceId,
    userId,
    passkeyBound,
    isConnected,
    onCheckoutComplete,
}: AccountSummaryProps) {
    const [checkoutOpen, setCheckoutOpen] = useState(false);
    const [checkoutTier, setCheckoutTier] =
        useState<CheckoutTier>("premiumMonthly");
    const canUpgrade = hasSession && !subscription?.nonFree;
    const tierAccessLoaded = !!remoteConfig;
    const linkedDeviceCount = subscription?.resourceStatus?.linkedDevices ?? 0;
    const linkedDeviceLimit = remoteConfig?.maxLinks ?? 0;
    const canLinkDevices = !!remoteConfig?.canLink && linkedDeviceLimit > 0;
    const billingDateLabel = subscription?.cancelAtPeriodEnd
        ? "Expires"
        : "Renews";
    const billingDate = formatAccountDate(subscription?.expiresAt);
    const lockedPerks = buildLockedPerks(remoteConfig, tierAccessLoaded);

    return (
        <div className="space-y-4">
            <Card>
                <CardHeader className="pb-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <CardTitle className="text-lg">{tierName}</CardTitle>
                        <Badge variant="outline">{subscriptionStatus}</Badge>
                    </div>
                </CardHeader>
                <CardContent className="space-y-3 pb-3">
                    {canLinkDevices ? (
                        <p className="text-sm text-muted-foreground">
                            {linkedDeviceCount} of {linkedDeviceLimit} linked
                            devices
                        </p>
                    ) : null}
                    {subscription ? (
                        <p className="text-sm text-muted-foreground">
                            {billingDateLabel}{" "}
                            <span className="font-medium text-foreground">
                                {billingDate}
                            </span>
                        </p>
                    ) : (
                        <p className="text-sm text-muted-foreground">
                            Sign in to view billing details.
                        </p>
                    )}
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
                </CardContent>
                <CardFooter className="flex flex-col items-stretch gap-3 border-t pt-4">
                    {canUpgrade ? (
                        <CheckoutTierPicker
                            value={checkoutTier}
                            onChange={setCheckoutTier}
                            disabled={checkoutOpen}
                        />
                    ) : null}
                    <div className="flex flex-wrap gap-2">
                        <Button
                            type="button"
                            size="sm"
                            onClick={() => setCheckoutOpen(true)}
                            disabled={!canUpgrade || checkoutOpen}
                        >
                            Upgrade
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => void openCustomerPortal()}
                            disabled={!hasSession || !subscription?.nonFree}
                        >
                            Manage billing
                        </Button>
                    </div>
                    {canUpgrade ? <SubscriptionLegalNotice /> : null}
                </CardFooter>
            </Card>

            {lockedPerks.length > 0 ? (
                <Card>
                    <CardHeader className="pb-3">
                        <CardTitle className="flex items-center gap-2 text-sm">
                            <Lock className="h-4 w-4 text-muted-foreground" />
                            Upgrade to unlock
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                        {lockedPerks.map((perk) => (
                            <div
                                key={perk.label}
                                className="rounded-lg border border-dashed px-3 py-2"
                            >
                                <p className="text-sm font-medium">
                                    {perk.label}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                    {perk.detail}
                                </p>
                            </div>
                        ))}
                    </CardContent>
                </Card>
            ) : null}

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
                                    {passkeyBound
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
