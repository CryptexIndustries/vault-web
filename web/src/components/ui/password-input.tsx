import * as React from "react";
import { Eye, EyeOff } from "lucide-react";

import { cn } from "@/lib/utils";
import {
    ControlWithActions,
    plainFieldClassName,
} from "@/components/ui/control-with-actions";
import { Input } from "@/components/ui/input";

export type PasswordInputAction = {
    label: string;
    icon: React.ReactNode;
    onClick: () => void;
    title?: string;
    className?: string;
    disabled?: boolean;
};

export type PasswordInputProps = Omit<
    React.ComponentPropsWithoutRef<"input">,
    "type"
> & {
    revealed?: boolean;
    defaultRevealed?: boolean;
    onRevealedChange?: (revealed: boolean) => void;
    secretLabel?: string;
    actions?: PasswordInputAction[];
};

const PasswordInput = React.forwardRef<HTMLInputElement, PasswordInputProps>(
    (
        {
            className,
            revealed,
            defaultRevealed = false,
            onRevealedChange,
            secretLabel = "password",
            actions = [],
            style,
            ...props
        },
        ref,
    ) => {
        const [internallyRevealed, setInternallyRevealed] =
            React.useState(defaultRevealed);
        const isRevealed = revealed ?? internallyRevealed;
        const toggleLabel = `${isRevealed ? "Hide" : "Show"} ${secretLabel}`;

        const toggleRevealed = () => {
            const next = !isRevealed;
            if (revealed === undefined) setInternallyRevealed(next);
            onRevealedChange?.(next);
        };

        return (
            <ControlWithActions
                actions={
                    <>
                        {actions.map((action) => (
                            <button
                                key={action.label}
                                type="button"
                                onClick={action.onClick}
                                disabled={action.disabled}
                                className={cn(
                                    "flex h-full w-9 items-center justify-center text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
                                    action.className,
                                )}
                                aria-label={action.label}
                                title={action.title ?? action.label}
                            >
                                {action.icon}
                            </button>
                        ))}
                        <button
                            type="button"
                            onClick={toggleRevealed}
                            className="flex h-full w-9 items-center justify-center text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                            aria-pressed={isRevealed}
                            aria-label={toggleLabel}
                            title={toggleLabel}
                        >
                            {isRevealed ? (
                                <EyeOff className="h-3.5 w-3.5" />
                            ) : (
                                <Eye className="h-3.5 w-3.5" />
                            )}
                        </button>
                    </>
                }
            >
                <Input
                    {...props}
                    ref={ref}
                    type={isRevealed ? "text" : "password"}
                    className={cn(
                        plainFieldClassName,
                        "h-full w-full px-3",
                        className,
                    )}
                    style={style}
                />
            </ControlWithActions>
        );
    },
);

PasswordInput.displayName = "PasswordInput";

export { PasswordInput };
