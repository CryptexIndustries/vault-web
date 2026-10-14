import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { Copy, RefreshCw } from "lucide-react-native";

import {
    Dialog,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Text } from "@/components/ui/text";
import { SegmentedControl } from "@/components/segmented-control";
import { IconButton } from "@/components/icon-button";
import { PasswordStrengthMeter } from "@/components/vault/password-strength-meter";
import { copySecretToClipboard } from "@/utils/clipboard";
import { colors } from "@/theme";
import { generatePassword, type GeneratorOptions } from "@/utils/password-generation";

const DEFAULT_OPTIONS: GeneratorOptions = {
    type: "random",
    length: 16,
    includeUppercase: true,
    includeLowercase: true,
    includeNumbers: true,
    includeSymbols: false,
    wordSeparator: "space",
};


type PasswordGeneratorDialogProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onPasswordSelect?: (password: string) => void;
    placement?: "center" | "bottom";
};

export function PasswordGeneratorDialog({
    open,
    onOpenChange,
    onPasswordSelect,
    placement = "center",
}: PasswordGeneratorDialogProps) {
    const [options, setOptions] = useState<GeneratorOptions>(DEFAULT_OPTIONS);
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const [copied, setCopied] = useState(false);

    const regenerate = useCallback(() => {
        setError("");
        if (
            options.type === "random" &&
            !options.includeUppercase &&
            !options.includeLowercase &&
            !options.includeNumbers &&
            !options.includeSymbols
        ) {
            setError("Select at least one character type");
            setPassword("");
            return;
        }
        const length = Math.min(
            128,
            Math.max(4, Math.floor(options.length) || 4),
        );
        setPassword(generatePassword({ ...options, length }));
    }, [options]);

    useEffect(() => {
        if (open) regenerate();
    }, [open, regenerate]);

    const setOption = <K extends keyof GeneratorOptions>(
        key: K,
        value: GeneratorOptions[K],
    ) => {
        setOptions((prev) => ({ ...prev, [key]: value }));
    };

    return (
        <Dialog
            open={open}
            onOpenChange={onOpenChange}
            placement={placement}
            scroll
        >
            <DialogHeader>
                <DialogTitle>Password generator</DialogTitle>
                <DialogDescription>
                    Create a strong password or memorable passphrase.
                </DialogDescription>
            </DialogHeader>

            <View className="gap-3">
                <SegmentedControl
                    segments={[
                        { value: "random", label: "Random" },
                        { value: "memorable", label: "Memorable" },
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

                <View>
                    <Label>
                        {options.type === "memorable" ? "Word count" : "Length"}
                    </Label>
                    <Input
                        value={String(options.length)}
                        onChangeText={(text) => {
                            const n = Number(text.replace(/\D/g, ""));
                            if (!Number.isFinite(n)) return;
                            setOption("length", n);
                        }}
                        keyboardType="number-pad"
                        accessibilityLabel={
                            options.type === "memorable"
                                ? "Word count"
                                : "Password length"
                        }
                    />
                </View>

                {options.type === "random" ? (
                    <View className="gap-2">
                        {(
                            [
                                ["includeLowercase", "Lowercase"],
                                ["includeUppercase", "Uppercase"],
                                ["includeNumbers", "Numbers"],
                                ["includeSymbols", "Symbols"],
                            ] as const
                        ).map(([key, label]) => (
                            <View
                                key={key}
                                className="min-h-[44px] flex-row items-center justify-between"
                            >
                                <Text className="text-sm text-foreground">
                                    {label}
                                </Text>
                                <Switch
                                    value={options[key]}
                                    onValueChange={(v) => setOption(key, v)}
                                    accessibilityLabel={label}
                                />
                            </View>
                        ))}
                    </View>
                ) : (
                    <View className="gap-2">
                        <View className="min-h-[44px] flex-row items-center justify-between">
                            <Text className="text-sm text-foreground">
                                Capitalize words
                            </Text>
                            <Switch
                                value={options.includeUppercase}
                                onValueChange={(v) =>
                                    setOption("includeUppercase", v)
                                }
                            />
                        </View>
                        <View className="min-h-[44px] flex-row items-center justify-between">
                            <Text className="text-sm text-foreground">
                                Append digits
                            </Text>
                            <Switch
                                value={options.includeNumbers}
                                onValueChange={(v) =>
                                    setOption("includeNumbers", v)
                                }
                            />
                        </View>
                        <Text className="text-xs text-muted-foreground">
                            Word separator
                        </Text>
                        <SegmentedControl
                            segments={[
                                { value: "space", label: "Space" },
                                { value: "dash", label: "-" },
                                { value: "underscore", label: "_" },
                                { value: "none", label: "None" },
                            ]}
                            value={options.wordSeparator}
                            onChange={(wordSeparator) =>
                                setOption("wordSeparator", wordSeparator)
                            }
                        />
                    </View>
                )}

                <View className="rounded-lg border border-border bg-secondary/50 p-3">
                    <View className="flex-row items-start gap-2">
                        <Text
                            className="min-w-0 flex-1 font-mono text-sm leading-5 text-foreground"
                            selectable
                            accessibilityLabel="Generated password. Value hidden from accessibility tree until copied."
                            importantForAccessibility="no-hide-descendants"
                        >
                            {password || "No password generated"}
                        </Text>
                        <IconButton
                            icon={RefreshCw}
                            label="Regenerate password"
                            onPress={regenerate}
                        />
                        <IconButton
                            icon={Copy}
                            label="Copy generated password"
                            color={copied ? colors.primary : colors.foreground}
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
                    {password ? (
                        <PasswordStrengthMeter
                            password={password}
                            showSuggestions={false}
                        />
                    ) : null}
                </View>

                {error ? (
                    <Text className="text-sm text-destructive">{error}</Text>
                ) : null}
            </View>

            <DialogFooter>
                <Button variant="ghost" onPress={() => onOpenChange(false)}>
                    Close
                </Button>
                {onPasswordSelect ? (
                    <Button
                        disabled={!password}
                        onPress={() => {
                            onPasswordSelect(password);
                            onOpenChange(false);
                        }}
                    >
                        Use password
                    </Button>
                ) : null}
            </DialogFooter>
        </Dialog>
    );
}
