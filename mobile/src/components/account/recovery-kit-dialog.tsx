import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";

import {
    UnlockedButton as Button,
    UnlockedCheckbox as Checkbox,
    UnlockedText as Text,
} from "@/components/unlocked/unlocked-ui";
import { InlineNotice } from "@/components/inline-notice";
import { copySecretToClipboard } from "@/utils/clipboard";
import {
    deleteAppOwnedTempFile,
    writeSecretTempFile,
} from "@/utils/secret-temp-files";

import {
    buildRecoveryKitCopyText,
    buildRecoveryKitPrintHtml,
    splitRecoveryPhrase,
} from "@ui/lib/recovery-kit-utils";
import type { RecoveryKitData } from "./types";

type RecoveryKitDialogProps = {
    open: boolean;
    kit: RecoveryKitData | null;
    onComplete: () => void;
    continueToPayment?: boolean;
};

export function RecoveryKitDialog({
    open,
    kit,
    onComplete,
    continueToPayment = false,
}: RecoveryKitDialogProps) {
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
            buildRecoveryKitCopyText(kit.userId, kit.recoveryPhrase),
        );
        if (ok) {
            markSaved();
            setStatus({ tone: "success", text: "Recovery Kit copied." });
        } else {
            setStatus({ tone: "error", text: "Could not copy Recovery Kit." });
        }
    };

    const handleShareKit = async () => {
        if (!kit) return;
        let path: string | undefined;
        try {
            const html = buildRecoveryKitPrintHtml(
                kit.userId,
                kit.recoveryPhrase,
            );
            path = await writeSecretTempFile(
                "html",
                html,
                FileSystem.EncodingType.UTF8,
            );
            if (!(await Sharing.isAvailableAsync())) {
                setStatus({
                    tone: "error",
                    text: "Sharing is not available on this device.",
                });
                return;
            }
            await Sharing.shareAsync(path, {
                mimeType: "text/html",
                dialogTitle: "Save Recovery Kit",
                UTI: "public.html",
            });
            markSaved();
            setStatus({
                tone: "success",
                text: "Share sheet opened. Save the kit offline.",
            });
        } catch {
            setStatus({ tone: "error", text: "Could not share Recovery Kit." });
        } finally {
            if (path) {
                try {
                    await deleteAppOwnedTempFile(path);
                } catch {
                    // Best-effort cleanup; never retain plaintext deliberately.
                }
            }
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
                            Save kit
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
                        Save your Recovery Kit
                    </Text>
                ) : null}
                <Text className="mt-1 text-sm leading-5 text-muted-foreground">
                    Keep both parts together in a safe place. This phrase is
                    shown only during setup.
                </Text>
            </View>

            <View className="min-h-[52px] flex-row items-center justify-between gap-4 border-b border-border">
                <Text className="text-sm text-muted-foreground">User ID</Text>
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
                {phraseRevealed ? "Hide phrase" : "Reveal recovery phrase"}
            </Button>
            <Button variant="outline" onPress={() => void handleCopyAll()}>
                Copy Recovery Kit
            </Button>
            <Button variant="outline" onPress={() => void handleShareKit()}>
                Save printable kit
            </Button>

            <View className="border-l-2 border-muted pl-3">
                <Text className="text-xs leading-5 text-muted-foreground">
                    This kit recovers your online account. Keep the vault
                    recovery code separately for recovering the encrypted vault.
                </Text>
            </View>
            {!continueToPayment ? (
                <Checkbox
                    checked={acknowledged}
                    onCheckedChange={setAcknowledged}
                    label="I saved my User ID and all 24 words."
                />
            ) : null}
            {!savedActionTaken ? (
                <Text className="text-xs text-muted-foreground">
                    Copy or save the Recovery Kit before continuing.
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
            <Button disabled={!canContinue} onPress={onComplete}>
                {continueToPayment
                    ? "I've saved my kit. Continue to payment"
                    : "Finish"}
            </Button>
        </View>
    );
}
