import { useMemo } from "react";

import {
    isWeakPasswordScore,
    PASSWORD_STRENGTH_LABELS,
    scorePassword,
} from "@cryptex-industries/vault-core/vault-utils/password-strength";
import { cn } from "@/lib/utils";

const SCORE_BAR_COLORS = [
    "bg-destructive",
    "bg-orange-500",
    "bg-amber-500",
    "bg-emerald-500",
    "bg-emerald-600",
] as const;

type Props = {
    password: string;
    compact?: boolean;
    /** When false, hides zxcvbn suggestion list (bar, label, warnings still shown). */
    showSuggestions?: boolean;
    className?: string;
};

export function PasswordStrengthMeter({
    password,
    compact = false,
    showSuggestions = true,
    className,
}: Props) {
    const result = useMemo(() => scorePassword(password), [password]);

    if (!result) {
        return null;
    }

    const { score, feedback } = result;
    const weak = isWeakPasswordScore(score);
    const label =
        PASSWORD_STRENGTH_LABELS[score] ?? PASSWORD_STRENGTH_LABELS[0];
    const warning = feedback.warning?.trim();
    const suggestions = feedback.suggestions
        .map((item) => item.trim())
        .filter(Boolean);

    return (
        <div
            className={cn("space-y-1.5", className)}
            aria-live="polite"
            aria-atomic="true"
        >
            <div className="flex items-center justify-between gap-2">
                <div
                    className={cn(
                        "flex flex-1 gap-1",
                        compact ? "h-1" : "h-1.5",
                    )}
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={4}
                    aria-valuenow={score}
                    aria-label="Password strength"
                >
                    {SCORE_BAR_COLORS.map((color, index) => (
                        <div
                            key={index}
                            className={cn(
                                "flex-1 rounded-full bg-muted",
                                index <= score && color,
                            )}
                        />
                    ))}
                </div>
                <span
                    className={cn(
                        "shrink-0 font-medium",
                        compact ? "text-[10px]" : "text-xs",
                        weak ? "text-destructive" : "text-muted-foreground",
                    )}
                >
                    {label}
                </span>
            </div>

            {weak && (
                <p
                    className={cn(
                        "text-destructive",
                        compact ? "text-[10px] leading-snug" : "text-xs",
                    )}
                >
                    This password may be easy to guess offline if someone
                    obtains your vault backup or sync data.
                </p>
            )}

            {warning && showSuggestions ? (
                <p
                    className={cn(
                        "text-muted-foreground",
                        compact ? "text-[10px] leading-snug" : "text-xs",
                    )}
                >
                    {warning}
                </p>
            ) : null}

            {showSuggestions && suggestions.length > 0 ? (
                <ul
                    className={cn(
                        "list-disc space-y-0.5 pl-4 text-muted-foreground",
                        compact ? "text-[10px] leading-snug" : "text-xs",
                    )}
                >
                    {suggestions.map((suggestion) => (
                        <li key={suggestion}>{suggestion}</li>
                    ))}
                </ul>
            ) : null}
        </div>
    );
}
