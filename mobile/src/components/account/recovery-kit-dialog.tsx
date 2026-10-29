import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import { useLingui } from "@lingui/react/macro";

import {
    UnlockedButton as Button,
    UnlockedCheckbox as Checkbox,
    UnlockedText as Text,
} from "@/components/unlocked/unlocked-ui";
import { InlineNotice } from "@/components/inline-notice";
import { copySecretToClipboard } from "@/utils/clipboard";
import { useSecretRelease } from "@/utils/secret-release";
import { shareSecretFile } from "@/utils/secret-share";
import { writeSecretTempFile } from "@/utils/secret-temp-files";

import {
    buildRecoveryKitPrintHtml,
    splitRecoveryPhrase,
} from "@ui/lib/recovery-kit-utils";
import { recoveryKitCopyText, recoveryKitPrintText } from "./recovery-kit-text";
import type { RecoveryKitData } from "./types";

type RecoveryKitDialogProps = {
    open: boolean;
    kit: RecoveryKitData | null;
    onComplete: () => void;
    continueToPayment?: boolean;
    completionDisabled?: boolean;
};

export function RecoveryKitDialog({
    open,
    kit,
    onComplete,
    continueToPayment = false,
    completionDisabled = false,
}: RecoveryKitDialogProps) {
    const { t } = useLingui();
    const [acknowledged, setAcknowledged] = useState(false);
    const [savedActionTaken, setSavedActionTaken] = useState(false);
    const [phraseRevealed, setPhraseRevealed] = useState(true);
    const [status, setStatus] = useState<{
        tone: "success" | "error";
        text: string;
    } | null>(null);

    const resetState = useCallback(() => {
        setAcknowledged(false);
        setSavedActionTaken(false);
        setPhraseRevealed(true);
        setStatus(null);
    }, []);

    useEffect(() => {
        if (!open) resetState();
    }, [open, resetState]);

    const markSaved = () => setSavedActionTaken(true);

    const handleCopyAll = async () => {
        if (!kit) return;
        const ok = await copySecretToClipboard(
            recoveryKitCopyText(kit.userId, kit.recoveryPhrase),
        );
        if (ok) {
            markSaved();
            setStatus({ tone: "success", text: t`Recovery Kit copied.` });
        } else {
            setStatus({ tone: "error", text: t`Could not copy Recovery Kit.` });
        }
    };

    // The kit on its way to the share sheet; a lock or leaving stops it.
    const startShareRelease = useSecretRelease();

    const handleShareKit = async () => {
        if (!kit) return;
        const release = startShareRelease();
        try {
            const shared = await shareSecretFile(
                () =>
                    writeSecretTempFile(
                        "html",
                        buildRecoveryKitPrintHtml(
                            kit.userId,
                            kit.recoveryPhrase,
                            recoveryKitPrintText(),
                        ),
                        FileSystem.EncodingType.UTF8,
                    ),
                {
                    isCurrent: release.current,
                    mimeType: "text/html",
                    dialogTitle: t`Save Recovery Kit`,
                    UTI: "public.html",
                },
            );
            if (shared === "cancelled") return;
            if (shared === "unavailable") {
                setStatus({
                    tone: "error",
                    text: t`Sharing is not available on this device.`,
                });
                return;
            }
            markSaved();
            setStatus({
                tone: "success",
                text: t`Share sheet opened. Save the kit offline.`,
            });
        } catch {
            if (release.current())
                setStatus({
                    tone: "error",
                    text: t`Could not share Recovery Kit.`,
                });
        }
    };

    const words = kit ? splitRecoveryPhrase(kit.recoveryPhrase) : [];
    const canContinue = savedActionTaken && (continueToPayment || acknowledged);

    if (!open || !kit) return null;

    return (
        <View className="gap-4">
            {!continueToPayment ? (
                <View className="mb-2">
                    <View className="mb-3 flex-row justify-between">
                        <Text className="text-[10px] uppercase tracking-[1.3px] text-muted-foreground">
                            {t({
                                message: "Save kit",
                                comment: "Step label above the Recovery Kit",
                            })}
                        </Text>
                        <Text className="text-[10px] tracking-[1.3px] text-muted-foreground">
                            02 / 02
                        </Text>
                    </View>
                    <View className="flex-row gap-1.5">
                        <View className="h-0.5 flex-1 bg-primary" />
                        <View className="h-0.5 flex-1 bg-primary" />
                    </View>
                </View>
            ) : null}

            <View className="border-b border-border pb-5">
                {!continueToPayment ? (
                    <Text className="font-medium text-xl text-foreground">
                        {t`Save your Recovery Kit`}
                    </Text>
                ) : null}
                <Text className="mt-1 text-sm leading-5 text-muted-foreground">
                    {t`Keep both parts together in a safe place. This phrase is shown only during setup.`}
                </Text>
            </View>

            <View className="min-h-[52px] flex-row items-center justify-between gap-4 border-b border-border">
                <Text className="text-sm text-muted-foreground">
                    {t`User ID`}
                </Text>
                <Text
                    selectable
                    className="flex-1 text-right font-mono text-xs text-foreground"
                >
                    {kit.userId}
                </Text>
            </View>

            {phraseRevealed ? (
                <View className="flex-row flex-wrap gap-2 rounded-md border border-border bg-[#111520] p-4">
                    {words.map((word, index) => (
                        <View
                            key={`${index}-${word}`}
                            className="w-[22%] flex-row gap-1"
                        >
                            <Text className="font-mono text-[10px] text-muted-foreground">
                                {String(index + 1).padStart(2, "0")}
                            </Text>
                            <Text className="min-w-0 flex-1 font-mono text-xs text-foreground">
                                {word}
                            </Text>
                        </View>
                    ))}
                </View>
            ) : (
                <Text
                    importantForAccessibility="no"
                    accessibilityElementsHidden
                    className="rounded-md border border-border bg-[#111520] p-5 text-center font-mono text-sm leading-7 text-muted-foreground"
                >
                    •••• •••• •••• ••••{"\n"}•••• •••• •••• ••••{"\n"}•••• ••••
                    •••• ••••
                </Text>
            )}

            <Button
                variant="outline"
                onPress={() => setPhraseRevealed((value) => !value)}
            >
                {phraseRevealed ? t`Hide phrase` : t`Reveal recovery phrase`}
            </Button>
            <Button variant="outline" onPress={() => void handleCopyAll()}>
                {t`Copy Recovery Kit`}
            </Button>
            <Button variant="outline" onPress={() => void handleShareKit()}>
                {t`Save printable kit`}
            </Button>

            <View className="border-l-2 border-muted pl-3">
                <Text className="text-xs leading-5 text-muted-foreground">
                    {t`This kit recovers your online account. Keep the vault recovery code separately for recovering the encrypted vault.`}
                </Text>
            </View>
            {!continueToPayment ? (
                <Checkbox
                    checked={acknowledged}
                    onCheckedChange={setAcknowledged}
                    label={t`I saved my User ID and all 24 words.`}
                />
            ) : null}
            {!savedActionTaken ? (
                <Text className="text-xs text-muted-foreground">
                    {t`Copy or save the Recovery Kit before continuing.`}
                </Text>
            ) : null}
            {status?.tone === "error" ? (
                <InlineNotice tone="error" message={status.text} />
            ) : status ? (
                <Text
                    accessibilityLiveRegion="polite"
                    className="text-xs text-muted-foreground"
                >
                    {status.text}
                </Text>
            ) : null}
            <Button
                disabled={!canContinue || completionDisabled}
                onPress={onComplete}
            >
                {continueToPayment
                    ? t`I've saved my kit. Continue to payment`
                    : t({
                          message: "Finish",
                          comment: "Button: done saving the Recovery Kit",
                      })}
            </Button>
        </View>
    );
}
