import { Pressable, View } from "react-native";
import { router } from "expo-router";
import {
    ChevronRight,
    FileKey,
    RectangleEllipsis,
    type LucideIcon,
} from "lucide-react-native";

import {
    UnlockedDialogTitle as DialogTitle,
    UnlockedText,
} from "@/components/unlocked/unlocked-ui";
import { Dialog, DialogHeader } from "@/components/ui/dialog";
import { colors } from "@/theme";

export type NewItemType = "login" | "ssh-key";

const ITEM_TYPES: Array<{
    type: NewItemType;
    title: string;
    subtitle: string;
    icon: LucideIcon;
}> = [
    {
        type: "login",
        title: "Login",
        subtitle: "Username, password and websites",
        icon: RectangleEllipsis,
    },
    {
        type: "ssh-key",
        title: "SSH key",
        subtitle: "Generate a new key or add one you use",
        icon: FileKey,
    },
];

/** Opens the editor for a new item of this type. */
export function openNewItem(type: NewItemType, directoryId: string) {
    router.push({
        pathname: "/(app)/(tabs)/vault/new",
        params: type === "ssh-key" ? { directoryId, type } : { directoryId },
    });
}

/** The add button's type choice: one row per item type. */
export function AddItemSheet({
    open,
    onOpenChange,
    directoryId,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    directoryId: string;
}) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange} placement="bottom">
            <DialogHeader>
                <DialogTitle>Add item</DialogTitle>
            </DialogHeader>
            {ITEM_TYPES.map(({ type, title, subtitle, icon: Icon }) => (
                <Pressable
                    key={type}
                    testID={`add-item-${type}`}
                    accessibilityRole="button"
                    accessibilityLabel={`${title}, ${subtitle}`}
                    android_ripple={{ color: colors.border }}
                    onPress={() => {
                        onOpenChange(false);
                        openNewItem(type, directoryId);
                    }}
                    style={{
                        minHeight: 72,
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 12,
                        borderBottomWidth: 1,
                        borderBottomColor: colors.border,
                    }}
                >
                    <View
                        style={{
                            width: 36,
                            height: 36,
                            borderRadius: 18,
                            alignItems: "center",
                            justifyContent: "center",
                            backgroundColor: colors.secondary,
                        }}
                    >
                        <Icon
                            size={18}
                            color={colors.primary}
                            strokeWidth={1.8}
                        />
                    </View>
                    <View style={{ minWidth: 0, flex: 1 }}>
                        <UnlockedText
                            style={{ fontSize: 15, fontWeight: "600" }}
                        >
                            {title}
                        </UnlockedText>
                        <UnlockedText
                            numberOfLines={1}
                            style={{
                                color: colors.muted,
                                fontSize: 12,
                                marginTop: 5,
                            }}
                        >
                            {subtitle}
                        </UnlockedText>
                    </View>
                    <ChevronRight size={17} color={colors.muted} />
                </Pressable>
            ))}
        </Dialog>
    );
}
