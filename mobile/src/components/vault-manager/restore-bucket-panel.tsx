import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import {
    validateBackupDestinationInput,
    type BackupDestinationInput,
    type BackupObject,
} from "@cryptex-industries/vault-core/vault-utils/backup-destinations";
import { listBackupsInDestination } from "@cryptex-industries/vault-core/vault-utils/backup-destination-transfers";
import { getS3Object } from "@cryptex-industries/vault-core/vault-utils/s3-client";

import {
    backupDestinationFieldError,
    describeBackupDestinationError,
} from "@/app_lib/backup-destination-messages";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Text } from "@/components/ui/text";
import { InlineNotice } from "@/components/inline-notice";

const PLATFORM_LABELS: Record<BackupObject["platform"], MessageDescriptor> = {
    web: msg`Web app`,
    extension: msg`Browser extension`,
    android: msg`Android`,
};

type Fields = Omit<BackupDestinationInput, "Name" | "KeepAll">;

const inputClassName =
    "h-[54px] min-h-[54px] rounded-md border-border bg-transparent px-3.5";

export function RestoreBucketPanel({
    disabled,
    onSelect,
    onClear,
}: {
    disabled: boolean;
    /** Throws if the bytes aren't a readable backup. */
    onSelect: (bytes: Uint8Array, label: string) => void;
    /** The selected backup no longer matches the bucket details. */
    onClear: () => void;
}) {
    const { t, i18n } = useLingui();
    const [fields, setFields] = useState<Fields>({
        Endpoint: "",
        Region: "",
        Bucket: "",
        Prefix: "",
        PathStyle: false,
        AccessKeyID: "",
        SecretAccessKey: "",
    });
    const [backups, setBackups] = useState<BackupObject[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    // Only the latest request may update the restore screen, and none after
    // the panel closes: a slow download must not replace a newer selection.
    const request = useRef(0);
    useEffect(
        () => () => {
            request.current += 1;
        },
        [],
    );

    const set = <K extends keyof Fields>(key: K, value: Fields[K]) => {
        setFields((current) => ({ ...current, [key]: value }));
        request.current += 1;
        onClear();
        setLoading(false);
        setBackups([]);
        setError("");
    };

    const location = () => {
        const validation = validateBackupDestinationInput({
            ...fields,
            Name: "Restore",
            KeepAll: true,
        });
        if (!validation.ok) {
            setError(
                backupDestinationFieldError(
                    validation.field,
                    validation.message,
                ),
            );
        }
        return validation.ok ? validation.value : null;
    };

    const findBackups = async () => {
        const destination = location();
        if (!destination) return;
        const id = ++request.current;
        setLoading(true);
        try {
            const found = await listBackupsInDestination(destination);
            if (id !== request.current) return;
            setBackups(found);
            if (!found.length) {
                setError(t`No Cryptex Vault backups under this folder.`);
            }
        } catch (cause) {
            if (id !== request.current) return;
            setError(
                describeBackupDestinationError(cause) ??
                    t`Couldn't list the bucket.`,
            );
        } finally {
            if (id === request.current) setLoading(false);
        }
    };

    const choose = async (backup: BackupObject) => {
        const destination = location();
        if (!destination) return;
        const id = ++request.current;
        setLoading(true);
        try {
            const bytes = await getS3Object(
                destination,
                backup.key,
                undefined,
                backup.size,
            );
            if (id !== request.current) return;
            const createdAt = new Date(backup.createdAt).toLocaleString(
                i18n.locale,
            );
            onSelect(bytes, t`Backup from ${createdAt}`);
        } catch (cause) {
            if (id !== request.current) return;
            setError(
                describeBackupDestinationError(cause) ??
                    t`This file is not a readable Cryptex Vault backup.`,
            );
        } finally {
            if (id === request.current) setLoading(false);
        }
    };

    const input = (
        key: "Endpoint" | "Bucket" | "Region" | "Prefix" | "AccessKeyID",
        placeholder: string,
    ) => (
        <Input
            testID={`restore-bucket-${key}`}
            value={fields[key]}
            onChangeText={(value) => set(key, value)}
            placeholder={placeholder}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType={key === "Endpoint" ? "url" : "default"}
            accessibilityLabel={placeholder}
            className={inputClassName}
        />
    );

    return (
        <View className="gap-2 rounded-lg border border-border p-3">
            <Text className="text-xs text-muted-foreground">
                {t`Enter the bucket your devices back up to. Backups stay encrypted until you unlock the restored vault.`}
            </Text>
            {input("Endpoint", t`Endpoint, such as https://s3.amazonaws.com`)}
            {input("Bucket", t`Bucket`)}
            {input("Region", t`Region (us-east-1 if blank)`)}
            {input("Prefix", t`Folder (optional)`)}
            <View className="min-h-[48px] flex-row items-center justify-between gap-3">
                <Text className="flex-1 text-sm">{t`Path-style addresses`}</Text>
                <Switch
                    testID="restore-bucket-PathStyle"
                    value={fields.PathStyle}
                    onValueChange={(value) => set("PathStyle", value)}
                    accessibilityLabel={t`Path-style addresses`}
                />
            </View>
            {input("AccessKeyID", t`Access key ID`)}
            <Input
                testID="restore-bucket-SecretAccessKey"
                value={fields.SecretAccessKey}
                onChangeText={(value) => set("SecretAccessKey", value)}
                placeholder={t`Secret access key`}
                secureTextEntry
                revealButtonHeight={54}
                autoCapitalize="none"
                autoCorrect={false}
                accessibilityLabel={t`Secret access key`}
                className={inputClassName}
            />
            <Button
                testID="restore-bucket-find"
                variant="outline"
                loading={loading}
                disabled={disabled}
                onPress={() => void findBackups()}
            >
                {t`Find backups`}
            </Button>
            {error ? <InlineNotice tone="error" message={error} /> : null}
            {backups.map((backup) => (
                <Button
                    key={backup.key}
                    size="sm"
                    variant="secondary"
                    disabled={loading || disabled}
                    onPress={() => void choose(backup)}
                >
                    {`${new Date(backup.createdAt).toLocaleString(i18n.locale)} (${i18n._(PLATFORM_LABELS[backup.platform])} ${backup.deviceID.slice(-6)})`}
                </Button>
            ))}
        </View>
    );
}
