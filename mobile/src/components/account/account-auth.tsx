import { View } from "react-native";

import {
    UnlockedButton as Button,
    UnlockedInput as Input,
    UnlockedLabel as Label,
    UnlockedText as Text,
} from "@/components/unlocked/unlocked-ui";
import { colors } from "@/theme";

import { isTurnstileConfigured } from "./turnstile-bridge";
import type { AuthMode } from "./types";

type AccountAuthProps = {
    authMode: AuthMode;
    recoverUserId: string;
    onRecoverUserIdChange: (value: string) => void;
    recoverPhrase: string;
    onRecoverPhraseChange: (value: string) => void;
    onRegister: () => void;
    onRecover: () => void;
    registerPending: boolean;
    recoverPending: boolean;
    busy: boolean;
};

export function AccountAuth({
    authMode,
    recoverUserId,
    onRecoverUserIdChange,
    recoverPhrase,
    onRecoverPhraseChange,
    onRegister,
    onRecover,
    registerPending,
    recoverPending,
    busy,
}: AccountAuthProps) {
    const captchaOn = isTurnstileConfigured();

    if (authMode === "register") {
        return (
            <View>
                <View className="mb-1 border-b border-border pb-[22px]">
                    <Text style={{ marginTop: 10, fontSize: 22, fontWeight: "500", letterSpacing: -0.5 }}>
                        Add Online Services
                    </Text>
                    <Text className="mt-1.5 text-[13px] leading-5 text-muted-foreground">
                        Create an account for this vault. No email address is required.
                    </Text>
                </View>
                <View
                    style={{
                        borderLeftWidth: 2,
                        borderLeftColor: colors.muted,
                        paddingLeft: 13,
                        marginVertical: 20,
                    }}
                >
                    <Text
                        style={{
                            color: colors.muted,
                            fontSize: 12,
                            lineHeight: 18,
                        }}
                    >
                        This device can administer the account. Save the account
                        Recovery Kit after creating your account.
                    </Text>
                </View>
                <Text className="text-xs text-muted-foreground">
                    {captchaOn
                        ? "Human verification opens when you create the account."
                        : "Human verification is not configured for this local service."}
                </Text>
                <Button
                    className="mt-6"
                    loading={busy || registerPending}
                    onPress={onRegister}
                    accessibilityLabel="Create Online Services account"
                >
                    Create account
                </Button>
            </View>
        );
    }

    return (
        <View>
            <View className="mb-1 border-b border-border pb-[22px]">
                <Text style={{ marginTop: 10, fontSize: 22, fontWeight: "500", letterSpacing: -0.5 }}>
                    Restore account access
                </Text>
                <Text className="mt-1.5 text-[13px] leading-5 text-muted-foreground">
                    Use the User ID and 24-word phrase from your account Recovery Kit.
                </Text>
            </View>
            <View
                style={{
                    borderLeftWidth: 2,
                    borderLeftColor: colors.muted,
                    paddingLeft: 13,
                    marginVertical: 20,
                }}
            >
                <Text
                    style={{
                        color: colors.muted,
                        fontSize: 12,
                        lineHeight: 18,
                    }}
                >
                    The account Recovery Kit restores Online Services access.
                    Your vault recovery code is used separately to recover the
                    vault.
                </Text>
            </View>
            <View style={{ marginVertical: 20 }}>
                <Label>User ID</Label>
                <Input
                    value={recoverUserId}
                    onChangeText={onRecoverUserIdChange}
                    placeholder="Your user ID"
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="off"
                    editable={!busy}
                    accessibilityLabel="Online Services user ID"
                />
            </View>
            <View style={{ marginVertical: 20 }}>
                <Label>Account recovery phrase</Label>
                <Input
                    value={recoverPhrase}
                    onChangeText={onRecoverPhraseChange}
                    placeholder="Enter all 24 words in order"
                    autoCapitalize="none"
                    autoCorrect={false}
                    spellCheck={false}
                    editable={!busy}
                    accessibilityLabel="Account recovery phrase"
                    multiline
                    numberOfLines={5}
                    textAlignVertical="top"
                    style={{
                        minHeight: 110,
                        padding: 14,
                        fontFamily: "monospace",
                        fontSize: 14,
                    }}
                />
                <Text
                    style={{
                        color: colors.muted,
                        fontSize: 12,
                        lineHeight: 18,
                        marginTop: 7,
                    }}
                >
                    Enter all 24 words in order.
                </Text>
            </View>
            <Text className="text-xs text-muted-foreground">
                {captchaOn
                    ? "Human verification opens when you recover the account."
                    : "Human verification is not configured for this local service."}
            </Text>
            <Button
                className="mt-6"
                loading={busy || recoverPending}
                onPress={onRecover}
                accessibilityLabel="Recover account"
            >
                Recover account
            </Button>
        </View>
    );
}
