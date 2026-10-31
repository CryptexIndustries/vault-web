import { useEffect, useState } from "react";
import { View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { Archive, Download, FileJson } from "lucide-react-native";
import { useAtomValue } from "jotai";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";

import { vaultToJSONString } from "@cryptex-industries/vault-core/vault-utils/import-export";
import { AdditionalKeyProtectionKind } from "@cryptex-industries/vault-core/proto";
import {
    EncryptionAlgorithm,
    KeyDerivationFunction,
} from "@cryptex-industries/vault-core/proto";
import {
    KeyDerivationConfig_Argon2ID,
    KeyDerivationConfig_PBKDF2,
} from "@cryptex-industries/vault-core/vault-utils/encryption";
import { serializeVault } from "@/app_lib/vault-utils/storage";
import { unlockedVaultAtom, unlockedVaultMetadataAtom } from "@/utils/atoms";
import { getVaultDEKFromSession } from "@/utils/vault-session";
import { useSecretRelease } from "@/utils/secret-release";
import { shareSecretFile } from "@/utils/secret-share";
import { BACKUP_FILE_EXTENSION } from "@cryptex-industries/vault-core/consts";
import {
    UnlockedDialogTitle as DialogTitle,
    UnlockedMenuRow,
    UnlockedButton as Button,
    UnlockedCheckbox as Checkbox,
    UnlockedInput as Input,
    UnlockedLabel as Label,
    UnlockedTaskScreen,
    UnlockedText,
} from "@/components/unlocked/unlocked-ui";
import { Dialog, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { InlineNotice } from "@/components/inline-notice";
import { ImportWizard } from "@/components/vault-import/import-wizard";
import { isProtectionPhraseKind } from "@/components/vault-security/additional-key-protection-options";
import { uint8ToBase64 } from "@cryptex-industries/vault-core/encoding";
import { readPickedImportFile } from "@/utils/mobile-import-picker";
import {
    ensureSecretTempFilesReady,
    writeSecretTempFile,
} from "@/utils/secret-temp-files";

const SESSION_ENDED = msg`Vault session expired. Unlock and try again.`;

export function ImportExportScreen({
    view = "root",
}: {
    view?: "root" | "import" | "plain";
}) {
    const { t } = useLingui();
    const params = useLocalSearchParams<{ pane?: string }>();
    const [pane, setPane] = useState<"root" | "import" | "encrypted" | "plain">(
        params.pane === "encrypted" ? "encrypted" : view,
    );
    useEffect(() => {
        if (params.pane === "encrypted") setPane("encrypted");
    }, [params.pane]);
    const [importStep, setImportStep] = useState<1 | 2 | 3>(1);
    const vault = useAtomValue(unlockedVaultAtom);
    const metadata = useAtomValue(unlockedVaultMetadataAtom);
    const [status, setStatus] = useState("");
    const [busy, setBusy] = useState(false);
    const [cleartextOpen, setCleartextOpen] = useState(false);
    const [masterPassword, setMasterPassword] = useState("");
    const [additionalKeyProtection, setAdditionalKeyProtection] = useState("");
    const [cleartextWarned, setCleartextWarned] = useState(false);
    const [cleartextError, setCleartextError] = useState("");

    const factorKind = metadata?.Blob?.Envelope?.PrimaryProtectionKind;

    const pickAndReadFile = async () => {
        await ensureSecretTempFilesReady();
        const picked = await DocumentPicker.getDocumentAsync({
            copyToCacheDirectory: true,
            type: "*/*",
        });
        if (picked.canceled || !picked.assets?.[0]) return null;
        return readPickedImportFile(picked.assets[0]);
    };

    // An export on its way to the share sheet; a lock, leaving this screen or
    // starting another export stops it.
    const startExport = useSecretRelease();

    const handleEncryptedExport = async () => {
        const release = startExport();
        setBusy(true);
        setStatus("");
        try {
            if (!metadata?.Blob) {
                setStatus(t`Vault metadata missing.`);
                return;
            }
            const dekRes = getVaultDEKFromSession();
            if (dekRes.isErr()) {
                setStatus(t`Session key missing. Unlock again.`);
                return;
            }
            const raw = await serializeVault(
                vault,
                metadata.Blob,
                dekRes.value,
            );
            if (!release.current()) {
                setStatus(t(SESSION_ENDED));
                return;
            }
            const shared = await shareSecretFile(
                () =>
                    writeSecretTempFile(
                        BACKUP_FILE_EXTENSION,
                        uint8ToBase64(raw),
                        FileSystem.EncodingType.Base64,
                    ),
                {
                    isCurrent: release.current,
                    mimeType: "application/octet-stream",
                    dialogTitle: t`Export encrypted vault backup`,
                },
            );
            setStatus(
                shared === "shared"
                    ? t`Encrypted export ready.`
                    : shared === "unavailable"
                      ? t`Sharing is unavailable on this device.`
                      : t(SESSION_ENDED),
            );
        } catch (e) {
            setStatus(e instanceof Error ? e.message : t`Export failed.`);
        } finally {
            setBusy(false);
        }
    };

    const resetCleartextForm = () => {
        setMasterPassword("");
        setAdditionalKeyProtection("");
        setCleartextWarned(false);
        setCleartextError("");
    };

    const handleCleartextExport = async () => {
        if (!metadata?.Blob) {
            setCleartextError(t`Vault metadata missing.`);
            return;
        }
        if (!masterPassword.trim()) {
            setCleartextError(t`Enter your master password.`);
            return;
        }
        if (!cleartextWarned) {
            setCleartextError(t`Acknowledge the warning before exporting.`);
            return;
        }
        if (factorKind === AdditionalKeyProtectionKind.WEBAUTHN_PRF) {
            setCleartextError(
                t`This vault uses WebAuthn PRF. Export cleartext from desktop.`,
            );
            return;
        }

        const release = startExport();
        setBusy(true);
        setCleartextError("");
        try {
            // Reauthenticate with the master password and protection phrase. Do not log secrets.
            const verify = await metadata.decryptVault(
                masterPassword,
                metadata.Blob.Algorithm ??
                    EncryptionAlgorithm.XChaCha20Poly1305,
                metadata.Blob.KeyDerivationFunc ??
                    KeyDerivationFunction.Argon2ID,
                {
                    iterations:
                        metadata.Blob.KDFConfigPBKDF2?.iterations ??
                        KeyDerivationConfig_PBKDF2.DEFAULT_ITERATIONS,
                    memLimit:
                        metadata.Blob.KDFConfigArgon2ID?.memLimit ??
                        KeyDerivationConfig_Argon2ID.DEFAULT_MEM_LIMIT,
                    opsLimit:
                        metadata.Blob.KDFConfigArgon2ID?.opsLimit ??
                        KeyDerivationConfig_Argon2ID.DEFAULT_OPS_LIMIT,
                },
                {
                    masterPassword,
                    protectionPhrase:
                        additionalKeyProtection.trim() || undefined,
                },
            );
            if (verify.isErr()) {
                setCleartextError(
                    t`Incorrect master password or protection phrase.`,
                );
                return;
            }

            if (!release.current()) {
                setCleartextError(t(SESSION_ENDED));
                return;
            }

            const shared = await shareSecretFile(
                () =>
                    writeSecretTempFile(
                        "json",
                        vaultToJSONString(vault),
                        FileSystem.EncodingType.UTF8,
                    ),
                {
                    isCurrent: release.current,
                    mimeType: "application/json",
                    dialogTitle: t`Export cleartext vault JSON`,
                },
            );
            if (shared === "cancelled") {
                setCleartextError(t(SESSION_ENDED));
                return;
            }
            setStatus(
                shared === "shared"
                    ? t`Cleartext export ready. Delete it after use.`
                    : t`Sharing is unavailable on this device.`,
            );
            setCleartextOpen(false);
            resetCleartextForm();
        } catch {
            setCleartextError(t`Cleartext export failed.`);
        } finally {
            setBusy(false);
        }
    };

    if (pane === "root" || pane === "encrypted") {
        return (
            <UnlockedTaskScreen title={t`Import / Export`}>
                <Dialog
                    open={pane === "encrypted"}
                    onOpenChange={(open) => {
                        if (open) return;
                        setPane("root");
                        if (params.pane === "encrypted") {
                            router.setParams({ pane: undefined });
                            router.back();
                        }
                    }}
                    placement="bottom"
                    scroll
                    dismissible={!busy}
                >
                    <DialogHeader>
                        <DialogTitle>{t`Encrypted export`}</DialogTitle>
                    </DialogHeader>
                    <View>
                        <View className="mb-[6px] border-b border-border pb-[22px]">
                            <UnlockedText className="mt-[10px] font-medium text-[22px] text-foreground">
                                {t`Save an encrypted copy`}
                            </UnlockedText>
                            <UnlockedText className="mt-[6px] text-[13px] leading-5 text-muted-foreground">
                                {t`The export uses this vault’s current password and protection settings.`}
                            </UnlockedText>
                        </View>
                        <View className="flex-row items-center justify-between gap-5 border-b border-border py-4">
                            <UnlockedText className="text-[13px] leading-[19px] text-muted-foreground">
                                {t({
                                    message: "Format",
                                    comment:
                                        "Label for the export file format row",
                                })}
                            </UnlockedText>
                            <UnlockedText className="text-[13px] leading-[19px] text-foreground">
                                {/* i18n-ignore: file format name */}
                                Cryptex Vault (.cryx)
                            </UnlockedText>
                        </View>
                        <View className="flex-row items-center justify-between gap-5 border-b border-border py-4">
                            <UnlockedText className="text-[13px] leading-[19px] text-muted-foreground">
                                {t({
                                    message: "Contents",
                                    comment:
                                        "Label for what the export file contains",
                                })}
                            </UnlockedText>
                            <UnlockedText className="text-[13px] leading-[19px] text-foreground">
                                {t`Vault data and settings`}
                            </UnlockedText>
                        </View>
                        <View className="my-5 border-l-2 border-muted pl-[13px]">
                            <UnlockedText className="text-xs leading-5 text-muted-foreground">
                                {t`Keep your master password and any protection phrase available when restoring this file.`}
                            </UnlockedText>
                        </View>
                        <Button
                            className="mt-6"
                            loading={busy}
                            onPress={() => void handleEncryptedExport()}
                        >
                            {t`Export encrypted vault`}
                        </Button>
                    </View>
                    {status ? (
                        <InlineNotice tone="info" message={status} />
                    ) : null}
                </Dialog>
                <View className="mb-[6px] border-b border-border pb-[22px]">
                    <UnlockedText className="mb-[6px] mt-[10px] font-medium text-[22px]">
                        {t`Move your vault data`}
                    </UnlockedText>
                    <UnlockedText className="text-[13px] leading-5 text-muted-foreground">
                        {t`Bring logins in, or save a copy to use elsewhere.`}
                    </UnlockedText>
                </View>
                <UnlockedText className="mb-[6px] mt-[26px] text-[11px] uppercase tracking-[1px] text-muted-foreground">
                    {t({ message: "Import", comment: "Section heading" })}
                </UnlockedText>
                <UnlockedMenuRow
                    icon={Download}
                    title={t`Import passwords`}
                    subtitle={t`From another password manager or vault`}
                    onPress={() =>
                        router.push("/(app)/settings/import-export/import")
                    }
                />
                <UnlockedText className="mb-[6px] mt-[26px] text-[11px] uppercase tracking-[1px] text-muted-foreground">
                    {t({ message: "Export", comment: "Section heading" })}
                </UnlockedText>
                <UnlockedMenuRow
                    icon={Archive}
                    title={t`Encrypted vault`}
                    subtitle={t`Save a password-protected .cryx file`}
                    onPress={() => {
                        setStatus("");
                        setPane("encrypted");
                    }}
                />
                <UnlockedMenuRow
                    icon={FileJson}
                    title={t`Unencrypted export`}
                    subtitle={t`Readable JSON for migration`}
                    onPress={() =>
                        router.push("/(app)/settings/import-export/plain")
                    }
                />
                <View className="my-5 border-l-2 border-muted pl-[13px]">
                    <UnlockedText className="text-xs leading-[18px] text-muted-foreground">
                        {t`Encrypted vault exports are the recommended option for backups.`}
                    </UnlockedText>
                </View>
            </UnlockedTaskScreen>
        );
    }

    return (
        <UnlockedTaskScreen
            title={
                pane === "import"
                    ? importStep === 1
                        ? t`Import passwords`
                        : importStep === 2
                          ? t`Choose import file`
                          : t`Review import`
                    : t`Unencrypted export`
            }
            onBack={() => {
                if (pane === "import" && importStep > 1) {
                    setImportStep((importStep - 1) as 1 | 2);
                } else {
                    router.back();
                }
            }}
        >
            {pane === "import" ? (
                <ImportWizard
                    unlocked
                    pickAndReadFile={pickAndReadFile}
                    onComplete={(message) => setStatus(message)}
                    step={importStep}
                    onStepChange={setImportStep}
                />
            ) : null}

            {pane === "plain" ? (
                <View className="gap-4">
                    <View className="mb-[6px] border-b border-border pb-[22px]">
                        <UnlockedText className="mt-[10px] font-medium text-[22px] text-foreground">
                            {t`Export readable data`}
                        </UnlockedText>
                        <UnlockedText className="mt-[6px] text-[13px] leading-5 text-muted-foreground">
                            {t`Anyone with this file can read its contents.`}
                        </UnlockedText>
                    </View>
                    <View className="min-h-[52px] flex-row items-center justify-between border-b border-border">
                        <UnlockedText className="text-sm text-muted-foreground">
                            {t({
                                message: "Format",
                                comment: "Label for the export file format row",
                            })}
                        </UnlockedText>
                        <UnlockedText className="text-sm text-foreground">
                            {/* i18n-ignore: file format name */}
                            Cryptex Vault JSON
                        </UnlockedText>
                    </View>
                    <View>
                        <Label>{t`Master password`}</Label>
                        <Input
                            value={masterPassword}
                            onChangeText={(value) => {
                                setMasterPassword(value);
                                setCleartextError("");
                            }}
                            secureTextEntry
                            autoCapitalize="none"
                            autoCorrect={false}
                            textContentType="password"
                            accessibilityLabel={t`Master password for cleartext export`}
                        />
                    </View>
                    {isProtectionPhraseKind(factorKind) ? (
                        <View>
                            <Label>{t`Protection phrase`}</Label>
                            <Input
                                value={additionalKeyProtection}
                                onChangeText={(value) => {
                                    setAdditionalKeyProtection(value);
                                    setCleartextError("");
                                }}
                                secureTextEntry
                                autoCapitalize="none"
                                autoCorrect={false}
                                accessibilityLabel={t`Protection phrase`}
                            />
                        </View>
                    ) : null}
                    <Checkbox
                        checked={cleartextWarned}
                        onCheckedChange={(checked) => {
                            setCleartextWarned(checked);
                            setCleartextError("");
                        }}
                        label={t`I understand this file is unencrypted and will delete it after use.`}
                    />
                    {cleartextError ? (
                        <InlineNotice tone="error" message={cleartextError} />
                    ) : null}
                    <Button
                        disabled={busy}
                        onPress={() => {
                            if (!masterPassword.trim()) {
                                setCleartextError(
                                    t`Enter your master password.`,
                                );
                            } else if (!cleartextWarned) {
                                setCleartextError(
                                    t`Acknowledge the warning before exporting.`,
                                );
                            } else {
                                setCleartextOpen(true);
                            }
                        }}
                    >
                        {t`Review export`}
                    </Button>
                </View>
            ) : null}

            {status ? <InlineNotice tone="success" message={status} /> : null}

            <Dialog
                open={cleartextOpen}
                onOpenChange={(open) => {
                    setCleartextOpen(open);
                    if (!open) resetCleartextForm();
                }}
                scroll
                placement="bottom"
            >
                <DialogHeader>
                    <DialogTitle>{t`Export cleartext JSON`}</DialogTitle>
                    <UnlockedText className="text-[13px] leading-5 text-muted-foreground">
                        {t`Confirm that you want to create an unencrypted migration file.`}
                    </UnlockedText>
                </DialogHeader>

                <InlineNotice
                    tone="warning"
                    message={t`Anyone with this file can read all vault secrets. Prefer encrypted .cryx backups.`}
                />

                <DialogFooter>
                    <Button
                        variant="ghost"
                        disabled={busy}
                        onPress={() => setCleartextOpen(false)}
                    >
                        {t`Cancel`}
                    </Button>
                    <Button
                        variant="destructive"
                        loading={busy}
                        onPress={() => void handleCleartextExport()}
                    >
                        {t`Export JSON`}
                    </Button>
                </DialogFooter>
            </Dialog>
        </UnlockedTaskScreen>
    );
}

export default function ImportExportRoute() {
    return <ImportExportScreen />;
}
