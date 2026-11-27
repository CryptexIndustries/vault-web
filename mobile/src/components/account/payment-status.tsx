import {
    AlertCircle,
    Check,
    Clock,
    CreditCard,
    Hourglass,
    ShieldCheck,
    Tag,
    X,
} from "lucide-react-native";
import { useLingui } from "@lingui/react/macro";

import type { CheckoutTier } from "@/app_lib/online-services-billing";
import { StatusPanel, type StatusContent } from "./status-panel";

export type PaymentStatusState =
    | "opening"
    | "confirming"
    | "confirmed"
    | "canceled"
    | "error"
    | "unconfirmed"
    | "storePending"
    /** The store account already subscribes; the owner is not known yet. */
    | "storeOwned"
    /** The store subscription belongs to another Cryptex Vault account. */
    | "ownedElsewhere"
    | "offerChanged"
    /** Stripe: the user came back from the browser without a return link. */
    | "returned";

export type PaymentStatusProps = {
    state: PaymentStatusState;
    store: "app_store" | "google_play" | "stripe";
    /** The Account tab's one-line card instead of the sheet panel. */
    compact?: boolean;
    /** The store already had this account's subscription. Stores only. */
    owned?: boolean;
    /** Confirmation is taking longer than usual. */
    slow?: boolean;
    /** The last check could not reach the server. */
    offline?: boolean;
    /** A status check or restore is running. */
    checking?: boolean;
    /** Error: the store's message, and whether trying again can help. */
    message?: string;
    retryable?: boolean;
    /** The plan has, or now has, a free trial. */
    trial?: boolean;
    /** Confirmed: the plan bought, when known, and its next billing or trial end date. */
    tier?: CheckoutTier;
    date?: string | null;
    onPrimary?: () => void;
    onSecondary?: () => void;
};

export function PaymentStatus({
    state,
    store,
    compact = false,
    owned = false,
    slow = false,
    offline = false,
    checking = false,
    message = "",
    retryable = true,
    trial = false,
    tier,
    date,
    onPrimary,
    onSecondary,
}: PaymentStatusProps) {
    const { t } = useLingui();
    const appStore = store === "app_store";
    const stripe = store === "stripe";
    const payment = t({ message: "Payment", comment: "Checkout step" });
    const membership = t`Membership`;
    const paid = {
        label: payment,
        value: owned ? t`Already subscribed` : t`Received`,
        state: "done",
    } as const;

    const contents: Record<PaymentStatusState, StatusContent> = {
        opening: {
            tone: "progress",
            icon: CreditCard,
            title: stripe
                ? t`Waiting for Stripe Checkout`
                : appStore
                  ? t`Waiting for the App Store`
                  : t`Waiting for Google Play`,
            body: stripe
                ? t`Finish paying in your browser. Nothing is charged until you do.`
                : appStore
                  ? t`Confirm your subscription in the App Store window. Nothing is charged until you do.`
                  : t`Confirm your subscription in Google Play. Nothing is charged until you do.`,
            lines: [
                { label: payment, value: t`In progress`, state: "active" },
                { label: membership, value: t`Not started`, state: "idle" },
            ],
        },
        confirming: {
            tone: "progress",
            icon: ShieldCheck,
            title: t`Confirming your membership`,
            body: slow
                ? t`This is taking longer than usual. You can close this screen and we'll keep checking.`
                : t`We're starting your membership. This usually takes a few seconds.`,
            lines: [
                paid,
                { label: membership, value: t`Confirming…`, state: "active" },
            ],
            secondary: t`Close`,
        },
        confirmed: {
            tone: "success",
            icon: Check,
            title: t`Welcome to Online Services`,
            body: t`Managed connections, encrypted backups and share links are ready on this vault.`,
            lines: [
                ...(tier
                    ? [
                          {
                              label: t({
                                  message: "Plan",
                                  comment:
                                      "Row label: the chosen billing interval",
                              }),
                              value:
                                  tier === "premiumYearly"
                                      ? t`Yearly`
                                      : t`Monthly`,
                          },
                      ]
                    : []),
                ...(date
                    ? [
                          {
                              label: trial ? t`Trial ends` : t`Renews`,
                              value: date,
                          },
                      ]
                    : []),
                {
                    label: t({
                        message: "Billing",
                        comment: "Row label: the service that bills the plan",
                    }),
                    // Service names stay in English.
                    value: stripe
                        ? "Stripe"
                        : appStore
                          ? "App Store"
                          : "Google Play",
                },
            ],
            primary: t`Done`,
        },
        canceled: {
            tone: "neutral",
            icon: X,
            title: t`Payment canceled`,
            body: t`Nothing was charged. You can subscribe now or later from the Account tab.`,
            primary: t`Try again`,
            secondary: t`Not now`,
        },
        error: {
            tone: "error",
            icon: AlertCircle,
            title: t`Payment not completed`,
            body: message,
            primary: retryable ? t`Try again` : undefined,
            secondary: retryable ? t`Not now` : t`Close`,
        },
        unconfirmed: {
            tone: "waiting",
            icon: Clock,
            title: t`Still confirming`,
            body: owned
                ? appStore
                    ? t`Your App Store account already has a subscription, but we couldn't link it yet.`
                    : t`Your Google Play account already has a subscription, but we couldn't link it yet.`
                : offline
                  ? t`Your payment went through. Connect to the internet so we can confirm it. You won't be charged again.`
                  : t`Your payment went through, but we haven't confirmed it yet. You won't be charged again.`,
            note: owned
                ? t`Subscription found. Waiting for confirmation.`
                : offline
                  ? t`Payment received. Waiting for a connection.`
                  : t`Payment received. Waiting for confirmation.`,
            lines: [
                paid,
                checking
                    ? {
                          label: membership,
                          value: t`Checking…`,
                          state: "active",
                      }
                    : {
                          label: membership,
                          value: offline
                              ? t`Waiting for a connection`
                              : t`Not confirmed yet`,
                          state: "waiting",
                      },
            ],
            primary: owned
                ? appStore
                    ? t`Restore App Store purchases`
                    : t`Restore Google Play purchases`
                : t`Check again`,
            secondary: t`Close`,
            action: t`Check now`,
        },
        storeOwned: {
            tone: "waiting",
            icon: CreditCard,
            title: appStore
                ? t`Your Apple Account is already subscribed`
                : t`Your Google account is already subscribed`,
            body: t`Nothing was charged. If this Cryptex Vault account bought it, restore it here. If another one did, use the vault with that account.`,
            primary: appStore
                ? t`Restore App Store purchases`
                : t`Restore Google Play purchases`,
            secondary: t`Not now`,
        },
        ownedElsewhere: {
            tone: "waiting",
            icon: Tag,
            title: t`Subscription belongs to another account`,
            body: appStore
                ? t`Your Apple Account's subscription belongs to another Cryptex Vault account. Use the vault with that account, or cancel the subscription in your Apple Account settings and subscribe here once it ends.`
                : t`Your Google account's subscription belongs to another Cryptex Vault account. Use the vault with that account, or cancel the subscription in Google Play and subscribe here once it ends.`,
            primary: appStore
                ? t`Manage App Store subscriptions`
                : t`Manage Google Play subscriptions`,
            secondary: t`Close`,
        },
        storePending: {
            tone: "waiting",
            icon: Hourglass,
            title: appStore ? t`Waiting for approval` : t`Payment pending`,
            body: appStore
                ? t`The App Store is waiting for this purchase to be approved, for example by a family organizer. Your membership starts once it's approved.`
                : t`Google Play is waiting for your payment to complete. Your membership starts once it's paid.`,
            note: appStore
                ? t`Your membership starts once it's approved.`
                : t`Your membership starts once it's paid.`,
            lines: [
                {
                    label: payment,
                    value: appStore
                        ? t`Awaiting approval`
                        : t`Awaiting payment`,
                    state: "waiting",
                },
                { label: membership, value: t`Not started`, state: "idle" },
            ],
            primary: t`Done`,
            action: t`Check now`,
        },
        offerChanged: {
            tone: "waiting",
            icon: Tag,
            title: t`Plan terms changed`,
            body: trial
                ? t`This plan now starts with a 14-day free trial. Check the terms and continue.`
                : t`The free trial is no longer available for this plan. Check the price and continue.`,
        },
        returned: {
            tone: checking ? "progress" : "waiting",
            icon: CreditCard,
            title: checking ? t`Checking for your payment` : t`No payment yet`,
            body: checking
                ? t`This only takes a moment.`
                : t`If you finished paying in your browser, it can take a moment to arrive. If you closed checkout, nothing was charged.`,
            lines: [
                checking
                    ? { label: payment, value: t`Checking…`, state: "active" }
                    : {
                          label: payment,
                          value: t`Not found yet`,
                          state: "waiting",
                      },
                { label: membership, value: t`Not started`, state: "idle" },
            ],
            primary: checking ? undefined : t`Check again`,
            secondary: checking ? undefined : t`Open checkout again`,
            action: t`Check now`,
        },
    };

    return (
        <StatusPanel
            content={contents[state]}
            compact={compact}
            busy={checking}
            busyLabel={t`Checking…`}
            onPrimary={onPrimary}
            onSecondary={onSecondary}
        />
    );
}
