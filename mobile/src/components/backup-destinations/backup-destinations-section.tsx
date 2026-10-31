import { useState, type ComponentProps } from "react";
import { Pressable, View } from "react-native";
import type { I18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { useAtomValue } from "jotai";
import { Database } from "lucide-react-native";
import type * as VaultUtilTypes from "@cryptex-industries/vault-core/proto";
import type { BackupDestinationStatus } from "@cryptex-industries/vault-core/vault-utils/backup-destination-scheduler";
import {
    createBackupDestinationRecord,
    updateBackupDestinationRecord,
    validateBackupDestinationInput,
    visibleBackupDestinations,
    type BackupDestinationField,
    type BackupDestinationInput,
} from "@cryptex-industries/vault-core/vault-utils/backup-destinations";
import { testBackupDestination } from "@cryptex-industries/vault-core/vault-utils/backup-destination-transfers";

import {
    backupDestinationScheduler,
    backupDestinationStatusesAtom,
    saveBackupDestinations,
} from "@/app_lib/backup-destinations";
import {
    backupDestinationFieldError,
    describeBackupDestinationError,
} from "@/app_lib/backup-destination-messages";
import { AgentSectionLabel } from "@/components/agents/agent-rows";
import { InlineNotice } from "@/components/inline-notice";
import {
    Dialog,
    DialogDescription,
    DialogHeader,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { useUnlockedConfirmation } from "@/components/unlocked/confirmation-sheet";
import { useUnlockedSnackbar } from "@/components/unlocked/unlocked-snackbar";
import {
    UnlockedButton as Button,
    UnlockedDialogTitle as DialogTitle,
    UnlockedInput as Input,
    UnlockedLabel as Label,
    UnlockedSwitchRow,
    UnlockedText as Text,
} from "@/components/unlocked/unlocked-ui";
import { colors } from "@/theme";
import { unlockedVaultAtom } from "@/utils/atoms";

const emptyForm = (): BackupDestinationInput => ({
    Name: "",
    Endpoint: "",
    Region: "",
    Bucket: "",
    Prefix: "",
    PathStyle: false,
    AccessKeyID: "",
    SecretAccessKey: "",
    KeepAll: false,
});

const errorText = (i18n: I18n, error: unknown) =>
    describeBackupDestinationError(error) ?? i18n._(msg`Something went wrong.`);

function statusText(
    i18n: I18n,
    status: BackupDestinationStatus | undefined,
): string {
    if (!status) return i18n._(msg`Checking…`);
    if (status.phase === "paused") return i18n._(msg`Paused`);
    if (status.phase === "uploading") return i18n._(msg`Uploading…`);
    if (status.phase === "error" && status.lastError) {
        return status.lastError.message;
    }
    const waiting = status.phase === "scheduled";
    if (!status.lastSuccessAt) {
        return waiting
            ? i18n._(msg`No backup yet, changes waiting`)
            : i18n._(msg`No backup yet`);
    }
    const when = new Date(status.lastSuccessAt).toLocaleString(i18n.locale, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
    return waiting
        ? i18n._(msg`Last backup ${when}, changes waiting`)
        : i18n._(msg`Last backup ${when}`);
}

function DestinationRow({
    destination,
    status,
    onPress,
    onPausedChange,
}: {
    destination: VaultUtilTypes.BackupDestination;
    status: BackupDestinationStatus | undefined;
    onPress: () => void;
    onPausedChange: (paused: boolean) => void;
}) {
    const { t, i18n } = useLingui();
    const subtitle = statusText(i18n, status);
    return (
        <Pressable
            testID={`backup-destination-${destination.ID}`}
            accessibilityRole="button"
            accessibilityLabel={`${destination.Name}, ${subtitle}`}
            onPress={onPress}
            android_ripple={{ color: colors.border }}
            style={{
                minHeight: 70,
                flexDirection: "row",
                alignItems: "center",
                gap: 13,
                borderBottomWidth: 1,
                borderBottomColor: colors.border,
            }}
        >
            <Database size={22} color={colors.muted} strokeWidth={1.7} />
            <View style={{ flex: 1, minWidth: 0, paddingVertical: 12 }}>
                <Text numberOfLines={1} style={{ fontSize: 14 }}>
                    {destination.Name}
                </Text>
                <Text
                    numberOfLines={2}
                    style={{
                        color:
                            status?.phase === "error"
                                ? colors.primary
                                : colors.muted,
                        fontSize: 12,
                        lineHeight: 18,
                        marginTop: 5,
                    }}
                >
                    {subtitle}
                </Text>
            </View>
            <Switch
                value={!destination.Paused}
                onValueChange={(enabled) => onPausedChange(!enabled)}
                accessibilityLabel={t`Automatic backups to ${destination.Name}`}
            />
        </Pressable>
    );
}

export function BackupDestinationsSection() {
    const { t, i18n } = useLingui();
    const showSnackbar = useUnlockedSnackbar();
    const confirm = useUnlockedConfirmation();
    const destinations =
        useAtomValue(unlockedVaultAtom).BackupDestinations ?? [];
    const statuses = useAtomValue(backupDestinationStatusesAtom);
    const visible = visibleBackupDestinations(destinations);
    const [editing, setEditing] = useState<
        VaultUtilTypes.BackupDestination | "new" | null
    >(null);
    const [form, setForm] = useState<BackupDestinationInput>(emptyForm);
    const [fieldError, setFieldError] = useState<{
        field: BackupDestinationField;
        message: string;
    } | null>(null);
    const [testError, setTestError] = useState("");
    // Shown in the sheet: a snackbar would sit behind it.
    const [backupResult, setBackupResult] = useState<{
        tone: "success" | "error";
        message: string;
    } | null>(null);
    const [busy, setBusy] = useState<"testing" | "saving" | "backup" | null>(
        null,
    );
    const editingStatus =
        editing && editing !== "new" ? statuses[editing.ID] : undefined;

    const open = (destination: VaultUtilTypes.BackupDestination | "new") => {
        setEditing(destination);
        setForm(destination === "new" ? emptyForm() : { ...destination });
        setFieldError(null);
        setTestError("");
        setBackupResult(null);
    };

    const set = <K extends keyof BackupDestinationInput>(
        key: K,
        value: BackupDestinationInput[K],
    ) => {
        setForm((current) => ({ ...current, [key]: value }));
        setFieldError(null);
        setTestError("");
    };

    const save = async (skipTest: boolean) => {
        if (!editing) return;
        if (
            editing !== "new" &&
            destinations.some(
                (current) => current.ID === editing.ID && current.Deleted,
            )
        ) {
            setEditing(null);
            showSnackbar(t`This destination was removed on another device.`);
            return;
        }
        const validation = validateBackupDestinationInput(form);
        if (!validation.ok) {
            setFieldError(validation);
            return;
        }
        const record =
            editing === "new"
                ? createBackupDestinationRecord(validation.value)
                : updateBackupDestinationRecord(editing, validation.value);
        if (!skipTest) {
            setBusy("testing");
            try {
                await testBackupDestination(record);
            } catch (error) {
                setTestError(errorText(i18n, error));
                setBusy(null);
                return;
            }
        }
        setBusy("saving");
        try {
            await saveBackupDestinations(
                editing === "new"
                    ? { type: "add", record }
                    : { type: "edit", id: record.ID, input: validation.value },
            );
            setEditing(null);
            showSnackbar(
                editing === "new" ? t`Destination added` : t`Destination saved`,
            );
            void backupDestinationScheduler
                .backupNow(record.ID)
                .catch(() => undefined);
        } catch {
            showSnackbar(t`Couldn't save the destination.`);
        } finally {
            setBusy(null);
        }
    };

    const setPaused = (
        destination: VaultUtilTypes.BackupDestination,
        paused: boolean,
    ) =>
        void saveBackupDestinations({
            type: "pause",
            id: destination.ID,
            paused,
        }).catch(() => showSnackbar(t`Couldn't save the change.`));

    const backUpNow = async (destination: VaultUtilTypes.BackupDestination) => {
        setBusy("backup");
        setBackupResult(null);
        try {
            await backupDestinationScheduler.backupNow(destination.ID);
            setBackupResult({
                tone: "success",
                message: t`Backed up to ${destination.Name}`,
            });
        } catch (error) {
            setBackupResult({
                tone: "error",
                message: errorText(i18n, error),
            });
        } finally {
            setBusy(null);
        }
    };

    const remove = (destination: VaultUtilTypes.BackupDestination) =>
        confirm({
            title: t`Remove destination`,
            description: t`Devices stop uploading to this bucket. Backups already there stay.`,
            cancelLabel: t`Cancel`,
            confirmLabel: t`Remove`,
            destructive: true,
            onConfirm: () => {
                setEditing(null);
                void saveBackupDestinations({
                    type: "remove",
                    id: destination.ID,
                })
                    .then(() => showSnackbar(t`Destination removed`))
                    .catch(() =>
                        showSnackbar(t`Couldn't remove the destination.`),
                    );
            },
        });

    const field = (
        key: Exclude<keyof BackupDestinationInput, "PathStyle" | "KeepAll">,
        label: string,
        props: Partial<ComponentProps<typeof Input>> = {},
    ) => (
        <View className="gap-2">
            <Label>{label}</Label>
            <Input
                testID={`backup-destination-${key}`}
                value={form[key]}
                invalid={fieldError?.field === key}
                onChangeText={(value) => set(key, value)}
                autoCapitalize="none"
                autoCorrect={false}
                {...props}
            />
            {fieldError?.field === key ? (
                <InlineNotice
                    tone="error"
                    message={backupDestinationFieldError(
                        fieldError.field,
                        fieldError.message,
                    )}
                />
            ) : null}
        </View>
    );

    return (
        <View>
            <AgentSectionLabel
                title={t`Your own storage`}
                right={visible.length ? String(visible.length) : undefined}
                style={{ marginTop: 26 }}
            />
            {visible.length ? (
                visible.map((destination) => (
                    <DestinationRow
                        key={destination.ID}
                        destination={destination}
                        status={statuses[destination.ID]}
                        onPress={() => open(destination)}
                        onPausedChange={(paused) =>
                            setPaused(destination, paused)
                        }
                    />
                ))
            ) : (
                <Text
                    style={{
                        color: colors.muted,
                        fontSize: 12,
                        lineHeight: 18,
                        paddingVertical: 14,
                    }}
                >
                    {t`Upload encrypted backups after every change to S3 buckets you control, such as AWS S3, Backblaze B2, Cloudflare R2, MinIO or Garage.`}
                </Text>
            )}
            <Button
                testID="backup-destination-add"
                variant="outline"
                className="mt-5"
                onPress={() => open("new")}
            >
                {t`Add destination`}
            </Button>

            <Dialog
                open={editing !== null}
                onOpenChange={(value) => !value && !busy && setEditing(null)}
                placement="bottom"
                scroll
                dismissible={!busy}
            >
                <DialogHeader>
                    <DialogTitle>
                        {editing === "new"
                            ? t`Add destination`
                            : t`Edit destination`}
                    </DialogTitle>
                    <DialogDescription>
                        {t`An S3-compatible bucket. The keys are saved in your vault and used by each of your devices.`}
                    </DialogDescription>
                </DialogHeader>
                {editing && editing !== "new" ? (
                    <View className="gap-2">
                        <Text
                            style={{
                                color:
                                    editingStatus?.phase === "error"
                                        ? colors.primary
                                        : colors.muted,
                                fontSize: 13,
                                lineHeight: 20,
                            }}
                        >
                            {statusText(i18n, editingStatus)}
                        </Text>
                        {editingStatus?.pruneError ? (
                            <InlineNotice
                                tone="info"
                                message={t`Couldn't remove old backups: ${editingStatus.pruneError}`}
                            />
                        ) : null}
                        <Button
                            testID="backup-destination-backup-now"
                            variant="outline"
                            loading={busy === "backup"}
                            disabled={busy != null || editing.Paused}
                            onPress={() => void backUpNow(editing)}
                        >
                            {t`Back up now`}
                        </Button>
                        {backupResult ? (
                            <InlineNotice
                                tone={backupResult.tone}
                                message={backupResult.message}
                            />
                        ) : null}
                    </View>
                ) : null}
                {field("Name", t`Name`, { placeholder: t`Home NAS` })}
                {field("Endpoint", t`Endpoint`, {
                    // i18n-ignore
                    placeholder: "https://s3.eu-central-1.amazonaws.com",
                    keyboardType: "url",
                })}
                {field("Bucket", t`Bucket`)}
                {field("Region", t`Region`, { placeholder: "us-east-1" })}
                {field("Prefix", t`Folder (optional)`, {
                    placeholder: "cryptex-vault/",
                })}
                <UnlockedSwitchRow
                    testID="backup-destination-PathStyle"
                    label={t`Path-style addresses`}
                    hint={t`Needed for MinIO, Garage and most self-hosted servers.`}
                    value={form.PathStyle}
                    onValueChange={(value) => set("PathStyle", value)}
                />
                {field("AccessKeyID", t`Access key ID`)}
                {field("SecretAccessKey", t`Secret access key`, {
                    secureTextEntry: true,
                })}
                <UnlockedSwitchRow
                    testID="backup-destination-KeepAll"
                    label={t`Keep every backup`}
                    hint={t`Leaves clean-up to the bucket's own rules. The key then needs no delete permission.`}
                    value={form.KeepAll}
                    onValueChange={(value) => set("KeepAll", value)}
                />
                {form.KeepAll ? null : (
                    <Text className="text-xs leading-5 text-muted-foreground">
                        {t`Each device keeps its backups from the last day, one a day for a month and one a month for a year, and deletes the rest.`}
                    </Text>
                )}
                {testError ? (
                    <InlineNotice tone="error" message={testError} />
                ) : null}
                <Button
                    testID="backup-destination-save"
                    loading={busy === "testing" || busy === "saving"}
                    loadingLabel={
                        busy === "testing" ? t`Testing connection…` : t`Saving…`
                    }
                    disabled={busy != null}
                    onPress={() => void save(false)}
                >
                    {t`Test and save`}
                </Button>
                {testError ? (
                    <Button
                        variant="outline"
                        disabled={busy != null}
                        onPress={() => void save(true)}
                    >
                        {t`Save anyway`}
                    </Button>
                ) : null}
                {editing && editing !== "new" ? (
                    <Button
                        variant="ghost"
                        disabled={busy != null}
                        onPress={() => remove(editing)}
                    >
                        {t`Remove destination`}
                    </Button>
                ) : null}
            </Dialog>
        </View>
    );
}
