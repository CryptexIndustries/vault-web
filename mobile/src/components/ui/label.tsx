import * as React from "react";

import { cn } from "@/lib/utils";

import { Text, type TextProps } from "./text";

type LabelProps = TextProps;

function Label({ className, ...props }: LabelProps) {
    return (
        <Text
            className={cn(
                "text-sm font-medium leading-none text-foreground",
                className,
            )}
            {...props}
        />
    );
}

export { Label };
export type { LabelProps };
