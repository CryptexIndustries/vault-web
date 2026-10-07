import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { View, type ViewProps } from "react-native";

import { cn } from "@/lib/utils";

import { TextClassContext } from "./text";

const badgeVariants = cva(
    "flex-row items-center justify-center rounded-md border px-2 py-0.5",
    {
        variants: {
            variant: {
                default: "border-transparent bg-primary",
                secondary: "border-transparent bg-secondary",
                outline: "border-border bg-transparent",
                destructive: "border-transparent bg-destructive",
            },
        },
        defaultVariants: {
            variant: "default",
        },
    },
);

const badgeTextVariants = cva("text-xs font-semibold", {
    variants: {
        variant: {
            default: "text-primary-foreground",
            secondary: "text-secondary-foreground",
            outline: "text-foreground",
            destructive: "text-destructive-foreground",
        },
    },
    defaultVariants: {
        variant: "default",
    },
});

type BadgeProps = ViewProps & VariantProps<typeof badgeVariants>;

function Badge({ className, variant, ...props }: BadgeProps) {
    return (
        <TextClassContext.Provider value={badgeTextVariants({ variant })}>
            <View
                className={cn(badgeVariants({ variant }), className)}
                {...props}
            />
        </TextClassContext.Provider>
    );
}

export { Badge };
