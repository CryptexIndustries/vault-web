import { cn } from "@/lib/utils";

const legalLinkClassName =
    "font-medium text-foreground underline underline-offset-2";

type SubscriptionLegalNoticeProps = {
    className?: string;
    /** Undefined omits the trial/paid sentence until fresh data loads. */
    trialEligible?: boolean;
};

export function SubscriptionLegalNotice({
    className,
    trialEligible,
}: SubscriptionLegalNoticeProps) {
    return (
        <p
            className={cn(
                "text-xs leading-relaxed text-muted-foreground",
                className,
            )}
        >
            Online Services is a recurring subscription that auto-renews each
            billing period until you cancel.{" "}
            {trialEligible === undefined
                ? null
                : trialEligible
                  ? "It starts with a 14-day free trial. Your card is charged the price shown at checkout when the trial ends, unless you cancel before then. If you cancel during the trial, you keep access until it ends and pay nothing. "
                  : "You will be charged the price shown at checkout. "}
            Cancel anytime from{" "}
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
