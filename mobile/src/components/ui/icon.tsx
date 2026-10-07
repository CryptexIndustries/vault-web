import type { LucideIcon, LucideProps } from "lucide-react-native";
import { cssInterop } from "nativewind";
import * as React from "react";

import { cn } from "@/lib/utils";

import { TextClassContext } from "./text";

type IconProps = LucideProps & {
    as: LucideIcon;
};

function IconImpl({ as: IconComponent, ...props }: IconProps) {
    return <IconComponent {...props} />;
}

cssInterop(IconImpl, {
    className: {
        target: "style",
        nativeStyleToProp: {
            color: "color",
            height: "size",
            width: "size",
        },
    },
});

function Icon({
    as: IconComponent,
    className,
    size = 16,
    ...props
}: IconProps) {
    const textClass = React.useContext(TextClassContext);

    return (
        <IconImpl
            as={IconComponent}
            className={cn("text-foreground", textClass, className)}
            size={size}
            {...props}
        />
    );
}

export { Icon };
export type { IconProps };
