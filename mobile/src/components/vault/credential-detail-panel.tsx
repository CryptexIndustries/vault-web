import { View } from "react-native";
import {
    Clock,
    Copy,
    Fingerprint,
    KeyRound,
    Pencil,
    Plus,
    Trash2,
} from "lucide-react-native";

import {
    calculateTOTP,
    type Directory,
    type VaultCredential,
} from "@cryptex-industries/vault-core/vault-utils/vault";
import {
    CustomFieldType,
    ItemType,
} from "@cryptex-industries/vault-core/proto";
import { normalizeAndroidAppUri } from "@cryptex-industries/vault-core/credential-url";
import { Badge } from "@/components/ui/badge";
import {
    UnlockedButton as Button,
    UnlockedText as Text,
} from "@/components/unlocked/unlocked-ui";
import { Separator } from "@/components/ui/separator";
import { IconButton } from "@/components/icon-button";
import { EmptyState } from "@/components/empty-state";
import { CopyableField } from "@/components/vault/copyable-field";
import { TotpField } from "@/components/vault/totp-field";
import { PasswordStrengthMeter } from "@/components/vault/password-strength-meter";
import { parseTags } from "@/utils/credential-search";
import { copySecretToClipboard } from "@/utils/clipboard";
import { openCredentialUrl } from "@/utils/open-credential-url";
import { colors } from "@/theme";

const MAX_VISIBLE_TAGS = 3;

type CredentialDetailPanelProps = {
    credential: VaultCredential | null;
    directories: Directory[];
    onEdit: (credential: VaultCredential) => void;
    onDelete: (credential: VaultCredential) => void;
    /** Compact actions for embedded tablet pane. */
    embedded?: boolean;
    /** Details routes render their primary actions in the compact app bar. */
    primaryActions?: boolean;
};

function directoryLabel(directories: Directory[], directoryId: string): string {
    if (!directoryId) return "No directory";
    return (
        directories.find((d) => d.ID === directoryId && !d.Deleted)?.Name ??
        "No directory"
    );
}

function formatCustomFieldValue(type: CustomFieldType, value: string): string {
    if (type === CustomFieldType.Boolean) {
        const normalized = value.trim().toLowerCase();
        if (["1", "true", "yes", "on"].includes(normalized)) return "Yes";
        if (["0", "false", "no", "off"].includes(normalized)) return "No";
        return value;
    }
    if (type === CustomFieldType.Date) {
        const ts = Date.parse(value);
        if (!Number.isNaN(ts)) {
            return new Date(ts).toLocaleDateString(undefined, {
                year: "numeric",
                month: "short",
                day: "numeric",
            });
        }
    }
    return value;
}

export function CredentialDetailPanel({
    credential,
    directories,
    onEdit,
    onDelete,
    embedded = false,
    primaryActions = true,
}: CredentialDetailPanelProps) {
    if (!credential) {
        return (
            <View className="flex-1 items-center justify-center p-6">
                <EmptyState
                    icon={KeyRound}
                    title="Select a credential"
                    description="Choose an item from the list to view its details."
                    className="w-full max-w-sm bg-transparent"
                />
            </View>
        );
    }

    const tags = parseTags(credential.Tags);
    const visibleTags = tags.slice(0, MAX_VISIBLE_TAGS);
    const hiddenTagCount = Math.max(tags.length - MAX_VISIBLE_TAGS, 0);
    const created = new Date(credential.DateCreatedTimestamp);
    const modified = new Date(
        credential.DateModifiedTimestamp || credential.DateCreatedTimestamp,
    );
    const passkeyOnly = credential.Type === ItemType.Passkey;

    return (
        <View className={embedded ? "flex-1" : undefined}>
            <View className="mb-4 pb-2">
                <View className="mb-3 flex-row items-center gap-3.5">
                    <View className="h-12 w-12 items-center justify-center rounded-xl border border-border bg-secondary">
                        <Text className="font-semibold text-lg text-primary">
                            {(credential.Name || "?").slice(0, 2).toUpperCase()}
                        </Text>
                    </View>
                    <View className="min-w-0 flex-1">
                        <Text
                            className="font-medium text-2xl tracking-[-0.7px] text-foreground"
                            accessibilityRole="header"
                        >
                            {credential.Name || "Untitled"}
                        </Text>
                        <Text className="mt-1 text-xs text-muted-foreground">
                            {directoryLabel(
                                directories,
                                credential.DirectoryID,
                            )}
                            {" / "}
                            {passkeyOnly
                                ? "Passkey"
                                : credential.Notes && !credential.Password
                                  ? "Secure note"
                                  : "Login"}
                        </Text>
                    </View>
                </View>

                {tags.length > 0 ? (
                    <View className="mb-3 flex-row flex-wrap gap-1.5">
                        {visibleTags.map((tag) => (
                            <Badge key={tag} variant="secondary">
                                <Text className="text-[11px] text-secondary-foreground">
                                    {tag}
                                </Text>
                            </Badge>
                        ))}
                        {hiddenTagCount > 0 ? (
                            <Badge variant="secondary">
                                <Text className="text-[11px] text-secondary-foreground">
                                    +{hiddenTagCount}
                                </Text>
                            </Badge>
                        ) : null}
                    </View>
                ) : null}

                {primaryActions ? (
                    <View className="flex-row items-center gap-2">
                        <Button
                            className="min-h-[44px] flex-1 flex-row gap-2"
                            onPress={() => onEdit(credential)}
                        >
                            <Pencil size={16} color={colors.foreground} />
                            <Text className="font-medium text-sm text-primary-foreground">
                                Edit
                            </Text>
                        </Button>
                        <IconButton
                            icon={Trash2}
                            label="Delete credential"
                            variant="destructive"
                            onPress={() => onDelete(credential)}
                        />
                    </View>
                ) : null}

                {primaryActions ? (
                    <View className="mt-3 flex-row flex-wrap gap-2">
                        {credential.Username ? (
                            <Button
                                size="sm"
                                variant="secondary"
                                className="flex-row gap-2"
                                accessibilityLabel="Copy username"
                                onPress={() =>
                                    void copySecretToClipboard(
                                        credential.Username,
                                    )
                                }
                            >
                                <Copy size={14} color={colors.foreground} />
                                <Text className="font-medium text-xs text-secondary-foreground">
                                    Username
                                </Text>
                            </Button>
                        ) : null}
                        {credential.Password ? (
                            <Button
                                size="sm"
                                variant="secondary"
                                className="flex-row gap-2"
                                accessibilityLabel="Copy password"
                                onPress={() =>
                                    void copySecretToClipboard(
                                        credential.Password,
                                    )
                                }
                            >
                                <Copy size={14} color={colors.foreground} />
                                <Text className="font-medium text-xs text-secondary-foreground">
                                    Password
                                </Text>
                            </Button>
                        ) : null}
                        {credential.TOTP?.Secret ? (
                            <Button
                                size="sm"
                                variant="secondary"
                                className="flex-row gap-2"
                                accessibilityLabel="Copy authenticator code"
                                onPress={() => {
                                    try {
                                        const { code } = calculateTOTP(
                                            credential.TOTP!,
                                        );
                                        void copySecretToClipboard(code);
                                    } catch {
                                        // ignore invalid TOTP
                                    }
                                }}
                            >
                                <Copy size={14} color={colors.foreground} />
                                <Text className="font-medium text-xs text-secondary-foreground">
                                    OTP
                                </Text>
                            </Button>
                        ) : null}
                    </View>
                ) : null}
            </View>

            {!passkeyOnly ? (
                <CopyableField
                    label="Username"
                    value={credential.Username}
                    className={
                        credential.Password
                            ? "mb-0 rounded-b-none border-b-0"
                            : undefined
                    }
                />
            ) : null}
            {!passkeyOnly && credential.Password ? (
                <View className="mb-3">
                    <CopyableField
                        label="Password"
                        value={credential.Password}
                        secret
                        className={
                            credential.Username ? "mb-0 rounded-t-none" : "mb-0"
                        }
                    />
                    <PasswordStrengthMeter
                        password={credential.Password}
                        showSuggestions={false}
                    />
                </View>
            ) : null}
            {!passkeyOnly && credential.TOTP?.Secret ? (
                <TotpField credential={credential} />
            ) : null}
            {credential.URL || credential.AdditionalURLs.length ? (
                <View className="min-h-12 flex-row items-center justify-between">
                    <Text className="text-xs uppercase tracking-wider text-muted-foreground">
                        Websites
                    </Text>
                    <Text className="text-xs text-muted-foreground">
                        {Number(Boolean(credential.URL)) +
                            credential.AdditionalURLs.length}
                    </Text>
                </View>
            ) : null}
            {credential.URL ? (
                <CopyableField
                    className={
                        credential.AdditionalURLs.length
                            ? "mb-0 rounded-b-none border-b-0"
                            : undefined
                    }
                    label={
                        normalizeAndroidAppUri(credential.URL)
                            ? "Android app"
                            : "Primary website"
                    }
                    value={credential.URL}
                    onOpenUrl={
                        normalizeAndroidAppUri(credential.URL)
                            ? undefined
                            : () => openCredentialUrl(credential.URL)
                    }
                />
            ) : null}
            {credential.AdditionalURLs.map((rule, index) => (
                <CopyableField
                    key={`${rule.URL}:${index}`}
                    className={[
                        credential.URL || index > 0 ? "rounded-t-none" : "",
                        index < credential.AdditionalURLs.length - 1
                            ? "mb-0 rounded-b-none border-b-0"
                            : "",
                    ].join(" ")}
                    label={
                        normalizeAndroidAppUri(rule.URL)
                            ? "Android app"
                            : `Additional website ${index + 1}`
                    }
                    value={rule.URL}
                />
            ))}
            {credential.Passkey ? (
                <View className="mb-3 gap-3 rounded-lg border border-primary/20 bg-primary/5 p-4">
                    <View className="flex-row items-start gap-3">
                        <Fingerprint size={20} color={colors.primary} />
                        <View className="flex-1">
                            <Text className="font-medium text-foreground">
                                Passwordless sign-in
                            </Text>
                            <Text className="text-xs text-muted-foreground">
                                Offered when {credential.Passkey.RPID} requests
                                it.
                            </Text>
                        </View>
                    </View>
                    <CopyableField
                        label="Passkey account"
                        value={
                            credential.Passkey.UserDisplayName ||
                            credential.Passkey.UserName
                        }
                    />
                    <CopyableField
                        label="Relying party"
                        value={credential.Passkey.RPID}
                        onOpenUrl={() =>
                            openCredentialUrl(
                                `https://${credential.Passkey!.RPID}`,
                            )
                        }
                    />
                    <View className="flex-row items-center justify-between rounded-lg border border-border bg-secondary/50 p-3">
                        <Text className="text-sm text-muted-foreground">
                            Credential
                        </Text>
                        <Text className="font-mono text-xs text-foreground">
                            •••• {credential.Passkey.CredentialID.slice(-8)}
                        </Text>
                    </View>
                </View>
            ) : null}
            {credential.Notes ? (
                <View className="mb-3">
                    <Text className="mb-1.5 font-medium text-xs uppercase tracking-wider text-muted-foreground">
                        Notes
                    </Text>
                    <View className="rounded-lg border border-border bg-secondary/50 p-3">
                        <Text className="text-sm leading-5 text-foreground">
                            {credential.Notes}
                        </Text>
                    </View>
                </View>
            ) : null}

            {credential.CustomFields.length > 0 ? (
                <View className="mb-3">
                    <Separator className="mb-4" />
                    <View className="mb-3 flex-row items-center justify-between">
                        <Text className="font-medium text-xs uppercase tracking-wider text-muted-foreground">
                            Custom Fields
                        </Text>
                        <Badge variant="secondary">
                            <Text className="text-xs text-secondary-foreground">
                                {credential.CustomFields.length}
                            </Text>
                        </Badge>
                    </View>
                    {credential.CustomFields.map((field) => {
                        const secret =
                            field.Type === CustomFieldType.MaskedText;
                        return (
                            <CopyableField
                                key={field.ID}
                                label={field.Name || "Field"}
                                value={formatCustomFieldValue(
                                    field.Type,
                                    field.Value,
                                )}
                                secret={secret}
                            />
                        );
                    })}
                </View>
            ) : null}

            <Separator className="mb-3" />
            <View className="gap-3 pb-4">
                <View className="flex-row items-center justify-between">
                    <View className="flex-row items-center gap-2">
                        <Clock size={16} color={colors.muted} />
                        <Text className="text-sm text-muted-foreground">
                            Last modified
                        </Text>
                    </View>
                    <Text className="text-sm text-foreground">
                        {modified.toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                        })}
                    </Text>
                </View>
                <View className="flex-row items-center justify-between">
                    <View className="flex-row items-center gap-2">
                        <Plus size={16} color={colors.muted} />
                        <Text className="text-sm text-muted-foreground">
                            Created
                        </Text>
                    </View>
                    <Text className="text-sm text-foreground">
                        {created.toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                        })}
                    </Text>
                </View>
            </View>
        </View>
    );
}
