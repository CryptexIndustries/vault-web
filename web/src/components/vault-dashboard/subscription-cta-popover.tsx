import { useCallback, useEffect, useState } from "react";
import { User } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
    Popover,
    PopoverAnchor,
    PopoverContent,
} from "@/components/ui/popover";

export type SubscriptionCtaVariant = "signup" | "signin" | "upgrade";

const SUBSCRIPTION_CTA_STORAGE_KEY =
    "cryptex.sidebar.subscriptionCtaDismissedAt";
const SUBSCRIPTION_CTA_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000;
const SUBSCRIPTION_CTA_DELAY_MS = 800;

const DEFAULT_ACCOUNT_BUTTON_CLASS_NAME =
    "hover:bg-sidebar-accent/70 h-9 w-full justify-start gap-2 rounded-md text-xs text-muted-foreground transition-all hover:text-foreground";

const CTA_COPY: Record<
    SubscriptionCtaVariant,
    { title: string; description: string; action: string }
> = {
    signup: {
        title: "Unlock zero-worry vault features",
        description:
            "Sign up to sync, back up, get security insights, and securely share vault items.",
        action: "Sign up",
    },
    signin: {
        title: "Unlock zero-worry vault features",
        description:
            "Sign in to subscribe, sync, back up, get security insights, and securely share vault items.",
        action: "Sign in",
    },
    upgrade: {
        title: "Upgrade for zero-worry vault features",
        description:
            "Subscribe to unlock encrypted sync, secure backups, security insights, and vault item sharing.",
        action: "Upgrade",
    },
};

interface SubscriptionCtaPopoverProps {
    enabled: boolean;
    variant: SubscriptionCtaVariant;
    isMobile?: boolean;
    buttonLabel: string;
    buttonClassName?: string;
    onAccountAction: () => void;
}

function getStorageKey(variant: SubscriptionCtaVariant): string {
    return `${SUBSCRIPTION_CTA_STORAGE_KEY}.${variant}`;
}

function hasActiveSubscriptionCtaCooldown(
    variant: SubscriptionCtaVariant,
): boolean {
    try {
        const dismissedAt = Number(
            window.localStorage.getItem(getStorageKey(variant)),
        );
        return (
            Number.isFinite(dismissedAt) &&
            Date.now() - dismissedAt < SUBSCRIPTION_CTA_COOLDOWN_MS
        );
    } catch {
        return false;
    }
}

function rememberSubscriptionCtaDismissal(variant: SubscriptionCtaVariant) {
    try {
        window.localStorage.setItem(getStorageKey(variant), String(Date.now()));
    } catch {
        // Local storage can be unavailable in private browsing or locked-down contexts.
    }
}

export function SubscriptionCtaPopover({
    enabled,
    variant,
    isMobile,
    buttonLabel,
    buttonClassName,
    onAccountAction,
}: SubscriptionCtaPopoverProps) {
    const [open, setOpen] = useState(false);
    const [isDesktopSidebarVisible, setIsDesktopSidebarVisible] =
        useState(false);

    const copy = CTA_COPY[variant];
    const canShowCta = enabled && (isMobile || isDesktopSidebarVisible);

    useEffect(() => {
        if (isMobile) {
            setIsDesktopSidebarVisible(false);
            return;
        }

        const mediaQuery = window.matchMedia("(min-width: 1024px)");
        const updateVisibility = () => {
            setIsDesktopSidebarVisible(mediaQuery.matches);
        };

        updateVisibility();
        mediaQuery.addEventListener("change", updateVisibility);

        return () => {
            mediaQuery.removeEventListener("change", updateVisibility);
        };
    }, [isMobile]);

    useEffect(() => {
        setOpen(false);
    }, [variant]);

    useEffect(() => {
        if (!canShowCta) {
            setOpen(false);
            return;
        }

        if (hasActiveSubscriptionCtaCooldown(variant)) return;

        const timeoutId = window.setTimeout(() => {
            setOpen(true);
        }, SUBSCRIPTION_CTA_DELAY_MS);

        return () => {
            window.clearTimeout(timeoutId);
        };
    }, [canShowCta, variant]);

    const dismiss = useCallback(() => {
        setOpen(false);
        rememberSubscriptionCtaDismissal(variant);
    }, [variant]);

    const handleOpenChange = useCallback(
        (nextOpen: boolean) => {
            if (nextOpen) {
                if (!canShowCta) return;
                setOpen(true);
                return;
            }

            dismiss();
        },
        [canShowCta, dismiss],
    );

    const handleAccountAction = useCallback(() => {
        if (enabled) dismiss();
        onAccountAction();
    }, [dismiss, enabled, onAccountAction]);

    return (
        <Popover open={open} onOpenChange={handleOpenChange}>
            <PopoverAnchor asChild>
                <Button
                    variant="ghost"
                    className={
                        buttonClassName ?? DEFAULT_ACCOUNT_BUTTON_CLASS_NAME
                    }
                    onClick={handleAccountAction}
                >
                    <User className="h-3.5 w-3.5" />
                    {buttonLabel}
                </Button>
            </PopoverAnchor>
            <PopoverContent
                side={isMobile ? "top" : "right"}
                align={isMobile ? "center" : "start"}
                sideOffset={8}
                className="w-72 p-3"
                onOpenAutoFocus={(event) => event.preventDefault()}
            >
                <div className="space-y-2">
                    <div>
                        <p className="text-sm font-medium">{copy.title}</p>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">
                            {copy.description}
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button
                            type="button"
                            size="sm"
                            className="h-8 text-xs"
                            onClick={handleAccountAction}
                        >
                            {copy.action}
                        </Button>
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8 text-xs"
                            onClick={dismiss}
                        >
                            Not now
                        </Button>
                    </div>
                </div>
            </PopoverContent>
        </Popover>
    );
}
