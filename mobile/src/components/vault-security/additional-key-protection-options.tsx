import { Pressable, View } from "react-native";

import { AdditionalKeyProtectionKind } from "@cryptex-industries/vault-core/proto";
import type { AdditionalKeyProtectionSource } from "@cryptex-industries/vault-core/vault-utils/additional-key-protection";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import {
    UnlockedButton,
    UnlockedText,
} from "@/components/unlocked/unlocked-ui";
import { colors } from "@/theme";

export type AdditionalKeyProtectionChoice =
    | "none"
    | "protectionPhrase128"
    | "protectionPhrase256"
    | "webauthn";

export function choiceToSource(
    choice: AdditionalKeyProtectionChoice,
): AdditionalKeyProtectionSource {
    switch (choice) {
        case "protectionPhrase128":
            return { kind: AdditionalKeyProtectionKind.PROTECTION_PHRASE_128 };
        case "protectionPhrase256":
            return { kind: AdditionalKeyProtectionKind.PROTECTION_PHRASE_256 };
        case "webauthn":
            return { kind: AdditionalKeyProtectionKind.WEBAUTHN_PRF };
        default:
            return { kind: AdditionalKeyProtectionKind.NONE };
    }
}

export function kindToChoice(
    kind: AdditionalKeyProtectionKind | undefined,
): AdditionalKeyProtectionChoice {
    switch (kind) {
        case AdditionalKeyProtectionKind.PROTECTION_PHRASE_128:
            return "protectionPhrase128";
        case AdditionalKeyProtectionKind.PROTECTION_PHRASE_256:
            return "protectionPhrase256";
        case AdditionalKeyProtectionKind.WEBAUTHN_PRF:
            return "webauthn";
        default:
            return "none";
    }
}

export function describeKind(
    kind: AdditionalKeyProtectionKind | undefined,
): string {
    switch (kind) {
        case AdditionalKeyProtectionKind.PROTECTION_PHRASE_128:
            return "Generated protection phrase (128-bit)";
        case AdditionalKeyProtectionKind.PROTECTION_PHRASE_256:
            return "Generated protection phrase (256-bit)";
        case AdditionalKeyProtectionKind.WEBAUTHN_PRF:
            return "Security key (WebAuthn PRF)";
        default:
            return "No additional key protection";
    }
}

export function isProtectionPhraseKind(
    kind: AdditionalKeyProtectionKind | undefined,
): boolean {
    return (
        kind === AdditionalKeyProtectionKind.PROTECTION_PHRASE_128 ||
        kind === AdditionalKeyProtectionKind.PROTECTION_PHRASE_256
    );
}

type Props = {
    value: AdditionalKeyProtectionChoice;
    onChange: (choice: AdditionalKeyProtectionChoice) => void;
    disabled?: boolean;
    unlocked?: boolean;
};

const OPTIONS: {
    id: AdditionalKeyProtectionChoice;
    label: string;
    enabled: boolean;
}[] = [
    {
        id: "none",
        label: "No additional key protection",
        enabled: true,
    },
    {
        id: "protectionPhrase128",
        label: "Generated protection phrase (128-bit)",
        enabled: true,
    },
    {
        id: "protectionPhrase256",
        label: "Generated protection phrase (256-bit)",
        enabled: true,
    },
];

export function AdditionalKeyProtectionOptions({
    value,
    onChange,
    disabled,
    unlocked = false,
}: Props) {
    const ChoiceButton = unlocked ? UnlockedButton : Button;
    const Copy = unlocked ? UnlockedText : Text;
    if (unlocked) {
        return (
            <View>
                {OPTIONS.map((opt) => {
                    const selected = value === opt.id;
                    const label =
                        opt.id === "none"
                            ? opt.label
                            : opt.id === "protectionPhrase128"
                              ? "Generated phrase (128-bit)"
                              : "Generated phrase (256-bit)";
                    return (
                        <Pressable
                            key={opt.id}
                            accessibilityRole="radio"
                            accessibilityState={{
                                selected,
                                disabled: disabled || !opt.enabled,
                            }}
                            disabled={disabled || !opt.enabled}
                            onPress={() => onChange(opt.id)}
                            style={{
                                minHeight: 58,
                                flexDirection: "row",
                                alignItems: "center",
                                gap: 12,
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
                                    backgroundColor: selected
                                        ? colors.primary
                                        : "transparent",
                                    padding: 4,
                                }}
                            >
                                {selected ? (
                                    <View
                                        style={{
                                            flex: 1,
                                            borderRadius: 5,
                                            backgroundColor: colors.foreground,
                                        }}
                                    />
                                ) : null}
                            </View>
                            <UnlockedText style={{ fontSize: 14 }}>
                                {label}
                            </UnlockedText>
                        </Pressable>
                    );
                })}
            </View>
        );
    }
    return (
        <View className="gap-2">
            <Copy className="font-medium text-sm text-foreground">
                Additional key protection
            </Copy>
            <View className="flex-row flex-wrap gap-2">
                {OPTIONS.map((opt) => (
                    <ChoiceButton
                        key={opt.id}
                        size="sm"
                        variant={value === opt.id ? "default" : "outline"}
                        disabled={disabled || !opt.enabled}
                        onPress={() => {
                            if (!opt.enabled) return;
                            onChange(opt.id);
                        }}
                        accessibilityState={{
                            selected: value === opt.id,
                            disabled: disabled || !opt.enabled,
                        }}
                    >
                        {opt.label}
                    </ChoiceButton>
                ))}
            </View>
            <Copy className="text-xs text-muted-foreground">
                Your master password is always required. A generated protection
                phrase adds another secret and is shown once during setup. Store
                it separately; you will need it when restoring on a new device.
            </Copy>
        </View>
    );
}
