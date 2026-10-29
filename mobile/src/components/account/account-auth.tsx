import { View } from "react-native";
import { useLingui } from "@lingui/react/macro";

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
    const { t } = useLingui();
    const captchaOn = isTurnstileConfigured();

    if (authMode === "register") {
        return (
            <View>
                <View className="mb-1 border-b border-border pb-[22px]">
                    <Text
                        style={{
                            marginTop: 10,
                            fontSize: 22,
                            fontWeight: "500",
                            letterSpacing: -0.5,
                        }}
                    >
                        {t`Add Online Services`}
                    </Text>
                    <Text className="mt-1.5 text-[13px] leading-5 text-muted-foreground">
                        {t`Create an account for this vault. No email address is required.`}
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
                        {t`This device can administer the account. Save the account Recovery Kit after creating your account.`}
                    </Text>
                </View>
                <Text className="text-xs text-muted-foreground">
                    {captchaOn
                        ? t`Human verification opens when you create the account.`
                        : t`Human verification is not configured for this local service.`}
                </Text>
                <Button
                    className="mt-6"
                    loading={busy || registerPending}
                    onPress={onRegister}
                    accessibilityLabel={t`Create Online Services account`}
                >
                    {t`Create account`}
                </Button>
            </View>
        );
    }

    return (
        <View>
            <View className="mb-1 border-b border-border pb-[22px]">
                <Text
                    style={{
                        marginTop: 10,
                        fontSize: 22,
                        fontWeight: "500",
                        letterSpacing: -0.5,
                    }}
                >
                    {t`Restore account access`}
                </Text>
                <Text className="mt-1.5 text-[13px] leading-5 text-muted-foreground">
                    {t`Use the User ID and 24-word phrase from your account Recovery Kit. Recovering removes every other device from the account.`}
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
                    {t`The account Recovery Kit restores Online Services access. Your vault recovery code is used separately to recover the vault.`}
                </Text>
            </View>
            <View style={{ marginVertical: 20 }}>
                <Label>{t`User ID`}</Label>
                <Input
                    value={recoverUserId}
                    onChangeText={onRecoverUserIdChange}
                    placeholder={t`Your user ID`}
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="off"
                    editable={!busy}
                    accessibilityLabel={t`Online Services user ID`}
                />
            </View>
            <View style={{ marginVertical: 20 }}>
                <Label>{t`Account recovery phrase`}</Label>
                <Input
                    value={recoverPhrase}
                    onChangeText={onRecoverPhraseChange}
                    placeholder={t`Enter all 24 words in order`}
                    autoCapitalize="none"
                    autoCorrect={false}
                    spellCheck={false}
                    editable={!busy}
                    accessibilityLabel={t`Account recovery phrase`}
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
                    {t`Enter all 24 words in order.`}
                </Text>
            </View>
            <Text className="text-xs text-muted-foreground">
                {captchaOn
                    ? t`Human verification opens when you recover the account.`
                    : t`Human verification is not configured for this local service.`}
            </Text>
            <Button
                className="mt-6"
                loading={busy || recoverPending}
                onPress={onRecover}
                accessibilityLabel={t`Recover account`}
            >
                {t`Recover account`}
            </Button>
        </View>
    );
}
