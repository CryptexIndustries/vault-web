import * as React from "react";

import { cn } from "@/lib/utils";

/** Bordered field whose trailing actions sit beside the value. */
export function ControlWithActions({
    className,
    children,
    actions,
    align = "center",
}: {
    className?: string;
    children: React.ReactNode;
    actions?: React.ReactNode;
    align?: "center" | "start";
}) {
    return (
        <div
            className={cn(
                "flex w-full rounded-md border border-input bg-transparent shadow-sm focus-within:ring-1 focus-within:ring-ring",
                align === "center" ? "h-9 items-center" : "items-start",
                className,
            )}
        >
            <div
                className={cn("min-w-0 flex-1", align === "center" && "h-full")}
            >
                {children}
            </div>
            {actions ? (
                <div
                    className={cn(
                        "flex shrink-0 items-center",
                        align === "center" && "h-full",
                    )}
                >
                    {actions}
                </div>
            ) : null}
        </div>
    );
}

export const plainFieldClassName =
    "rounded-none border-0 bg-transparent shadow-none focus-visible:ring-0";
