import { useCallback, useEffect, useRef, useState } from "react";
import { Platform, View } from "react-native";
import { MenuView, type MenuComponentRef } from "@react-native-menu/menu";
import {
    Check,
    ChevronsUpDown,
    Copy,
    Minus,
    Plus,
    RefreshCw,
} from "lucide-react-native";
import { useLingui } from "@lingui/react/macro";

import { Dialog, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Text } from "@/components/ui/text";
import { SegmentedControl } from "@/components/segmented-control";
import { IconButton } from "@/components/icon-button";
import { PasswordStrengthMeter } from "@/components/vault/password-strength-meter";
import { copySecretToClipboard } from "@/utils/clipboard";
import { colors } from "@/theme";
import {
    generatePassword,
    type GeneratorOptions,
} from "@/utils/password-generation";

const DEFAULT_OPTIONS: GeneratorOptions = {
    type: "random",
    length: 16,
    includeUppercase: true,
    includeLowercase: true,
    includeNumbers: true,
    includeSymbols: false,
    wordSeparator: "space",
};

const MIN_LENGTH = 4;
const MAX_LENGTH = 128;

type PasswordGeneratorDialogProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onPasswordSelect?: (password: string) => void;
    placement?: "center" | "bottom";
};

/** Same layout as GeneratorSheet in mobile/targets/autofill/AddLoginView.swift. */
export function PasswordGeneratorDialog({
    open,
    onOpenChange,
    onPasswordSelect,
    placement = "center",
}: PasswordGeneratorDialogProps) {
    const { t } = useLingui();
    const [options, setOptions] = useState<GeneratorOptions>(DEFAULT_OPTIONS);
    const [password, setPassword] = useState("");
    const [noCharacterTypes, setNoCharacterTypes] = useState(false);
    const [copied, setCopied] = useState(false);
    const [scoredPassword, setScoredPassword] = useState("");
    const separatorMenu = useRef<MenuComponentRef>(null);
    const lengthRepeat = useRef<ReturnType<typeof setInterval>>(undefined);

    const regenerate = useCallback(() => {
        setNoCharacterTypes(false);
        if (
            options.type === "random" &&
            !options.includeUppercase &&
            !options.includeLowercase &&
            !options.includeNumbers &&
            !options.includeSymbols
        ) {
            setNoCharacterTypes(true);
            setPassword("");
            return;
        }
        setPassword(generatePassword(options));
    }, [options]);

    useEffect(() => {
        if (open) regenerate();
    }, [open, regenerate]);

    // Scoring long passwords is slow, so wait until the taps stop.
    useEffect(() => {
        const timer = setTimeout(() => setScoredPassword(password), 200);
        return () => clearTimeout(timer);
    }, [password]);
    const scored = scoredPassword === password;

    // Closing the sheet mid-hold skips onPressOut.
    useEffect(() => () => clearInterval(lengthRepeat.current), [open]);

    const setOption = <K extends keyof GeneratorOptions>(
        key: K,
        value: GeneratorOptions[K],
    ) => {
        setOptions((prev) => ({ ...prev, [key]: value }));
    };

    const lengthLabel =
        options.type === "memorable" ? t`Word count` : t`Length`;
    const changeLength = (by: number) =>
        setOptions((prev) => {
            const length = Math.min(
                MAX_LENGTH,
                Math.max(MIN_LENGTH, prev.length + by),
            );
            return length === prev.length ? prev : { ...prev, length };
        });
    const lengthButtonProps = (by: number) => ({
        onPress: () => changeLength(by),
        // onPress doesn't fire after a long press, so step once here.
        onLongPress: () => {
            changeLength(by);
            lengthRepeat.current = setInterval(() => changeLength(by), 60);
        },
        onPressOut: () => clearInterval(lengthRepeat.current),
    });

    const separators: Record<GeneratorOptions["wordSeparator"], string> = {
        space: t({
            message: "Space",
            comment: "Word separator: space character",
        }),
        dash: "-",
        underscore: "_",
        none: t({
            message: "None",
            comment: "Word separator: no separator",
        }),
    };

    const switchRow = (
        key:
            | "includeLowercase"
            | "includeUppercase"
            | "includeNumbers"
            | "includeSymbols",
        label: string,
    ) => (
        <View
            key={key}
            className="min-h-[44px] flex-row items-center justify-between border-t border-border px-3"
        >
            <Text className="text-sm text-foreground">{label}</Text>
            <Switch
                value={options[key]}
                onValueChange={(v) => setOption(key, v)}
                accessibilityLabel={label}
            />
        </View>
    );

    return (
        <Dialog
            open={open}
            onOpenChange={onOpenChange}
            placement={placement}
            scroll
        >
            <View className="flex-row items-center">
                <View className="flex-1" />
                <DialogTitle className="text-base leading-6 tracking-normal">
                    {t`Password generator`}
                </DialogTitle>
                <View className="flex-1 items-end">
                    {onPasswordSelect ? (
                        <Button
                            variant="ghost"
                            className="px-2"
                            textClassName="font-semibold text-primary"
                            disabled={!password}
                            onPress={() => {
                                onPasswordSelect(password);
                                onOpenChange(false);
                            }}
                        >
                            {t`Use password`}
                        </Button>
                    ) : null}
                </View>
            </View>

            <View className="gap-4">
                <View className="rounded-lg border border-border bg-secondary/50 p-3">
                    <View className="flex-row items-start gap-2">
                        {noCharacterTypes ? (
                            <Text className="min-w-0 flex-1 py-2 text-sm text-primary">
                                {t`Select at least one character type`}
                            </Text>
                        ) : (
                            <Text
                                className="min-w-0 flex-1 py-1.5 font-mono text-lg leading-7 text-foreground"
                                selectable
                                accessibilityLabel={t`Generated password. Value hidden from accessibility tree until copied.`}
                                importantForAccessibility="no-hide-descendants"
                            >
                                {password}
                            </Text>
                        )}
                        <IconButton
                            icon={RefreshCw}
                            label={t`Regenerate password`}
                            onPress={regenerate}
                        />
                        <IconButton
                            icon={copied ? Check : Copy}
                            label={t`Copy generated password`}
                            disabled={!password}
                            onPress={() => {
                                void copySecretToClipboard(password).then(
                                    (ok) => {
                                        if (!ok) return;
                                        setCopied(true);
                                        setTimeout(
                                            () => setCopied(false),
                                            1500,
                                        );
                                    },
                                );
                            }}
                        />
                    </View>
                    {password && scoredPassword ? (
                        // Hidden but kept in the layout so the buttons below don't move.
                        <View
                            className={scored ? undefined : "opacity-0"}
                            accessibilityElementsHidden={!scored}
                            importantForAccessibility={
                                scored ? "auto" : "no-hide-descendants"
                            }
                        >
                            <PasswordStrengthMeter
                                password={scoredPassword}
                                showSuggestions={false}
                            />
                        </View>
                    ) : null}
                </View>

                <View className="overflow-hidden rounded-lg border border-border bg-secondary/50">
                    <View className="p-3">
                        <SegmentedControl
                            segments={[
                                {
                                    value: "random",
                                    label: t({
                                        message: "Random",
                                        comment: "Password generator mode",
                                    }),
                                },
                                {
                                    value: "memorable",
                                    label: t({
                                        message: "Memorable",
                                        comment:
                                            "Password generator mode: passphrase of words",
                                    }),
                                },
                            ]}
                            value={options.type}
                            onChange={(type) => {
                                setOptions((prev) => ({
                                    ...prev,
                                    type,
                                    length: type === "memorable" ? 4 : 16,
                                }));
                            }}
                        />
                    </View>

                    <View
                        className="min-h-[44px] flex-row items-center border-t border-border pl-3"
                        accessible
                        accessibilityRole="adjustable"
                        accessibilityLabel={lengthLabel}
                        accessibilityValue={{ text: String(options.length) }}
                        accessibilityActions={[
                            { name: "increment" },
                            { name: "decrement" },
                        ]}
                        onAccessibilityAction={(event) =>
                            changeLength(
                                event.nativeEvent.actionName === "increment"
                                    ? 1
                                    : -1,
                            )
                        }
                    >
                        <Text className="flex-1 text-sm text-foreground">
                            {lengthLabel}
                        </Text>
                        <Text className="px-2 font-mono text-sm text-muted-foreground">
                            {options.length}
                        </Text>
                        <IconButton
                            icon={Minus}
                            label={lengthLabel}
                            disabled={options.length <= MIN_LENGTH}
                            {...lengthButtonProps(-1)}
                        />
                        <IconButton
                            icon={Plus}
                            label={lengthLabel}
                            disabled={options.length >= MAX_LENGTH}
                            {...lengthButtonProps(1)}
                        />
                    </View>

                    {options.type === "random" ? (
                        <>
                            {switchRow("includeLowercase", t`Lowercase`)}
                            {switchRow("includeUppercase", t`Uppercase`)}
                            {switchRow("includeNumbers", t`Numbers`)}
                            {switchRow("includeSymbols", t`Symbols`)}
                        </>
                    ) : (
                        <>
                            {switchRow("includeUppercase", t`Capitalize words`)}
                            {switchRow("includeNumbers", t`Append digits`)}
                            <MenuView
                                ref={separatorMenu}
                                shouldOpenOnLongPress={false}
                                isAnchoredToRight
                                themeVariant="dark"
                                actions={Object.entries(separators).map(
                                    ([id, title]) => ({
                                        id,
                                        title,
                                        state:
                                            id === options.wordSeparator
                                                ? "on"
                                                : "off",
                                    }),
                                )}
                                onPressAction={({ nativeEvent }) =>
                                    setOption(
                                        "wordSeparator",
                                        nativeEvent.event as GeneratorOptions["wordSeparator"],
                                    )
                                }
                            >
                                <View
                                    className="min-h-[44px] flex-row items-center gap-1 border-t border-border px-3"
                                    accessible
                                    accessibilityRole="button"
                                    accessibilityLabel={t`Word separator`}
                                    accessibilityValue={{
                                        text: separators[options.wordSeparator],
                                    }}
                                    // The Android menu opens only on touch, so TalkBack's double tap opens it here.
                                    accessibilityActions={
                                        Platform.OS === "android"
                                            ? [{ name: "activate" }]
                                            : undefined
                                    }
                                    onAccessibilityAction={() =>
                                        separatorMenu.current?.show()
                                    }
                                >
                                    <Text className="flex-1 text-sm text-foreground">
                                        {t`Word separator`}
                                    </Text>
                                    <Text className="text-sm text-muted-foreground">
                                        {separators[options.wordSeparator]}
                                    </Text>
                                    <ChevronsUpDown
                                        size={14}
                                        color={colors.muted}
                                    />
                                </View>
                            </MenuView>
                        </>
                    )}
                </View>
            </View>
        </Dialog>
    );
}
