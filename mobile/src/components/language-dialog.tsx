import { Pressable, View } from "react-native";
import { useLingui } from "@lingui/react/macro";

import { Dialog, DialogHeader } from "@/components/ui/dialog";
import {
    UnlockedDialogTitle as DialogTitle,
    UnlockedText as Text,
} from "@/components/unlocked/unlocked-ui";
import {
    APP_LOCALES,
    chooseAppLocale,
    getChosenAppLocale,
    type AppLocale,
} from "@/i18n";
import { colors } from "@/theme";

export function LanguageDialog({
    open,
    onOpenChange,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const { t } = useLingui();
    const chosen = getChosenAppLocale();
    const options: { locale: AppLocale | null; label: string }[] = [
        { locale: null, label: t`Device language` },
        ...Object.entries(APP_LOCALES).map(([locale, label]) => ({
            locale: locale as AppLocale,
            label,
        })),
    ];

    return (
        <Dialog
            open={open}
            onOpenChange={onOpenChange}
            placement="bottom"
            scroll
        >
            <DialogHeader>
                <DialogTitle>{t`Language`}</DialogTitle>
            </DialogHeader>
            <View>
                {options.map(({ locale, label }) => {
                    const selected = chosen === locale;
                    return (
                        <Pressable
                            key={locale ?? "device"}
                            accessibilityRole="radio"
                            accessibilityState={{ checked: selected }}
                            onPress={() => {
                                onOpenChange(false);
                                void chooseAppLocale(locale);
                            }}
                            style={{
                                flexDirection: "row",
                                alignItems: "center",
                                gap: 13,
                                paddingVertical: 18,
                                borderBottomWidth: 1,
                                borderBottomColor: colors.border,
                            }}
                        >
                            <View
                                style={{
                                    width: 18,
                                    height: 18,
                                    borderRadius: 9,
                                    borderWidth: 1,
                                    borderColor: selected
                                        ? colors.primary
                                        : colors.muted,
                                    alignItems: "center",
                                    justifyContent: "center",
                                }}
                            >
                                {selected ? (
                                    <View
                                        style={{
                                            width: 10,
                                            height: 10,
                                            borderRadius: 5,
                                            backgroundColor: colors.primary,
                                        }}
                                    />
                                ) : null}
                            </View>
                            <Text style={{ flex: 1, fontSize: 14 }}>
                                {label}
                            </Text>
                        </Pressable>
                    );
                })}
            </View>
        </Dialog>
    );
}
