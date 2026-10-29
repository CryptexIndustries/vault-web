import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, View, type TextInput } from "react-native";
import { useFocusEffect } from "expo-router";
import { Check, CloudDownload, FileUp } from "lucide-react-native";
import * as DocumentPicker from "expo-document-picker";
import { useLingui } from "@lingui/react/macro";

import { VaultMetadata } from "@/app_lib/vault-utils/storage";
import { EncryptedBlob } from "@cryptex-industries/vault-core/vault-utils/encryption";
import { BACKUP_FILE_EXTENSION } from "@cryptex-industries/vault-core/consts";
import { uint8ToBase64Url } from "@cryptex-industries/vault-core/encoding";
import { trpcReact } from "@/utils/trpc";
import { downloadRecoveryBackupBytes } from "@/app_lib/managed-backups";
import { listAllRecoverySnapshots } from "@/app_lib/managed-recovery";
import { useTurnstileTokenRequest } from "@/components/account/turnstile-challenge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Text } from "@/components/ui/text";
import { InlineNotice } from "@/components/inline-notice";
import { AdvancedDisclosure } from "@/components/section";
import {
    VaultEntryAction,
    VaultEntryAssurance,
    VaultEntryFieldError,
    VaultEntryNotice,
    VaultEntrySteps,
} from "@/components/vault-entry-ui";
import { Icon } from "@/components/ui/icon";
import { AdditionalKeyProtectionKind } from "@cryptex-industries/vault-core/proto";
import { useScrollToNode } from "@/components/keyboard-scroll";
import { cn } from "@/lib/utils";
import { readPickedImportFile } from "@/utils/mobile-import-picker";
import {
    deleteAppOwnedTempFile,
    ensureSecretTempFilesReady,
} from "@/utils/secret-temp-files";

type RestoreTabProps = {
    onRestored?: () => void;
};

export function RestoreTab({ onRestored }: RestoreTabProps) {
    const { t, i18n } = useLingui();
    const extension = BACKUP_FILE_EXTENSION;
    const [source, setSource] = useState<"file" | "managed">("file");
    const [name, setName] = useState(() => t`Restored vault`);
    const [description, setDescription] = useState("");
    const [fileName, setFileName] = useState<string | null>(null);
    const [fileBytes, setFileBytes] = useState<Uint8Array | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [errorContext, setErrorContext] = useState<
        "file" | "managed" | "restore" | null
    >(null);
    const [fieldErrors, setFieldErrors] = useState({
        name: "",
        cloudUserId: "",
        cloudRecoveryPhrase: "",
    });
    const [success, setSuccess] = useState(false);
    const [backupGuidance, setBackupGuidance] = useState("");
    const [backupGuidanceTone, setBackupGuidanceTone] = useState<
        "info" | "warning"
    >("info");
    const [cloudUserId, setCloudUserId] = useState("");
    const [cloudRecoveryPhrase, setCloudRecoveryPhrase] = useState("");
    const [recoverySession, setRecoverySession] = useState("");
    const [snapshots, setSnapshots] = useState<
        Array<{
            id: string;
            createdAt: Date;
            byteLength: number;
            sourceLabel: string;
        }>
    >([]);
    const createRecoverySession =
        trpcReact.v1.backup.createRecoverySession.useMutation();
    const recoveryList = trpcReact.v1.backup.recoveryList.useMutation();
    const { requestToken, dialog: turnstileDialog } = useTurnstileTokenRequest({
        placement: "bottom",
    });
    const nameRef = useRef<TextInput>(null);
    const cloudUserIdRef = useRef<TextInput>(null);
    const cloudRecoveryPhraseRef = useRef<TextInput>(null);
    const fileErrorRef = useRef<View>(null);
    const managedErrorRef = useRef<View>(null);
    const restoreErrorRef = useRef<View>(null);
    const scrollToNode = useScrollToNode();

    const showError = (
        message: string,
        context: NonNullable<typeof errorContext>,
    ) => {
        setError(message);
        setErrorContext(context);
    };

    const clearError = (context?: NonNullable<typeof errorContext>) => {
        if (context && errorContext !== context) return;
        setError("");
        setErrorContext(null);
    };

    useEffect(() => {
        if (!error || !errorContext) return;
        const ref =
            errorContext === "file"
                ? fileErrorRef
                : errorContext === "managed"
                  ? managedErrorRef
                  : restoreErrorRef;
        requestAnimationFrame(() => scrollToNode(ref.current, 48));
    }, [error, errorContext, scrollToNode]);

    useFocusEffect(
        useCallback(() => {
            // The tab remains mounted after a successful restore.
            setSuccess(false);
            setError("");
            setErrorContext(null);
        }, []),
    );

    const selectBackup = (bytes: Uint8Array, selectedName: string) => {
        const blob = EncryptedBlob.fromBinary(bytes);
        // Protobuf accepts unknown fields; decoding alone does not make a backup.
        if (blob.Blob.length === 0 || !blob.HeaderIV) {
            throw new Error("The backup has no encrypted vault payload.");
        }
        setFileBytes(bytes);
        setFileName(selectedName);
        clearError("file");
        switch (blob.Envelope?.PrimaryProtectionKind) {
            case AdditionalKeyProtectionKind.WEBAUTHN_PRF:
                setBackupGuidanceTone("warning");
                setBackupGuidance(
                    t`This backup uses security-key protection that Android cannot open with a password. Restore it only if you have the vault recovery code, or link from a device where it already opens.`,
                );
                break;
            case AdditionalKeyProtectionKind.PROTECTION_PHRASE_128:
            case AdditionalKeyProtectionKind.PROTECTION_PHRASE_256:
                setBackupGuidanceTone("info");
                setBackupGuidance(
                    t`After restore, unlock with the existing master password and generated protection phrase. You can also use the vault recovery code.`,
                );
                break;
            default:
                setBackupGuidanceTone("info");
                setBackupGuidance(
                    t`After restore, unlock with the existing master password. You can also use the vault recovery code.`,
                );
        }
    };

    const startCloudRecovery = async () => {
        const next = {
            cloudUserId: cloudUserId.trim() ? "" : t`Enter your user ID.`,
            cloudRecoveryPhrase: cloudRecoveryPhrase.trim()
                ? ""
                : t`Enter your Recovery Kit phrase.`,
        };
        setFieldErrors((current) => ({ ...current, ...next }));
        if (next.cloudUserId) {
            requestAnimationFrame(() => cloudUserIdRef.current?.focus());
            return;
        }
        if (next.cloudRecoveryPhrase) {
            requestAnimationFrame(() =>
                cloudRecoveryPhraseRef.current?.focus(),
            );
            return;
        }
        setLoading(true);
        clearError("managed");
        try {
            const captchaToken = await requestToken("backup_recovery");
            if (captchaToken == null) return;
            const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
            const sessionToken = uint8ToBase64Url(tokenBytes);
            tokenBytes.fill(0);
            await createRecoverySession.mutateAsync({
                sessionToken,
                userId: cloudUserId.trim(),
                recoveryPhrase: cloudRecoveryPhrase.trim(),
                captchaToken,
            });
            setCloudRecoveryPhrase("");
            const page = await recoveryList.mutateAsync({ sessionToken });
            const remaining = page.nextCursor
                ? await listAllRecoverySnapshots(sessionToken, page.nextCursor)
                : [];
            const allSnapshots = [...page.items, ...remaining];
            setRecoverySession(sessionToken);
            setSnapshots(allSnapshots);
            if (allSnapshots.length === 0)
                showError(t`No managed backups are available.`, "managed");
        } catch {
            setCloudRecoveryPhrase("");
            showError(
                t`Could not open managed recovery. Check the Recovery Kit.`,
                "managed",
            );
        } finally {
            setLoading(false);
        }
    };

    const chooseCloudSnapshot = async (snapshotId: string) => {
        setLoading(true);
        clearError("managed");
        try {
            const result = await downloadRecoveryBackupBytes(
                recoverySession,
                snapshotId,
            );
            const createdAt = new Date(
                result.snapshot.createdAt,
            ).toLocaleString(i18n.locale);
            selectBackup(result.bytes, t`Managed backup from ${createdAt}`);
        } catch {
            showError(t`Managed backup download failed.`, "managed");
        } finally {
            setLoading(false);
        }
    };

    const pickFile = async () => {
        clearError("file");
        try {
            await ensureSecretTempFilesReady();
            const result = await DocumentPicker.getDocumentAsync({
                copyToCacheDirectory: true,
                type: "*/*",
            });
            if (result.canceled || !result.assets?.[0]) return;

            const asset = result.assets[0];
            if (
                asset.name &&
                !asset.name.toLowerCase().endsWith(`.${BACKUP_FILE_EXTENSION}`)
            ) {
                await deleteAppOwnedTempFile(asset.uri);
                showError(t`Choose a file ending in .${extension}.`, "file");
                return;
            }

            const picked = await readPickedImportFile(asset);
            selectBackup(picked.bytes, picked.name ?? "backup.cryx");
        } catch {
            setFileBytes(null);
            setFileName(null);
            setBackupGuidance("");
            showError(
                t`This file is not a readable Cryptex Vault backup.`,
                "file",
            );
        }
    };

    const handleRestore = async () => {
        clearError("restore");
        if (!name.trim()) {
            setFieldErrors((current) => ({
                ...current,
                name: t`Enter a name for the restored vault.`,
            }));
            requestAnimationFrame(() => nameRef.current?.focus());
            return;
        }
        if (!fileBytes) {
            showError(
                source === "file"
                    ? t`Choose a .${extension} backup file.`
                    : t`Find and select a managed backup.`,
                source,
            );
            return;
        }

        setLoading(true);
        try {
            const blob = EncryptedBlob.fromBinary(fileBytes);
            const metadata = new VaultMetadata();
            metadata.Name = name.trim();
            metadata.Description = description;
            metadata.Blob = blob;
            await metadata.save(null, new Uint8Array(0));
            setSuccess(true);
            onRestored?.();
        } catch {
            showError(
                t`Failed to restore vault. The backup may be corrupt.`,
                "restore",
            );
        } finally {
            setLoading(false);
        }
    };

    return (
        <View>
            <VaultEntrySteps
                labels={[
                    t({
                        message: "Select source",
                        comment: "Restore vault step",
                    }),
                    t({
                        message: "Save locally",
                        comment: "Restore vault step",
                    }),
                    t({ message: "Unlock", comment: "Restore vault step" }),
                ]}
                current={success ? 1 : 0}
            />
            <Label className="mb-2 text-xs font-normal text-muted-foreground">
                {t`Backup source`}
            </Label>
            <View className="mb-4 gap-2" accessibilityRole="radiogroup">
                {(
                    [
                        {
                            id: "file",
                            title: t`Backup file`,
                            description: t`Choose a .cryx file from your device.`,
                            icon: FileUp,
                        },
                        {
                            id: "managed",
                            title: t`Managed backup`,
                            description: t`Retrieve a backup stored with Cryptex Vault.`,
                            icon: CloudDownload,
                        },
                    ] as const
                ).map((option) => (
                    <Pressable
                        key={option.id}
                        accessibilityRole="radio"
                        accessibilityState={{
                            checked: source === option.id,
                            disabled: loading,
                        }}
                        disabled={loading}
                        onPress={() => {
                            if (source === option.id) return;
                            setSource(option.id);
                            setFileBytes(null);
                            setFileName(null);
                            setBackupGuidance("");
                            setSuccess(false);
                            clearError();
                            setFieldErrors({
                                name: "",
                                cloudUserId: "",
                                cloudRecoveryPhrase: "",
                            });
                        }}
                        className={cn(
                            "min-h-[72px] flex-row items-center gap-3 rounded-md border border-border px-3.5 py-3",
                            source === option.id &&
                                "border-primary bg-primary/10",
                        )}
                    >
                        <Icon
                            as={option.icon}
                            size={22}
                            className="text-primary"
                        />
                        <View className="flex-1 gap-1">
                            <Text className="font-semibold text-sm">
                                {option.title}
                            </Text>
                            <Text className="text-xs leading-[18px] text-muted-foreground">
                                {option.description}
                            </Text>
                        </View>
                        {source === option.id ? (
                            <Icon
                                as={Check}
                                size={18}
                                className="text-primary"
                            />
                        ) : null}
                    </Pressable>
                ))}
            </View>
            {source === "file" ? (
                <View>
                    <Button
                        variant="secondary"
                        className={cn(
                            "bg-navigation h-[161px] min-h-[161px] rounded-md border border-dashed border-muted-foreground px-4",
                            errorContext === "file" && "border-primary",
                        )}
                        disabled={loading}
                        onPress={() => void pickFile()}
                        accessibilityLabel={
                            fileName
                                ? t`Replace selected backup file ${fileName}`
                                : t`Choose .${extension} backup file`
                        }
                    >
                        <View className="items-center gap-2">
                            <Icon
                                as={FileUp}
                                size={32}
                                className="text-primary"
                            />
                            <Text className="font-semibold text-sm text-foreground">
                                {fileName || t`Choose backup file`}
                            </Text>
                            <Text className="text-xs text-muted-foreground">
                                {fileName
                                    ? t`Backup ready. Tap to replace`
                                    : t`Cryptex Vault backup (.${extension})`}
                            </Text>
                        </View>
                    </Button>
                    {error && errorContext === "file" ? (
                        <View
                            ref={fileErrorRef}
                            collapsable={false}
                            className="mt-2"
                        >
                            <InlineNotice
                                autoScroll
                                tone="error"
                                message={error}
                            />
                        </View>
                    ) : null}
                </View>
            ) : (
                <View>
                    <View className="gap-2 rounded-lg border border-border p-3">
                        <Text className="text-xs text-muted-foreground">
                            {t`Your Recovery Kit phrase retrieves managed backups. It is different from the vault recovery code used to unlock one.`}
                        </Text>
                        <Input
                            ref={cloudUserIdRef}
                            value={cloudUserId}
                            onChangeText={(value) => {
                                setCloudUserId(value);
                                setFieldErrors((current) => ({
                                    ...current,
                                    cloudUserId: "",
                                }));
                            }}
                            invalid={!!fieldErrors.cloudUserId}
                            placeholder={t`User ID`}
                            autoCapitalize="none"
                            accessibilityLabel={t`Managed backup user ID`}
                            className="h-[54px] min-h-[54px] rounded-md border-border bg-transparent px-3.5"
                        />
                        <VaultEntryFieldError
                            message={fieldErrors.cloudUserId}
                        />
                        <Input
                            ref={cloudRecoveryPhraseRef}
                            value={cloudRecoveryPhrase}
                            onChangeText={(value) => {
                                setCloudRecoveryPhrase(value);
                                setFieldErrors((current) => ({
                                    ...current,
                                    cloudRecoveryPhrase: "",
                                }));
                            }}
                            invalid={!!fieldErrors.cloudRecoveryPhrase}
                            revealButtonHeight={54}
                            placeholder={t`Recovery Kit phrase`}
                            secureTextEntry
                            autoCapitalize="none"
                            accessibilityLabel={t`Managed backup Recovery Kit phrase`}
                            className="h-[54px] min-h-[54px] rounded-md border-border bg-transparent px-3.5"
                        />
                        <VaultEntryFieldError
                            message={fieldErrors.cloudRecoveryPhrase}
                        />
                        <Button
                            variant="outline"
                            loading={loading}
                            onPress={() => void startCloudRecovery()}
                        >
                            {t`Find managed backups`}
                        </Button>
                        {error && errorContext === "managed" ? (
                            <View ref={managedErrorRef} collapsable={false}>
                                <InlineNotice
                                    autoScroll
                                    tone="error"
                                    message={error}
                                />
                            </View>
                        ) : null}
                        {snapshots.map((snapshot) => (
                            <Button
                                key={snapshot.id}
                                size="sm"
                                variant="secondary"
                                disabled={loading}
                                onPress={() =>
                                    void chooseCloudSnapshot(snapshot.id)
                                }
                            >
                                {new Date(snapshot.createdAt).toLocaleString(
                                    i18n.locale,
                                )}{" "}
                                ({snapshot.sourceLabel})
                            </Button>
                        ))}
                    </View>

                    {fileName ? (
                        <View
                            className="mt-3 rounded-md border border-primary p-3"
                            accessibilityLiveRegion="polite"
                        >
                            <Text className="font-semibold text-sm">
                                {fileName}
                            </Text>
                            <Text className="mt-1 text-xs text-muted-foreground">
                                {t`Backup ready to restore`}
                            </Text>
                        </View>
                    ) : null}
                </View>
            )}

            {backupGuidance ? (
                <InlineNotice
                    className="my-[19px]"
                    tone={backupGuidanceTone}
                    message={backupGuidance}
                />
            ) : (
                <VaultEntryNotice className="my-[19px]">
                    {t`Your backup stays encrypted. After restoring, unlock it with its existing credentials or vault recovery code.`}
                </VaultEntryNotice>
            )}

            <View className="mb-[17px]">
                <Label className="mb-[7px] text-xs font-normal text-muted-foreground">
                    {t`Vault name on this device`}
                </Label>
                <Input
                    ref={nameRef}
                    value={name}
                    onChangeText={(value) => {
                        setName(value);
                        setFieldErrors((current) => ({
                            ...current,
                            name: "",
                        }));
                    }}
                    invalid={!!fieldErrors.name}
                    accessibilityLabel={t`Restored vault name`}
                    className="h-[54px] min-h-[54px] rounded-md border-border bg-transparent px-3.5"
                />
                <VaultEntryFieldError message={fieldErrors.name} />
            </View>

            <AdvancedDisclosure
                ruled
                title={t`Add a description`}
                className="mt-[18px]"
            >
                <View className="mt-1">
                    <Label className="mb-[7px] text-xs font-normal text-muted-foreground">
                        {t`Description (optional)`}
                    </Label>
                    <Input
                        value={description}
                        onChangeText={setDescription}
                        placeholder={t`Optional`}
                        accessibilityLabel={t`Vault description, optional`}
                        className="h-[54px] min-h-[54px] rounded-md border-border bg-transparent px-3.5"
                    />
                </View>
            </AdvancedDisclosure>

            {error && errorContext === "restore" ? (
                <View
                    ref={restoreErrorRef}
                    collapsable={false}
                    className="mt-3"
                >
                    <InlineNotice autoScroll tone="error" message={error} />
                </View>
            ) : null}
            {success ? (
                <InlineNotice
                    tone="success"
                    message={t`Backup restored. Unlock it to continue.`}
                />
            ) : null}

            <VaultEntryAction
                testID="restore-vault"
                className="mt-[18px]"
                loading={loading}
                onPress={() => void handleRestore()}
                disabled={success || !fileBytes}
            >
                {t`Restore vault`}
            </VaultEntryAction>
            <VaultEntryAssurance className="mb-2">
                {t`Your backup stays encrypted until you unlock it`}
            </VaultEntryAssurance>
            {turnstileDialog}
        </View>
    );
}
