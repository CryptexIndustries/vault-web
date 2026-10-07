import { useEffect, useState } from "react";
import { View } from "react-native";
import { Copy } from "lucide-react-native";

import {
    calculateTOTP,
    type VaultCredential,
} from "@cryptex-industries/vault-core/vault-utils/vault";
import { IconButton } from "@/components/icon-button";
import { UnlockedText as Text } from "@/components/unlocked/unlocked-ui";
import { copySecretToClipboard } from "@/utils/clipboard";
import { colors } from "@/theme";

type TotpFieldProps = {
    credential: Pick<VaultCredential, "TOTP">;
    embedded?: boolean;
};

export function TotpField({ credential, embedded = false }: TotpFieldProps) {
    const [timeLeft, setTimeLeft] = useState(30);
    const [period, setPeriod] = useState(30);
    const [totpCode, setTotpCode] = useState("------");
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        const update = () => {
            if (!credential.TOTP?.Secret) {
                setTotpCode("------");
                return;
            }
            try {
                const { code, timeRemaining } = calculateTOTP(credential.TOTP);
                setTotpCode(code);
                setTimeLeft(timeRemaining);
                setPeriod(credential.TOTP.Period || 30);
            } catch {
                setTotpCode("------");
            }
        };

        update();
        const interval = setInterval(update, 1000);
        return () => clearInterval(interval);
    }, [credential.TOTP]);

    const handleCopy = async () => {
        if (totpCode === "------") return;
        const ok = await copySecretToClipboard(totpCode);
        if (!ok) return;
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    };

    const urgent = timeLeft <= 10;
    const progress = period > 0 ? timeLeft / period : 0;

    const formatted =
        totpCode.length >= 6
            ? `${totpCode.slice(0, Math.ceil(totpCode.length / 2))} ${totpCode.slice(Math.ceil(totpCode.length / 2))}`
            : totpCode;

    return (
        <View
            style={{
                marginBottom: 12,
                minHeight: embedded ? 74 : 112,
                flexDirection: "row",
                alignItems: "center",
                padding: embedded ? 0 : 16,
                borderWidth: embedded ? 0 : 1,
                borderColor: colors.border,
                borderRadius: 8,
                backgroundColor: colors.secondary,
            }}
        >
            <View style={{ flex: 1, minWidth: 0 }}>
                {!embedded ? (
                    <Text
                        style={{
                            color: colors.muted,
                            fontSize: 12,
                            marginBottom: 10,
                        }}
                    >
                        Verification code
                    </Text>
                ) : null}
                <Text
                    className="font-mono"
                    style={{
                        fontSize: 22,
                        letterSpacing: 2,
                        color: colors.foreground,
                    }}
                    importantForAccessibility="no-hide-descendants"
                >
                    {formatted}
                </Text>
                <Text
                    style={{ fontSize: 11, marginTop: 6, color: colors.muted }}
                    accessibilityLabel={`${timeLeft} seconds remaining`}
                >
                    {timeLeft}s remaining
                </Text>
                <View
                    style={{
                        height: 3,
                        marginTop: 10,
                        borderRadius: 2,
                        backgroundColor: colors.border,
                        overflow: "hidden",
                    }}
                >
                    <View
                        style={{
                            height: 3,
                            width: `${Math.max(0, Math.min(1, progress)) * 100}%`,
                            backgroundColor: urgent
                                ? colors.destructive
                                : colors.primary,
                        }}
                    />
                </View>
            </View>
            <IconButton
                icon={Copy}
                label="Copy verification code"
                color={copied ? colors.primary : colors.muted}
                onPress={() => void handleCopy()}
            />
        </View>
    );
}
