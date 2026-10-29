import { useState } from "react";
import { Pressable, View } from "react-native";
import type { MessageDescriptor } from "@lingui/core";
import { msg, plural } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";

import {
    applyImportToVault,
    ImportSourceLabels,
    ImportSources,
    type ImportResult,
    type ImportSource,
} from "@cryptex-industries/vault-core/vault-utils/import-export";
import { persistVaultMutation } from "@/utils/vault-mutations";
import {
    importErrorText,
    importNoticeDetail,
    importNoticeHeading,
} from "@/components/vault-import/import-messages";
import { parseMobileImportFile } from "@/utils/mobile-import-file";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import {
    UnlockedButton,
    UnlockedCheckbox,
    UnlockedText,
} from "@/components/unlocked/unlocked-ui";
import { Checkbox } from "@/components/ui/checkbox";
import { InlineNotice } from "@/components/inline-notice";
import { cn } from "@/lib/utils";
import { colors } from "@/theme";

const sourceGuidance: Record<ImportSource, MessageDescriptor> = {
    "cryptex-json": msg`Cryptex cleartext JSON export (.json)`,
    "bitwarden-json": msg`Bitwarden JSON export (.json)`,
    "onepassword-csv": msg`1Password CSV export (.csv)`,
    "onepassword-1pux": msg`1Password 1PUX / unencrypted archive (.1pux)`,
    "keepass-xml": msg`KeePass XML export (.xml)`,
    "keepass-csv": msg`KeePass CSV export (.csv)`,
    "lastpass-csv": msg`LastPass CSV export (.csv)`,
    "chrome-csv": msg`Chrome passwords CSV (.csv)`,
    "firefox-csv": msg`Firefox passwords CSV (.csv)`,
};

type Props = {
    pickAndReadFile: () => Promise<{
        name: string;
        bytes: Uint8Array;
        mimeType?: string;
    } | null>;
    onComplete?: (message: string) => void;
    onApply?: (result: ImportResult) => Promise<string | void>;
    step?: 1 | 2 | 3;
    onStepChange?: (step: 1 | 2 | 3) => void;
    unlocked?: boolean;
};

/** React Native FileReader accepts its native Blob, but not Expo's File object. */
function bytesToTextFile(bytes: Uint8Array, type: string): File {
    const text = new TextDecoder().decode(bytes);
    return new Blob([text], { type }) as unknown as File;
}

/** 1PUX is binary; its shared parser only requires arrayBuffer(). */
function bytesToBinaryFile(bytes: Uint8Array): File {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return {
        size: copy.byteLength,
        arrayBuffer: async () => copy.buffer,
    } as unknown as File;
}

export function ImportWizard({
    pickAndReadFile,
    onComplete,
    onApply,
    step: controlledStep,
    onStepChange,
    unlocked = false,
}: Props) {
    const { t } = useLingui();
    const [internalStep, setInternalStep] = useState<1 | 2 | 3>(1);
    const step = controlledStep ?? internalStep;
    const setStep = (next: 1 | 2 | 3) => {
        setInternalStep(next);
        onStepChange?.(next);
    };
    const [source, setSource] = useState<ImportSource>("cryptex-json");
    const [fileName, setFileName] = useState("");
    const [result, setResult] = useState<ImportResult | null>(null);
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const [acceptedUnsupportedData, setAcceptedUnsupportedData] =
        useState(false);
    const WizardButton = unlocked ? UnlockedButton : Button;
    const ConfirmationCheckbox = unlocked ? UnlockedCheckbox : Checkbox;
    const Copy = unlocked ? UnlockedText : Text;
    const sourceLabel = ImportSourceLabels[source];
    const loginCount = result?.credentials.length ?? 0;
    const guidance = t(sourceGuidance[source]);
    const confirmationNotices =
        result?.notices.filter((notice) => notice.requiresConfirmation) ?? [];

    const reset = async () => {
        setStep(1);
        setFileName("");
        setResult(null);
        setError("");
        setBusy(false);
        setAcceptedUnsupportedData(false);
    };

    const handlePick = async () => {
        setBusy(true);
        setError("");
        setResult(null);
        setAcceptedUnsupportedData(false);
        try {
            const picked = await pickAndReadFile();
            if (!picked) {
                setBusy(false);
                return;
            }
            setFileName(picked.name);

            const file =
                source === "onepassword-1pux"
                    ? bytesToBinaryFile(picked.bytes)
                    : bytesToTextFile(
                          picked.bytes,
                          picked.mimeType ?? "text/plain",
                      );
            // Do not log file contents or secrets.
            const parsed = await parseMobileImportFile(source, file);
            setResult(parsed);
            setStep(3);
        } catch (parseError) {
            setError(importErrorText(parseError));
        } finally {
            setBusy(false);
        }
    };

    const handleConfirm = async () => {
        if (!result) return;
        setBusy(true);
        setError("");
        try {
            if (onApply) {
                const message = await onApply(result);
                await reset();
                onComplete?.(
                    message ??
                        plural(loginCount, {
                            one: "Ready to import # credential when the vault is created.",
                            other: "Ready to import # credentials when the vault is created.",
                        }),
                );
                return;
            }
            const mutationResult = await persistVaultMutation(
                "credentials.import",
                async (current) => {
                    const applied = await applyImportToVault(current, result);
                    return { vault: applied.vault, result: applied };
                },
            );
            if (mutationResult.isErr()) {
                const code = mutationResult.error;
                setError(t`Import failed: ${code}`);
                return;
            }
            const applied = mutationResult.value;
            const credentialCount = applied.importedCredentials;
            const directoryCount = applied.importedDirectories;
            const noticeCount = result.notices.length;
            const message = directoryCount
                ? noticeCount
                    ? t`Imported ${plural(credentialCount, { one: "# credential", other: "# credentials" })} and ${plural(directoryCount, { one: "# directory", other: "# directories" })} (${plural(noticeCount, { one: "# import notice", other: "# import notices" })})`
                    : t`Imported ${plural(credentialCount, { one: "# credential", other: "# credentials" })} and ${plural(directoryCount, { one: "# directory", other: "# directories" })}`
                : noticeCount
                  ? t`Imported ${plural(credentialCount, { one: "# credential", other: "# credentials" })} (${plural(noticeCount, { one: "# import notice", other: "# import notices" })})`
                  : plural(credentialCount, {
                        one: "Imported # credential",
                        other: "Imported # credentials",
                    });
            await reset();
            onComplete?.(message);
        } catch {
            setError(t`Import failed while applying changes.`);
        } finally {
            setBusy(false);
        }
    };

    return (
        <View className="gap-3">
            {!unlocked ? (
                <InlineNotice
                    tone="warning"
                    message={t`Export files contain readable secrets. Import on a trusted device, then delete the export file.`}
                />
            ) : null}

            {unlocked ? (
                <View className="mb-4">
                    <View className="mb-3 flex-row justify-between">
                        <Copy className="text-[10px] uppercase tracking-[1.3px] text-muted-foreground">
                            {step === 1
                                ? t({
                                      message: "Source",
                                      comment:
                                          "Import step: where the data comes from",
                                  })
                                : step === 2
                                  ? t({
                                        message: "File",
                                        comment: "Import step",
                                    })
                                  : t({
                                        message: "Review",
                                        comment: "Import step",
                                    })}
                        </Copy>
                        <Copy className="text-[10px] tracking-[1.3px] text-muted-foreground">
                            {String(step).padStart(2, "0")} / 03
                        </Copy>
                    </View>
                    <View className="flex-row gap-1.5">
                        {[1, 2, 3].map((part) => (
                            <View
                                key={part}
                                className={`h-0.5 flex-1 ${part <= step ? "bg-primary" : "bg-border"}`}
                            />
                        ))}
                    </View>
                </View>
            ) : (
                <Copy className="text-xs text-muted-foreground">
                    {step === 1
                        ? t`Step ${step} of 3. Choose source`
                        : step === 2
                          ? t`Step ${step} of 3. Select file`
                          : t`Step ${step} of 3. Confirm import`}
                </Copy>
            )}

            {step === 1 ? (
                <View className="gap-3">
                    {!unlocked ? (
                        <Copy className="font-medium text-sm text-muted-foreground">
                            {t`Import source`}
                        </Copy>
                    ) : null}
                    <View
                        className={unlocked ? "" : "flex-row flex-wrap gap-2"}
                    >
                        {ImportSources.map((s) =>
                            unlocked ? (
                                <Pressable
                                    key={s}
                                    accessibilityRole="radio"
                                    accessibilityState={{
                                        selected: source === s,
                                    }}
                                    onPress={() => setSource(s)}
                                    className="min-h-[58px] flex-row items-center gap-3 border-b border-border"
                                >
                                    <View
                                        style={{
                                            width: 18,
                                            height: 18,
                                            borderRadius: 9,
                                            borderWidth: 1,
                                            borderColor:
                                                source === s
                                                    ? colors.primary
                                                    : colors.muted,
                                            backgroundColor:
                                                source === s
                                                    ? colors.primary
                                                    : "transparent",
                                            padding: 4,
                                        }}
                                    >
                                        {source === s ? (
                                            <View className="h-full w-full rounded-full bg-foreground" />
                                        ) : null}
                                    </View>
                                    <Copy className="text-sm text-foreground">
                                        {ImportSourceLabels[s]}
                                    </Copy>
                                </Pressable>
                            ) : (
                                <WizardButton
                                    key={s}
                                    size="sm"
                                    variant={
                                        source === s ? "default" : "outline"
                                    }
                                    className={cn(
                                        source === s && "opacity-100",
                                    )}
                                    onPress={() => setSource(s)}
                                    accessibilityState={{
                                        selected: source === s,
                                    }}
                                >
                                    {ImportSourceLabels[s]}
                                </WizardButton>
                            ),
                        )}
                    </View>
                    {!unlocked ? (
                        <Copy className="text-xs text-muted-foreground">
                            {guidance}
                        </Copy>
                    ) : null}
                    <WizardButton
                        className={unlocked ? "min-h-[54px]" : "min-h-[44px]"}
                        onPress={() => setStep(2)}
                    >
                        {t`Continue`}
                    </WizardButton>
                </View>
            ) : null}

            {step === 2 ? (
                <View className="gap-3">
                    <View
                        className={
                            unlocked
                                ? "mb-[6px] border-b border-border pb-[22px]"
                                : ""
                        }
                    >
                        <Copy
                            className={
                                unlocked
                                    ? "mt-[10px] font-medium text-[22px] text-foreground"
                                    : "text-sm text-foreground"
                            }
                        >
                            {unlocked
                                ? t`Import from ${sourceLabel}`
                                : t`Selected source: ${sourceLabel}`}
                        </Copy>
                        <Copy
                            className={
                                unlocked
                                    ? "mt-[6px] text-[13px] leading-5 text-muted-foreground"
                                    : "text-xs leading-5 text-muted-foreground"
                            }
                        >
                            {t`Choose an exported file from your password manager. ${guidance}`}
                        </Copy>
                    </View>
                    <WizardButton
                        className={unlocked ? "min-h-[54px]" : "min-h-[44px]"}
                        loading={busy}
                        onPress={() => void handlePick()}
                    >
                        {t`Choose import file`}
                    </WizardButton>
                    {fileName ? (
                        <Copy className="text-xs text-muted-foreground">
                            {t`Selected: ${fileName}`}
                        </Copy>
                    ) : null}
                </View>
            ) : null}

            {step === 3 && result ? (
                <View className={unlocked ? "" : "gap-3"}>
                    {unlocked ? (
                        <>
                            <View className="mb-[6px] border-b border-border pb-[22px]">
                                <Copy className="mt-[10px] font-medium text-[22px] text-foreground">
                                    {t`Ready to import`}
                                </Copy>
                                <Copy className="mt-[6px] text-[13px] leading-5 text-muted-foreground">
                                    {t`Review what will be added before changing your vault.`}
                                </Copy>
                            </View>
                            {[
                                [
                                    t({
                                        message: "File",
                                        comment: "Import review row",
                                    }),
                                    fileName || t`Selected import file`,
                                ],
                                [
                                    t`New logins`,
                                    String(result.credentials.length),
                                ],
                                [
                                    t`New directories`,
                                    String(result.directories.length),
                                ],
                                [
                                    t`Items not added`,
                                    String(result.skippedItems),
                                ],
                            ].map(([label, value]) => (
                                <View
                                    key={label}
                                    className="flex-row items-center justify-between gap-5 border-b border-border py-4"
                                >
                                    <Copy className="text-sm text-muted-foreground">
                                        {label}
                                    </Copy>
                                    <Copy className="max-w-[65%] text-right text-[13px] text-foreground">
                                        {value}
                                    </Copy>
                                </View>
                            ))}
                        </>
                    ) : (
                        <View className="flex-row gap-3 rounded-md border border-border bg-secondary/40 p-3">
                            <View className="flex-1">
                                <Text className="text-xs text-muted-foreground">
                                    {t`Items`}
                                </Text>
                                <Text className="font-semibold text-base text-foreground">
                                    {result.credentials.length}
                                </Text>
                            </View>
                            <View className="flex-1">
                                <Text className="text-xs text-muted-foreground">
                                    {t`Directories`}
                                </Text>
                                <Text className="font-semibold text-base text-foreground">
                                    {result.directories.length}
                                </Text>
                            </View>
                            <View className="flex-1">
                                <Text className="text-xs text-muted-foreground">
                                    {t({
                                        message: "Skipped",
                                        comment:
                                            "Count of import items not added",
                                    })}
                                </Text>
                                <Text className="font-semibold text-base text-foreground">
                                    {result.skippedItems}
                                </Text>
                            </View>
                        </View>
                    )}

                    {result.notices.length > 0 ? (
                        <View className="gap-2">
                            <Copy className="font-medium text-sm text-foreground">
                                {t`Before you import`}
                            </Copy>
                            {result.notices.map((notice) => {
                                const detail = importNoticeDetail(notice);
                                const names = notice.itemNames
                                    .slice(0, 5)
                                    .join(", ");
                                const more = notice.itemNames.length - 5;
                                return (
                                    <View
                                        key={notice.code}
                                        className="gap-1 rounded-md border border-border bg-secondary/40 p-3"
                                    >
                                        <Copy className="font-medium text-sm text-foreground">
                                            {importNoticeHeading(notice)}
                                        </Copy>
                                        {detail ? (
                                            <Copy className="text-xs leading-5 text-muted-foreground">
                                                {detail}
                                            </Copy>
                                        ) : null}
                                        {notice.itemNames.length > 0 ? (
                                            <Copy className="text-xs leading-5 text-muted-foreground">
                                                {more > 0
                                                    ? t`Affected: ${names} and ${more} more`
                                                    : t`Affected: ${names}`}
                                            </Copy>
                                        ) : null}
                                    </View>
                                );
                            })}
                        </View>
                    ) : null}

                    {confirmationNotices.length > 0 ? (
                        <ConfirmationCheckbox
                            checked={acceptedUnsupportedData}
                            onCheckedChange={setAcceptedUnsupportedData}
                            label={t`I understand that the items and information listed above will be skipped or saved differently.`}
                        />
                    ) : null}

                    {unlocked ? (
                        <View className="my-5 border-l-2 border-muted pl-[13px]">
                            <Copy className="text-xs leading-[18px] text-muted-foreground">
                                {t`Existing items remain. This import cannot be undone automatically.`}
                            </Copy>
                        </View>
                    ) : (
                        <InlineNotice
                            tone="info"
                            message={
                                onApply
                                    ? t`Confirm to stage these items. Nothing is added until you create the vault.`
                                    : t`Confirm to merge these items into your vault. This cannot be undone automatically.`
                            }
                        />
                    )}

                    <WizardButton
                        className={
                            unlocked ? "mt-6 min-h-[54px]" : "min-h-[44px]"
                        }
                        loading={busy}
                        disabled={
                            (result.credentials.length === 0 &&
                                result.directories.length === 0) ||
                            (confirmationNotices.length > 0 &&
                                !acceptedUnsupportedData)
                        }
                        onPress={() => void handleConfirm()}
                    >
                        {onApply
                            ? t`Stage import`
                            : plural(loginCount, {
                                  one: "Import # login",
                                  other: "Import # logins",
                              })}
                    </WizardButton>
                    {!unlocked ? (
                        <WizardButton
                            variant="ghost"
                            disabled={busy}
                            onPress={() => void reset()}
                        >
                            {t`Cancel`}
                        </WizardButton>
                    ) : null}
                </View>
            ) : null}

            {error ? <InlineNotice tone="error" message={error} /> : null}
        </View>
    );
}
