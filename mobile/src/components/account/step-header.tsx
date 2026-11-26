import { View } from "react-native";

import { UnlockedText as Text } from "@/components/unlocked/unlocked-ui";
import { cn } from "@/lib/utils";

const count = (value: number) => String(value).padStart(2, "0");

export function StepHeader({
    label,
    step,
    total,
}: {
    label: string;
    step: number;
    total: number;
}) {
    return (
        <View className="mb-2">
            <View className="mb-3 flex-row justify-between">
                <Text className="text-[10px] uppercase tracking-[1.3px] text-muted-foreground">
                    {label}
                </Text>
                <Text className="text-[10px] tracking-[1.3px] text-muted-foreground">
                    {`${count(step)} / ${count(total)}`}
                </Text>
            </View>
            <View className="flex-row gap-1.5">
                {Array.from({ length: total }, (_, index) => (
                    <View
                        key={index}
                        className={cn(
                            "h-0.5 flex-1",
                            index < step ? "bg-primary" : "bg-border",
                        )}
                    />
                ))}
            </View>
        </View>
    );
}
