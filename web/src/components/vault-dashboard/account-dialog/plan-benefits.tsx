"use client";

import type { ReactNode } from "react";
import {
    Check,
    ChevronDown,
    DatabaseBackup,
    Link2,
    Lock,
    MonitorSmartphone,
    RadioTower,
    SquareTerminal,
    type LucideIcon,
} from "lucide-react";

import type { CheckoutTier } from "@/app_lib/online-services";
import { Button } from "@/components/ui/button";
import { SubscriptionLegalNotice } from "@/components/vault-dashboard/subscription-legal-notice";
import { currentPriceList, yearlySaving } from "@/lib/price-lists";
import { cn } from "@/lib/utils";

export type PlanAccess = {
    canLink?: boolean;
    maxLinks?: number;
    canPromoteDevices?: boolean;
    managedEncryptedBackups?: boolean;
    passwordSharing?: boolean;
    sshAgentRelay?: boolean;
    maxSshAgents?: number;
};

type ManagedBenefit = {
    key: string;
    icon: LucideIcon;
    title: string;
    description: string;
    allowance: string;
    included: boolean;
    usage?: { used: number; limit: number; label: string };
};

const vaultBenefits = [
    "Local encrypted vault",
    "Web app, Android app & Chromium extension",
    "Autofill and passkey support",
    "Basic security reports",
    "Imports, exports & manual encrypted backups",
    "Peer-to-peer sync on your own infrastructure",
    "SSH keys and the SSH agent on your own relay",
];

function buildManagedBenefits(
    access: PlanAccess | null | undefined,
    subscribed: boolean,
    linkedDevices: number,
): ManagedBenefit[] {
    // Until the tier config loads, or for a flag an older backend doesn't
    // send, assume the subscription grants it.
    const has = (flag: boolean | undefined) =>
        access && flag !== undefined ? flag === true : subscribed;
    const maxLinks = access?.maxLinks ?? 0;
    const maxSshAgents = access?.maxSshAgents ?? 0;

    return [
        {
            key: "sync",
            icon: RadioTower,
            title: "Managed sync infrastructure",
            description:
                "Hosted signaling and relay, so linked devices connect without your own servers.",
            allowance: "No servers to run",
            included: has(access?.canLink),
            usage:
                access?.canLink && maxLinks > 0
                    ? {
                          used: linkedDevices,
                          limit: maxLinks,
                          label: "linked devices",
                      }
                    : undefined,
        },
        {
            key: "backups",
            icon: DatabaseBackup,
            title: "Managed encrypted backups",
            description:
                "Encrypted restore points with version history, reachable with your Recovery Kit.",
            allowance: "150 MB storage",
            included: has(access?.managedEncryptedBackups),
        },
        {
            key: "share",
            icon: Link2,
            title: "One-time share links",
            description:
                "Send a secret to anyone. It opens once, then it's deleted.",
            allowance: "200 open links",
            included: has(access?.passwordSharing),
        },
        {
            key: "agents",
            icon: SquareTerminal,
            title: "Hosted SSH agent relay",
            description:
                "Approve SSH logins on your Linux machines without running a relay.",
            allowance:
                maxSshAgents > 0
                    ? `Up to ${maxSshAgents} agents`
                    : "No relay to run",
            included: has(access?.sshAgentRelay),
        },
        {
            key: "devices",
            icon: MonitorSmartphone,
            title: "Device management",
            description:
                "Promote trusted devices to root, control links, and revoke access.",
            allowance: "Root promotion",
            included: has(access?.canPromoteDevices),
        },
    ];
}

function UsageMeter({
    used,
    limit,
    label,
}: NonNullable<ManagedBenefit["usage"]>) {
    const ratio = Math.min(1, used / limit);
    return (
        <div className="space-y-1">
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                    className={cn(
                        "h-full rounded-full",
                        ratio >= 1 ? "bg-amber-500" : "bg-emerald-500",
                    )}
                    style={{ width: `${ratio * 100}%` }}
                />
            </div>
            <p className="text-xs text-muted-foreground">
                {used} of {limit} {label}
            </p>
        </div>
    );
}

function IncludedBenefitRow({ benefit }: { benefit: ManagedBenefit }) {
    const Icon = benefit.icon;
    return (
        <li className="flex gap-3 rounded-lg border bg-card px-3 py-3">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-500">
                <Icon className="h-4 w-4" />
            </span>
            <div className="flex min-w-0 flex-1 flex-col">
                <p className="text-sm font-medium">{benefit.title}</p>
                <p className="text-xs text-muted-foreground">
                    {benefit.description}
                </p>
                <div className="mt-auto pt-2">
                    {benefit.usage ? (
                        <UsageMeter {...benefit.usage} />
                    ) : (
                        <p className="flex items-center gap-1.5 text-xs font-medium text-emerald-500">
                            <Check className="h-3.5 w-3.5" />
                            {benefit.allowance}
                        </p>
                    )}
                </div>
            </div>
        </li>
    );
}

function LockedBenefitRow({ benefit }: { benefit: ManagedBenefit }) {
    const Icon = benefit.icon;
    return (
        <li className="flex gap-3 py-2.5">
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Icon className="h-3.5 w-3.5" />
            </span>
            <div className="min-w-0 flex-1">
                <p className="text-sm font-medium leading-tight">
                    {benefit.title}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                    {benefit.description}
                </p>
                <p className="mt-1 text-xs font-medium text-primary">
                    {benefit.allowance}
                </p>
            </div>
        </li>
    );
}

function VaultBenefitList({ className }: { className?: string }) {
    return (
        <ul className={cn("space-y-2", className)}>
            {vaultBenefits.map((title) => (
                <li key={title} className="flex items-start gap-2 text-sm">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                    <span>{title}</span>
                </li>
            ))}
        </ul>
    );
}

function Eyebrow({ children }: { children: ReactNode }) {
    return (
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {children}
        </p>
    );
}

const monthlyPrice = Number(currentPriceList.monthly.price);
const yearlyPrice = Number(currentPriceList.yearly.price);

function formatPrice(tier: CheckoutTier) {
    return tier === "premiumYearly"
        ? { amount: `€${yearlyPrice}`, period: "year" }
        : { amount: `€${monthlyPrice}`, period: "month" };
}

function IntervalToggle({
    value,
    onChange,
    disabled,
}: {
    value: CheckoutTier;
    onChange: (tier: CheckoutTier) => void;
    disabled?: boolean;
}) {
    const options: { tier: CheckoutTier; label: ReactNode }[] = [
        { tier: "premiumMonthly", label: "Monthly" },
        {
            tier: "premiumYearly",
            label: (
                <>
                    Yearly
                    <span className="ml-1.5 text-[11px] text-emerald-500">
                        Save €{yearlySaving(currentPriceList)}
                    </span>
                </>
            ),
        },
    ];
    return (
        <div
            role="group"
            aria-label="Billing interval"
            className="inline-flex rounded-md border bg-muted/40 p-0.5"
        >
            {options.map((option) => (
                <button
                    key={option.tier}
                    type="button"
                    aria-pressed={value === option.tier}
                    disabled={disabled}
                    onClick={() => onChange(option.tier)}
                    className={cn(
                        "rounded px-3 py-1 text-xs transition-colors disabled:opacity-50",
                        value === option.tier
                            ? "bg-background font-medium shadow-sm"
                            : "text-muted-foreground hover:text-foreground",
                    )}
                >
                    {option.label}
                </button>
            ))}
        </div>
    );
}

type UpgradeControls = {
    tier: CheckoutTier;
    onTierChange: (tier: CheckoutTier) => void;
    onUpgrade: () => void;
    /** False while the subscription loads or checkout is blocked. */
    canUpgrade: boolean;
    checkoutOpen: boolean;
};

type PlanBenefitsProps = {
    access: PlanAccess | null | undefined;
    subscribed: boolean;
    linkedDevices: number;
    upgrade: UpgradeControls;
};

export function PlanBenefits({
    access,
    subscribed,
    linkedDevices,
    upgrade,
}: PlanBenefitsProps) {
    const managed = buildManagedBenefits(access, subscribed, linkedDevices);
    const included = managed.filter((benefit) => benefit.included);
    const locked = managed.filter((benefit) => !benefit.included);

    if (locked.length === 0) {
        return (
            <section className="space-y-3" aria-label="Plan benefits">
                <Eyebrow>Included in your plan</Eyebrow>
                <ul className="grid gap-2 sm:grid-cols-2">
                    {included.map((benefit) => (
                        <IncludedBenefitRow
                            key={benefit.key}
                            benefit={benefit}
                        />
                    ))}
                </ul>
                <details className="group rounded-lg border px-4 py-3">
                    <summary className="flex cursor-pointer list-none items-center justify-between text-sm">
                        <span>Plus everything in the free vault</span>
                        <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
                    </summary>
                    <VaultBenefitList className="mt-3" />
                </details>
            </section>
        );
    }

    const price = formatPrice(upgrade.tier);
    const showUpgrade = !subscribed;

    return (
        <section
            className="overflow-hidden rounded-lg border"
            aria-label="Plan benefits"
        >
            <div className="grid sm:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
                <div className="p-4">
                    <Eyebrow>Your plan</Eyebrow>
                    <p className="mt-1 text-lg font-semibold">Free</p>
                    <p className="text-xs text-muted-foreground">
                        €0, yours to keep
                    </p>
                    <VaultBenefitList className="mt-4" />
                    {included.length > 0 ? (
                        <ul className="mt-2 space-y-2">
                            {included.map((benefit) => (
                                <li
                                    key={benefit.key}
                                    className="flex items-start gap-2 text-sm"
                                >
                                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                                    <span>{benefit.title}</span>
                                </li>
                            ))}
                        </ul>
                    ) : null}
                </div>

                <div className="border-t border-primary/30 bg-primary/[0.04] p-4 sm:border-l sm:border-t-0">
                    <div className="flex items-start justify-between gap-3">
                        <div>
                            <Eyebrow>Available with</Eyebrow>
                            <p className="mt-1 text-lg font-semibold">
                                Online Services
                            </p>
                        </div>
                        <div className="text-right">
                            <p className="text-lg font-semibold">
                                {price.amount}
                                <span className="text-xs font-normal text-muted-foreground">
                                    {" "}
                                    / {price.period}
                                </span>
                            </p>
                            <p className="text-[11px] text-muted-foreground">
                                VAT included
                            </p>
                        </div>
                    </div>
                    <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Lock className="h-3 w-3" />
                        Everything in Free, plus:
                    </p>
                    <ul className="mt-1 divide-y divide-border/60">
                        {locked.map((benefit) => (
                            <LockedBenefitRow
                                key={benefit.key}
                                benefit={benefit}
                            />
                        ))}
                    </ul>
                </div>
            </div>

            {showUpgrade ? (
                <div className="space-y-3 border-t bg-muted/20 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <IntervalToggle
                            value={upgrade.tier}
                            onChange={upgrade.onTierChange}
                            disabled={
                                !upgrade.canUpgrade || upgrade.checkoutOpen
                            }
                        />
                        <Button
                            type="button"
                            onClick={upgrade.onUpgrade}
                            disabled={
                                !upgrade.canUpgrade || upgrade.checkoutOpen
                            }
                        >
                            Upgrade
                        </Button>
                    </div>
                    {upgrade.canUpgrade ? <SubscriptionLegalNotice /> : null}
                </div>
            ) : null}
        </section>
    );
}
