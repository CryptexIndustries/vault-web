import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { Text as RNText, type Role } from "react-native";

import { cn } from "@/lib/utils";

const textVariants = cva("font-sans text-foreground text-base", {
    variants: {
        variant: {
            default: "",
            muted: "text-muted-foreground text-sm",
            large: "text-lg font-semibold",
            h1: "text-4xl font-bold tracking-tight",
            h2: "text-3xl font-semibold tracking-tight",
            h3: "text-2xl font-semibold tracking-tight",
        },
    },
    defaultVariants: {
        variant: "default",
    },
});

type TextVariantProps = VariantProps<typeof textVariants>;
type TextVariant = NonNullable<TextVariantProps["variant"]>;

const ROLE: Partial<Record<TextVariant, Role>> = {
    h1: "heading",
    h2: "heading",
    h3: "heading",
};

const ARIA_LEVEL: Partial<Record<TextVariant, string>> = {
    h1: "1",
    h2: "2",
    h3: "3",
};

const TextClassContext = React.createContext<string | undefined>(undefined);

type TextProps = React.ComponentProps<typeof RNText> & TextVariantProps;

function Text({
    className,
    variant = "default",
    allowFontScaling = true,
    maxFontSizeMultiplier = 1.4,
    ...props
}: TextProps) {
    const textClass = React.useContext(TextClassContext);

    return (
        <RNText
            className={cn(textVariants({ variant }), textClass, className)}
            role={variant ? ROLE[variant] : undefined}
            aria-level={variant ? ARIA_LEVEL[variant] : undefined}
            allowFontScaling={allowFontScaling}
            maxFontSizeMultiplier={maxFontSizeMultiplier}
            {...props}
        />
    );
}

export { Text, TextClassContext };
export type { TextProps };
