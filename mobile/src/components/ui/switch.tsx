import * as React from "react";
import { Switch as RNSwitch, type SwitchProps as RNSwitchProps } from "react-native";

import { cn } from "@/lib/utils";
import { colors } from "@/theme";

type SwitchProps = RNSwitchProps & {
    className?: string;
};

function Switch({ className, disabled, ...props }: SwitchProps) {
    return (
        <RNSwitch
            className={cn(disabled && "opacity-50", className)}
            trackColor={{ false: colors.trackOff, true: colors.primary }}
            thumbColor={colors.foreground}
            ios_backgroundColor={colors.trackOff}
            disabled={disabled}
            accessibilityRole="switch"
            {...props}
        />
    );
}

export { Switch };
export type { SwitchProps };
