import { cn } from "@/lib/utils";

const legalLinkClassName =
    "font-medium text-foreground underline underline-offset-2";

type SubscriptionLegalNoticeProps = {
    className?: string;
};

export function SubscriptionLegalNotice({
    className,
}: SubscriptionLegalNoticeProps) {
    return (
        <p
            className={cn(
                "text-xs leading-relaxed text-muted-foreground",
                className,
            )}
        >
            Premium is a recurring subscription that auto-renews each billing
            period until you cancel. You will be charged the price shown at
            checkout. Cancel anytime from{" "}
            <span className="font-medium text-foreground">Manage billing</span>{" "}
            (Stripe Customer Portal). Payment processing is handled by{" "}
            <a
                href="https://stripe.com"
                target="_blank"
                rel="noopener noreferrer"
                className={legalLinkClassName}
            >
                Stripe
            </a>
            . By subscribing you agree to our{" "}
            <a
                href="/terms"
                target="_blank"
                rel="noopener noreferrer"
                className={legalLinkClassName}
            >
                Terms of Service
            </a>{" "}
            and{" "}
            <a
                href="/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className={legalLinkClassName}
            >
                Privacy Policy
            </a>
            .
        </p>
    );
}
