import * as React from "react";
import { View, type ViewProps } from "react-native";

import { cn } from "@/lib/utils";

type SeparatorProps = ViewProps & {
    orientation?: "horizontal" | "vertical";
    decorative?: boolean;
};

function Separator({
    className,
    orientation = "horizontal",
    decorative = true,
    ...props
}: SeparatorProps) {
    return (
        <View
            role={decorative ? "none" : "separator"}
            aria-orientation={orientation}
            className={cn(
                "shrink-0 bg-border",
                orientation === "horizontal" ? "h-px w-full" : "h-full w-px",
                className,
            )}
            {...props}
        />
    );
}

export { Separator };
export type { SeparatorProps };
