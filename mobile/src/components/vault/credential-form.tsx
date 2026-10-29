import { useUnlockedConfirmation } from "@/components/unlocked/confirmation-sheet";
import {
    UnlockedDialogTitle as DialogTitle,
    UnlockedTaskScreen,
    UnlockedText as Text,
    UnlockedButton as Button,
    UnlockedInput as Input,
    UnlockedLabel as Label,
} from "@/components/unlocked/unlocked-ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { router } from "expo-router";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Clipboard from "expo-clipboard";
import { useAtomValue } from "jotai";
import type { MessageDescriptor } from "@lingui/core";
import { msg, plural } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import {
    Check,
    ChevronDown,
    ChevronRight,
    Plus,
    ScanLine,
    Shield,
    Trash2,
} from "lucide-react-native";
import { ulid } from "ulidx";

import {
    CredentialURLMatchMode,
    CustomFieldType,
    ItemType,
    TOTPAlgorithm,
} from "@cryptex-industries/vault-core/proto";
import {
    createCredential,
    CredentialFormSchema,
    parseTOTPURI,
    sortDirectories,
    updateCredentialFromForm,
    Vault,
    type CredentialFormSchemaType,
    type VaultCredential,
} from "@cryptex-industries/vault-core/vault-utils/vault";
import { TOTPConstants } from "@cryptex-industries/vault-core/consts";
import { unlockedVaultAtom, vaultCredentialsAtom } from "@/utils/atoms";
import {
    persistVaultMutation,
    type VaultMutationError,
} from "@/utils/vault-mutations";
import { joinTags, tagsToDisplay } from "@/utils/credential-search";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { IconButton } from "@/components/icon-button";
import { InlineNotice } from "@/components/inline-notice";
import { PasswordStrengthMeter } from "@/components/vault/password-strength-meter";
import { PasswordGeneratorDialog } from "@/components/vault/password-generator";
import { colors } from "@/theme";
import { cn } from "@/lib/utils";
import { credentialFormIssueText } from "@/utils/credential-form-messages";
import {
    Dialog,
    DialogDescription,
    DialogFooter,
    DialogHeader,
} from "@/components/ui/dialog";
import { TotpField } from "@/components/vault/totp-field";
import { SSHKeyForm } from "@/components/vault/ssh-key-form";
import type { NewItemType } from "@/components/vault/add-item-sheet";

type CustomFieldDraft = {
    ID: string;
    Name: string;
    Type: CustomFieldType;
    Value: string;
};

type URLRuleDraft = {
    ID: string;
    URL: string;
    MatchMode: CredentialURLMatchMode;
};

type CredentialFormProps = {
    credentialId?: string;
    /** Prefill directory when creating from a filtered list. */
    initialDirectoryId?: string;
    /** Request-owned prefill. Supplied fields override their saved defaults. */
    initialValues?: Partial<CredentialFormSchemaType>;
    /** Request integrations can keep control after a successful encrypted save. */
    onSaved?: (credential: VaultCredential) => void;
    onCancel?: () => void;
    /** Checked before queuing and again inside the serialized vault mutation. */
    beforeSave?: () => string | null;
    /** Receives a safe message and a retry that re-runs validation and beforeSave. */
    onSaveError?: (
        message: string,
        code: VaultMutationError,
        retry: () => void,
    ) => void;
    notice?: { tone: "info" | "warning"; message: string };
    requirePassword?: boolean;
    /** New items only; existing items open the editor for their own type. */
    itemType?: NewItemType;
};

const FIELD_TYPE_OPTIONS: Array<{
    value: CustomFieldType;
    label: MessageDescriptor;
}> = [
    {
        value: CustomFieldType.Text,
        label: msg({ message: "Text", comment: "Custom field type" }),
    },
    {
        value: CustomFieldType.MaskedText,
        label: msg({ message: "Hidden", comment: "Custom field type" }),
    },
    {
        value: CustomFieldType.Boolean,
        label: msg({
            message: "Bool",
            comment: "Custom field type: on/off switch",
        }),
    },
    {
        value: CustomFieldType.Date,
        label: msg({ message: "Date", comment: "Custom field type" }),
    },
];

const TOTP_ALGO_OPTIONS: Array<{ value: TOTPAlgorithm; label: string }> = [
    { value: TOTPAlgorithm.SHA1, label: "SHA1" }, // i18n-ignore: algorithm name
    { value: TOTPAlgorithm.SHA256, label: "SHA256" }, // i18n-ignore: algorithm name
    { value: TOTPAlgorithm.SHA512, label: "SHA512" }, // i18n-ignore: algorithm name
];

const URL_MATCH_MODES: Array<{
    value: CredentialURLMatchMode;
    label: MessageDescriptor;
    description: MessageDescriptor;
    example: string;
}> = [
    {
        value: CredentialURLMatchMode.ExactHost,
        label: msg`This host only`,
        description: msg`Offer this item on this hostname, on any page.`,
        example: "accounts.example.com",
    },
    {
        value: CredentialURLMatchMode.Domain,
        label: msg`Related domains`,
        description: msg`Include the base domain and its subdomains when they share one account.`,
        example: "example.com, mail.example.com",
    },
    {
        value: CredentialURLMatchMode.Wildcard,
        label: msg`Custom pattern`,
        description: msg`Choose specific hostnames or paths using * and **.`,
        example: "*.example.com → shop.example.com",
    },
];

function matchingLabel(mode: CredentialURLMatchMode): MessageDescriptor {
    return (
        URL_MATCH_MODES.find((option) => option.value === mode)?.label ??
        URL_MATCH_MODES[0]!.label
    );
}

function MatchingTrigger({
    mode,
    onPress,
}: {
    mode: CredentialURLMatchMode;
    onPress: () => void;
}) {
    const { t } = useLingui();
    const label = t(matchingLabel(mode));
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={t`Website matching, ${label}`}
            onPress={onPress}
            style={{
                minHeight: 48,
                flexDirection: "row",
                alignItems: "center",
                gap: 9,
                paddingTop: 8,
            }}
        >
            <Shield size={16} color={colors.primary} />
            <Text style={{ flex: 1, fontSize: 12 }}>{label}</Text>
            <ChevronRight size={16} color={colors.muted} />
        </Pressable>
    );
}

function nextFieldTypeLabel(type: CustomFieldType): MessageDescriptor {
    return (
        FIELD_TYPE_OPTIONS.find((o) => o.value === type)?.label ??
        FIELD_TYPE_OPTIONS[0]!.label
    );
}

function booleanFieldValue(value: string): "true" | "false" {
    return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase())
        ? "true"
        : "false";
}

function isAndroidAppTarget(value: string): boolean {
    return value.trim().toLowerCase().startsWith("androidapp:");
}

export function CredentialForm(props: CredentialFormProps) {
    const { t } = useLingui();
    const credentials = useAtomValue(vaultCredentialsAtom);
    const existing = useMemo(
        () =>
            props.credentialId
                ? (credentials.find(
                      (credential) =>
                          credential.ID === props.credentialId &&
                          !credential.Deleted,
                  ) ?? null)
                : null,
        [credentials, props.credentialId],
    );

    if (props.credentialId && !existing) {
        return (
            <UnlockedTaskScreen title={t`Item not found`}>
                <Button onPress={() => router.back()}>{t`Back`}</Button>
            </UnlockedTaskScreen>
        );
    }

    if (
        existing
            ? existing.Type === ItemType.SSHKey
            : props.itemType === "ssh-key"
    ) {
        return (
            <SSHKeyForm
                key={props.credentialId ?? "new"}
                existing={existing}
                initialDirectoryId={props.initialDirectoryId}
            />
        );
    }

    return (
        <CredentialFormEditor
            key={props.credentialId ?? "new"}
            {...props}
            existing={existing}
        />
    );
}

function CredentialFormEditor({
    existing,
    initialDirectoryId = "",
    initialValues,
    onSaved,
    onCancel,
    beforeSave,
    onSaveError,
    notice,
    requirePassword = false,
}: CredentialFormProps & { existing: VaultCredential | null }) {
    const { t } = useLingui();
    const confirm = useUnlockedConfirmation();
    const vault = useAtomValue(unlockedVaultAtom);
    const [openedRevision] = useState(() =>
        existing ? { version: existing.Version, hash: existing.Hash } : null,
    );

    const directories = useMemo(
        () => sortDirectories(vault.Directories),
        [vault.Directories],
    );

    const [name, setName] = useState(
        initialValues?.Name ?? existing?.Name ?? "",
    );
    const [username, setUsername] = useState(
        initialValues?.Username ?? existing?.Username ?? "",
    );
    const [password, setPassword] = useState(
        initialValues?.Password ?? existing?.Password ?? "",
    );
    const [url, setUrl] = useState(initialValues?.URL ?? existing?.URL ?? "");
    const [urlMatchMode, setUrlMatchMode] = useState(
        initialValues?.URLMatchMode ??
            existing?.URLMatchMode ??
            CredentialURLMatchMode.ExactHost,
    );
    const [additionalURLs, setAdditionalURLs] = useState<URLRuleDraft[]>(() =>
        (initialValues?.AdditionalURLs ?? existing?.AdditionalURLs ?? []).map(
            (rule) => ({
                ID: ulid(),
                URL: rule.URL,
                MatchMode: rule.MatchMode,
            }),
        ),
    );
    const [notes, setNotes] = useState(
        initialValues?.Notes ?? existing?.Notes ?? "",
    );
    const [tagsText, setTagsText] = useState(
        tagsToDisplay(initialValues?.Tags ?? existing?.Tags),
    );
    const [directoryId, setDirectoryId] = useState(
        initialValues?.DirectoryID ??
            existing?.DirectoryID ??
            initialDirectoryId,
    );
    const initialTotp = initialValues?.TOTP ?? existing?.TOTP;
    const [totpEnabled, setTotpEnabled] = useState(!!initialTotp?.Secret);
    const [totpLabel, setTotpLabel] = useState(initialTotp?.Label ?? "");
    const [totpSecret, setTotpSecret] = useState(initialTotp?.Secret ?? "");
    const [totpPeriod, setTotpPeriod] = useState(
        String(initialTotp?.Period ?? TOTPConstants.PERIOD_DEFAULT),
    );
    const [totpDigits, setTotpDigits] = useState(
        String(initialTotp?.Digits ?? TOTPConstants.DIGITS_DEFAULT),
    );
    const [totpAlgorithm, setTotpAlgorithm] = useState<TOTPAlgorithm>(
        initialTotp?.Algorithm ?? TOTPConstants.ALGORITHM_DEFAULT,
    );
    const [totpScanning, setTotpScanning] = useState(false);
    const [totpAdvanced, setTotpAdvanced] = useState(false);
    const [totpEditorOpen, setTotpEditorOpen] = useState(false);
    const [totpSnapshot, setTotpSnapshot] = useState<{
        enabled: boolean;
        label: string;
        secret: string;
        period: string;
        digits: string;
        algorithm: TOTPAlgorithm;
    } | null>(null);
    const [totpImportError, setTotpImportError] = useState("");
    const [cameraPermission, requestCameraPermission] = useCameraPermissions();
    const [customFields, setCustomFields] = useState<CustomFieldDraft[]>(() =>
        (initialValues?.CustomFields ?? existing?.CustomFields ?? []).map(
            (field) => ({
                ID: field.ID,
                Name: field.Name,
                Type: field.Type,
                Value:
                    field.Type === CustomFieldType.Boolean
                        ? booleanFieldValue(field.Value)
                        : field.Value,
            }),
        ),
    );
    const [generatorOpen, setGeneratorOpen] = useState(false);
    const [fieldTypeTarget, setFieldTypeTarget] = useState<number | null>(null);
    const [directoryPickerOpen, setDirectoryPickerOpen] = useState(false);
    const [matchingTarget, setMatchingTarget] = useState<
        "primary" | string | null
    >(null);
    const [loading, setLoading] = useState(false);
    const saving = useRef(false);
    // Set once the screen is gone, so a save that finishes later doesn't navigate.
    const left = useRef(false);
    useEffect(
        () => () => {
            left.current = true;
        },
        [],
    );
    const [error, setError] = useState("");
    const [dirty, setDirty] = useState(false);
    const [moreDetailsOpen, setMoreDetailsOpen] = useState(
        !!existing?.Notes || !!existing?.Tags,
    );

    const markDirty = () => setDirty(true);
    const digitCount = Number(totpDigits);
    const periodSeconds = Number(totpPeriod);
    const algorithmName = TOTP_ALGO_OPTIONS.find(
        (option) => option.value === totpAlgorithm,
    )?.label;

    const addCustomField = () => {
        markDirty();
        setCustomFields((prev) => [
            ...prev,
            {
                ID: ulid(),
                Name: "",
                Type: CustomFieldType.Text,
                Value: "",
            },
        ]);
    };

    const updateCustomField = (
        index: number,
        patch: Partial<CustomFieldDraft>,
    ) => {
        markDirty();
        setCustomFields((prev) =>
            prev.map((field, i) => {
                if (i !== index) return field;
                const updated = { ...field, ...patch };
                if (updated.Type === CustomFieldType.Boolean) {
                    updated.Value = booleanFieldValue(updated.Value);
                }
                return updated;
            }),
        );
    };

    const removeCustomField = (index: number) => {
        markDirty();
        setCustomFields((prev) => prev.filter((_, i) => i !== index));
    };

    const importTOTP = (value: string) => {
        try {
            const parsed = parseTOTPURI(value.trim());
            setTotpEnabled(true);
            setTotpLabel(parsed.Label);
            setTotpSecret(parsed.Secret);
            setTotpPeriod(String(parsed.Period));
            setTotpDigits(String(parsed.Digits));
            setTotpAlgorithm(parsed.Algorithm);
            setTotpImportError("");
            setTotpScanning(false);
        } catch {
            setTotpImportError(t`This does not contain a valid TOTP URI.`);
        }
    };

    const openTotpEditor = (scan = false) => {
        setTotpSnapshot({
            enabled: totpEnabled,
            label: totpLabel,
            secret: totpSecret,
            period: totpPeriod,
            digits: totpDigits,
            algorithm: totpAlgorithm,
        });
        setTotpImportError("");
        setTotpScanning(scan);
        setTotpEditorOpen(true);
        if (scan && !cameraPermission?.granted) void requestCameraPermission();
    };

    const cancelTotpEditor = () => {
        if (totpSnapshot) {
            setTotpEnabled(totpSnapshot.enabled);
            setTotpLabel(totpSnapshot.label);
            setTotpSecret(totpSnapshot.secret);
            setTotpPeriod(totpSnapshot.period);
            setTotpDigits(totpSnapshot.digits);
            setTotpAlgorithm(totpSnapshot.algorithm);
        }
        setTotpScanning(false);
        setTotpEditorOpen(false);
        setTotpSnapshot(null);
    };

    const applyTotpEditor = () => {
        const normalized = totpSecret.replace(/\s+/g, "").toUpperCase();
        if (!/^[A-Z2-7]{8,}={0,6}$/.test(normalized)) {
            setTotpImportError(
                t`Enter a setup key using letters A–Z and digits 2–7.`,
            );
            return;
        }
        markDirty();
        setTotpSecret(normalized);
        setTotpEnabled(true);
        setTotpScanning(false);
        setTotpEditorOpen(false);
        setTotpSnapshot(null);
    };

    const setWebsiteMatchMode = (mode: CredentialURLMatchMode) => {
        markDirty();
        if (matchingTarget === "primary") setUrlMatchMode(mode);
        else if (matchingTarget) {
            setAdditionalURLs((current) =>
                current.map((item) =>
                    item.ID === matchingTarget
                        ? { ...item, MatchMode: mode }
                        : item,
                ),
            );
        }
        setMatchingTarget(null);
    };

    const handleSave = async () => {
        if (saving.current) return;
        if (!name.trim()) {
            setError(t`Name is required.`);
            return;
        }
        if (requirePassword && !password) {
            setError(t`Password is required.`);
            return;
        }
        const initialGateFailure = beforeSave?.() ?? null;
        if (initialGateFailure) {
            setError(initialGateFailure);
            return;
        }
        saving.current = true;
        setLoading(true);
        setError("");

        const period = Number(totpPeriod);
        const digits = Number(totpDigits);

        const formResult = CredentialFormSchema.safeParse({
            ID: existing?.ID ?? null,
            Type: existing?.Type ?? ItemType.Credentials,
            DirectoryID: directoryId,
            Name: name.trim(),
            Username: username,
            Password: password,
            URL: url,
            URLMatchMode: urlMatchMode,
            AdditionalURLs: additionalURLs.map(({ URL, MatchMode }) => ({
                URL,
                MatchMode,
            })),
            Passkey: existing?.Passkey ?? null,
            Notes: notes,
            Tags: joinTags(
                tagsText
                    .split(",")
                    .map((t) => t.trim())
                    .filter(Boolean),
            ),
            TOTP:
                totpEnabled && totpSecret.trim()
                    ? {
                          Label: totpLabel.trim() || name.trim(),
                          Secret: totpSecret.trim().replace(/\s+/g, ""),
                          Period:
                              Number.isFinite(period) && period >= 1
                                  ? period
                                  : TOTPConstants.PERIOD_DEFAULT,
                          Digits:
                              Number.isFinite(digits) && digits >= 1
                                  ? digits
                                  : TOTPConstants.DIGITS_DEFAULT,
                          Algorithm: totpAlgorithm,
                      }
                    : null,
            CustomFields: customFields.filter(
                (field) => field.Name.trim() && field.Value.trim(),
            ),
        });

        if (!formResult.success) {
            saving.current = false;
            setLoading(false);
            setError(
                credentialFormIssueText(formResult.error.issues[0]) ??
                    t`Invalid credential.`,
            );
            return;
        }
        const form: CredentialFormSchemaType = formResult.data;

        let serializedGateFailure: string | null = null;
        const result = await persistVaultMutation(
            "credential.upsert",
            async (currentVault) => {
                serializedGateFailure = beforeSave?.() ?? null;
                if (serializedGateFailure) throw new Error("REQUEST_INVALID");
                const updatedVault = Object.assign(new Vault(), currentVault);
                updatedVault.Credentials = [...currentVault.Credentials];

                const existingIndex = form.ID
                    ? updatedVault.Credentials.findIndex(
                          (c) => c.ID === form.ID && !c.Deleted,
                      )
                    : -1;
                const existingCredential =
                    existingIndex >= 0
                        ? updatedVault.Credentials[existingIndex]
                        : undefined;
                if (form.ID && !existingCredential) {
                    throw new Error("CREDENTIAL_NOT_FOUND");
                }
                if (
                    existingCredential &&
                    openedRevision &&
                    (existingCredential.Version !== openedRevision.version ||
                        existingCredential.Hash !== openedRevision.hash)
                ) {
                    serializedGateFailure = t`This item changed while you were editing. Your edits are still here. Cancel editing and reopen the item before saving.`;
                    throw new Error("CREDENTIAL_EDIT_CONFLICT");
                }
                const saved = existingCredential
                    ? await updateCredentialFromForm(existingCredential, {
                          ...form,
                          Passkey: existingCredential.Passkey ?? null,
                      })
                    : await createCredential(form);

                if (existingIndex >= 0) {
                    updatedVault.Credentials[existingIndex] = saved;
                } else {
                    updatedVault.Credentials.push(saved);
                }
                return { vault: updatedVault, result: saved };
            },
        );

        saving.current = false;
        setLoading(false);
        if (result.isErr()) {
            if (serializedGateFailure) {
                setError(serializedGateFailure);
            } else if (onSaveError) {
                onSaveError(
                    t`The vault update could not be saved. Your changes are still in the editor.`,
                    result.error,
                    () => void handleSave(),
                );
            } else {
                setError(t`Failed to save credential.`);
            }
            return;
        }
        setDirty(false);
        // The item is saved either way; only move on if the user is still here.
        if (left.current) return;
        if (onSaved) {
            onSaved(result.value);
        } else if (existing) {
            router.back();
        } else {
            router.replace(`/(app)/(tabs)/vault/${result.value.ID}`);
        }
    };

    const requestCancel = useCallback(() => {
        // Leaving now would let the finished save navigate from another screen.
        if (saving.current) return;
        if (!dirty) {
            if (onCancel) onCancel();
            else router.back();
            return;
        }
        confirm({
            title: t`Discard changes?`,
            description: t`Your unsaved changes will be lost.`,
            cancelLabel: t`Keep editing`,
            confirmLabel: t`Discard`,
            onConfirm: () => {
                if (saving.current) return;
                if (onCancel) onCancel();
                else router.back();
            },
        });
    }, [confirm, dirty, onCancel, t]);

    return (
        <UnlockedTaskScreen
            title={existing ? t`Edit item` : t`Add item`}
            backLabel={t`Cancel editing`}
            onBack={requestCancel}
            footer={
                <Button
                    className="h-[54px] min-h-[54px]"
                    textClassName="text-[#111520]"
                    loading={loading}
                    loadingLabel={t`Saving…`}
                    onPress={() => void handleSave()}
                    testID="credential-submit"
                >
                    {t`Save item`}
                </Button>
            }
        >
            <View className="gap-4">
                {notice ? (
                    <InlineNotice tone={notice.tone} message={notice.message} />
                ) : null}
                <View>
                    <Label>
                        {t({ message: "Name", comment: "Item name field" })}{" "}
                        <Text className="text-destructive">*</Text>
                    </Label>
                    <Input
                        value={name}
                        onChangeText={(v) => {
                            markDirty();
                            setName(v);
                        }}
                        placeholder={t`e.g., GitHub`}
                        accessibilityLabel={t`Credential name`}
                        autoCapitalize="words"
                    />
                </View>

                <View>
                    <Label>{t`Username or email`}</Label>
                    <Input
                        value={username}
                        onChangeText={(v) => {
                            markDirty();
                            setUsername(v);
                        }}
                        autoCapitalize="none"
                        autoCorrect={false}
                        textContentType="username"
                        accessibilityLabel={t`Credential username`}
                    />
                </View>

                <View>
                    <Label>{t`Password`}</Label>
                    <Input
                        value={password}
                        onChangeText={(v) => {
                            markDirty();
                            setPassword(v);
                        }}
                        secureTextEntry
                        revealButtonHeight={54}
                        onGenerate={() => setGeneratorOpen(true)}
                        className="h-[54px]"
                        autoCapitalize="none"
                        autoCorrect={false}
                        textContentType="password"
                        accessibilityLabel={t`Password`}
                        accessibilityValue={{
                            text: t`Hidden. Show to hear value.`,
                        }}
                        importantForAutofill="no"
                    />
                    <PasswordStrengthMeter password={password} />
                </View>

                <View className="flex-row items-center justify-between">
                    <Text className="text-xs uppercase tracking-wider text-muted-foreground">
                        {t`Websites`}
                    </Text>
                    <Button
                        size="sm"
                        variant="ghost"
                        accessibilityLabel={t`Add website`}
                        onPress={() => {
                            markDirty();
                            setAdditionalURLs((current) => [
                                ...current,
                                {
                                    ID: ulid(),
                                    URL: "",
                                    MatchMode: CredentialURLMatchMode.ExactHost,
                                },
                            ]);
                        }}
                    >
                        <Plus size={18} color={colors.primary} />
                        <Text className="text-xs text-primary">
                            {t({
                                message: "Add",
                                comment: "Button: add a row",
                            })}
                        </Text>
                    </Button>
                </View>
                <View className="rounded-lg border border-border bg-secondary p-3">
                    <Label>
                        {isAndroidAppTarget(url)
                            ? t`Android app`
                            : t`Primary website`}
                    </Label>
                    <Input
                        value={url}
                        onChangeText={(v) => {
                            markDirty();
                            setUrl(v);
                            if (isAndroidAppTarget(v)) {
                                setUrlMatchMode(
                                    CredentialURLMatchMode.ExactHost,
                                );
                            }
                        }}
                        autoCapitalize="none"
                        autoCorrect={false}
                        keyboardType="url"
                        placeholder={
                            isAndroidAppTarget(url)
                                ? "androidapp://com.example.app"
                                : "https://example.com"
                        }
                        accessibilityLabel={t`Primary website`}
                        testID="credential-website-url"
                    />
                    {isAndroidAppTarget(url) ? (
                        <Text className="mt-2 text-xs text-muted-foreground">
                            {t`Exact app match`}
                        </Text>
                    ) : (
                        <MatchingTrigger
                            mode={urlMatchMode}
                            onPress={() => setMatchingTarget("primary")}
                        />
                    )}
                </View>

                {additionalURLs.map((rule, index) => {
                    const appTarget = isAndroidAppTarget(rule.URL);
                    const targetNumber = index + 2;
                    return (
                        <View
                            key={rule.ID}
                            className="gap-2 rounded-lg border border-border bg-secondary p-3"
                        >
                            <View className="flex-row items-center justify-between">
                                <Label>
                                    {appTarget
                                        ? t`Android app`
                                        : t`Additional website`}
                                </Label>
                                <IconButton
                                    icon={Trash2}
                                    label={t`Remove autofill target ${targetNumber}`}
                                    onPress={() => {
                                        markDirty();
                                        setAdditionalURLs((current) =>
                                            current.filter(
                                                (item) => item.ID !== rule.ID,
                                            ),
                                        );
                                    }}
                                />
                            </View>
                            <Input
                                value={rule.URL}
                                onChangeText={(value) => {
                                    markDirty();
                                    setAdditionalURLs((current) =>
                                        current.map((item) =>
                                            item.ID === rule.ID
                                                ? {
                                                      ...item,
                                                      URL: value,
                                                      MatchMode:
                                                          isAndroidAppTarget(
                                                              value,
                                                          )
                                                              ? CredentialURLMatchMode.ExactHost
                                                              : item.MatchMode,
                                                  }
                                                : item,
                                        ),
                                    );
                                }}
                                autoCapitalize="none"
                                autoCorrect={false}
                                keyboardType="url"
                                placeholder={
                                    appTarget
                                        ? "androidapp://com.example.app"
                                        : "https://accounts.example.com"
                                }
                                accessibilityLabel={t`Autofill target ${targetNumber}`}
                                testID={`credential-website-url-${index + 2}`}
                            />
                            {appTarget ? (
                                <Text className="text-xs text-muted-foreground">
                                    {t`Exact app match`}
                                </Text>
                            ) : (
                                <MatchingTrigger
                                    mode={rule.MatchMode}
                                    onPress={() => setMatchingTarget(rule.ID)}
                                />
                            )}
                        </View>
                    );
                })}

                <View>
                    <Label>{t`Directory`}</Label>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t`Choose directory`}
                        onPress={() => setDirectoryPickerOpen(true)}
                        style={{
                            minHeight: 54,
                            borderWidth: 1,
                            borderColor: colors.border,
                            borderRadius: 6,
                            backgroundColor: colors.navigation,
                            paddingHorizontal: 14,
                            flexDirection: "row",
                            alignItems: "center",
                            justifyContent: "space-between",
                        }}
                    >
                        <Text>
                            {directories.find((item) => item.ID === directoryId)
                                ?.Name || t`No directory`}
                        </Text>
                        <ChevronRight size={18} color={colors.muted} />
                    </Pressable>
                </View>

                <Separator />

                <View>
                    <View className="mb-3 flex-row items-center justify-between">
                        <View>
                            <Text className="font-medium text-xs uppercase tracking-wider text-muted-foreground">
                                {t`Authenticator (TOTP)`}
                            </Text>
                            <Text className="mt-1 text-xs text-muted-foreground">
                                {t`Save verification codes with this item.`}
                            </Text>
                        </View>
                        {totpEnabled && totpSecret ? (
                            <Button
                                size="sm"
                                variant="ghost"
                                onPress={() => openTotpEditor()}
                            >
                                {t`Edit`}
                            </Button>
                        ) : null}
                    </View>
                    {totpEnabled && totpSecret ? (
                        <View className="rounded-lg border border-border bg-secondary p-3">
                            <View className="mb-2 flex-row items-center gap-2">
                                <Shield size={16} color={colors.success} />
                                <Text className="flex-1 text-xs text-success">
                                    {t({
                                        message: "Configured",
                                        comment: "Authenticator status",
                                    })}
                                </Text>
                                {totpLabel ? (
                                    <Text className="text-xs text-muted-foreground">
                                        {totpLabel}
                                    </Text>
                                ) : null}
                            </View>
                            <TotpField
                                embedded
                                credential={
                                    {
                                        TOTP: {
                                            Secret: totpSecret,
                                            Label: totpLabel,
                                            Period:
                                                Number(totpPeriod) ||
                                                TOTPConstants.PERIOD_DEFAULT,
                                            Digits:
                                                Number(totpDigits) ||
                                                TOTPConstants.DIGITS_DEFAULT,
                                            Algorithm: totpAlgorithm,
                                        },
                                    } as Pick<VaultCredential, "TOTP">
                                }
                            />
                            <Text className="text-[11px] text-muted-foreground">
                                {t`${plural(digitCount, {
                                    one: "# digit",
                                    other: "# digits",
                                })}, ${plural(periodSeconds, {
                                    one: "# second",
                                    other: "# seconds",
                                })}, ${algorithmName}`}
                            </Text>
                            <Button
                                variant="destructive"
                                onPress={() =>
                                    confirm({
                                        title: t`Remove authenticator?`,
                                        description: t`This removes the key from this item when you save. It does not turn off two-step verification on the website.`,
                                        cancelLabel: t`Keep authenticator`,
                                        confirmLabel: t`Remove from item`,
                                        onConfirm: () => {
                                            markDirty();
                                            setTotpEnabled(false);
                                            setTotpSecret("");
                                        },
                                    })
                                }
                            >
                                {t`Remove authenticator`}
                            </Button>
                        </View>
                    ) : (
                        <View className="flex-row gap-2">
                            <Button
                                className="flex-1"
                                variant="secondary"
                                onPress={() => openTotpEditor(true)}
                            >
                                <ScanLine size={16} color={colors.foreground} />
                                <Text className="text-sm text-secondary-foreground">
                                    {t`Scan QR code`}
                                </Text>
                            </Button>
                            <Button
                                className="flex-1"
                                variant="secondary"
                                onPress={() => openTotpEditor()}
                            >
                                {t`Enter key`}
                            </Button>
                        </View>
                    )}
                </View>

                <Separator />

                <View>
                    <View className="mb-3 flex-row items-center justify-between">
                        <View>
                            <Text className="font-medium text-sm text-foreground">
                                {t`Custom Fields`}
                            </Text>
                            <Text className="text-xs text-muted-foreground">
                                {t({
                                    message: "Text, Hidden, Bool, Date",
                                    comment:
                                        "The custom field types; keep in sync with their names",
                                })}
                            </Text>
                        </View>
                        <Button
                            size="sm"
                            variant="ghost"
                            accessibilityLabel={t`Add custom field`}
                            onPress={addCustomField}
                        >
                            <Plus size={18} color={colors.primary} />
                            <Text className="text-xs text-primary">
                                {t({
                                    message: "Add",
                                    comment: "Button: add a row",
                                })}
                            </Text>
                        </Button>
                    </View>

                    {customFields.length === 0 ? (
                        <View className="items-center rounded-lg border border-dashed border-border py-6">
                            <Text className="text-sm text-muted-foreground">
                                {t`No custom fields yet`}
                            </Text>
                        </View>
                    ) : (
                        <View className="gap-3">
                            {customFields.map((field, index) => {
                                const fieldNumber = index + 1;
                                const fieldName = field.Name || t`Field`;
                                const typeLabel = t(
                                    nextFieldTypeLabel(field.Type),
                                );
                                return (
                                    <View
                                        key={field.ID}
                                        className="rounded-lg border border-border bg-secondary/40 p-3"
                                    >
                                        <View className="mb-2 flex-row items-center gap-2">
                                            <Input
                                                className="min-h-10 flex-1"
                                                value={field.Name}
                                                onChangeText={(v) =>
                                                    updateCustomField(index, {
                                                        Name: v,
                                                    })
                                                }
                                                placeholder={t`Field name`}
                                                accessibilityLabel={t`Custom field ${fieldNumber} name`}
                                            />
                                            <IconButton
                                                icon={Trash2}
                                                label={t`Remove custom field`}
                                                color={colors.muted}
                                                onPress={() =>
                                                    removeCustomField(index)
                                                }
                                            />
                                        </View>
                                        {field.Type ===
                                        CustomFieldType.Boolean ? (
                                            <View className="min-h-[44px] flex-row items-center justify-between">
                                                <Text className="text-sm text-foreground">
                                                    {t({
                                                        message: "Enabled",
                                                        comment:
                                                            "Value of an on/off custom field",
                                                    })}
                                                </Text>
                                                <Switch
                                                    value={
                                                        booleanFieldValue(
                                                            field.Value,
                                                        ) === "true"
                                                    }
                                                    onValueChange={(v) =>
                                                        updateCustomField(
                                                            index,
                                                            {
                                                                Value: v
                                                                    ? "true"
                                                                    : "false",
                                                            },
                                                        )
                                                    }
                                                    accessibilityLabel={t`${fieldName} boolean value`}
                                                />
                                            </View>
                                        ) : (
                                            <Input
                                                value={field.Value}
                                                onChangeText={(v) =>
                                                    updateCustomField(index, {
                                                        Value: v,
                                                    })
                                                }
                                                placeholder={
                                                    field.Type ===
                                                    CustomFieldType.Date
                                                        ? t({
                                                              message:
                                                                  "YYYY-MM-DD",
                                                              comment:
                                                                  "Date format hint; the value is stored as typed",
                                                          })
                                                        : t`Value`
                                                }
                                                secureTextEntry={
                                                    field.Type ===
                                                    CustomFieldType.MaskedText
                                                }
                                                multiline={
                                                    field.Type ===
                                                    CustomFieldType.Text
                                                }
                                                textAlignVertical="top"
                                                className={cn(
                                                    (field.Type ===
                                                        CustomFieldType.Text ||
                                                        field.Type ===
                                                            CustomFieldType.MaskedText) &&
                                                        "min-h-20",
                                                )}
                                                accessibilityLabel={t`${fieldName} value`}
                                                accessibilityValue={
                                                    field.Type ===
                                                    CustomFieldType.MaskedText
                                                        ? {
                                                              text: t`Hidden. Secure field.`,
                                                          }
                                                        : undefined
                                                }
                                                importantForAutofill="no"
                                            />
                                        )}
                                        <Pressable
                                            accessibilityRole="button"
                                            accessibilityLabel={t`Change field type, ${typeLabel}`}
                                            onPress={() =>
                                                setFieldTypeTarget(index)
                                            }
                                            style={{
                                                minHeight: 48,
                                                marginTop: 8,
                                                flexDirection: "row",
                                                alignItems: "center",
                                                justifyContent: "space-between",
                                            }}
                                        >
                                            <Text
                                                style={{
                                                    color: colors.muted,
                                                    fontSize: 12,
                                                }}
                                            >
                                                {t({
                                                    message: "Type",
                                                    comment:
                                                        "Custom field type row",
                                                })}
                                            </Text>
                                            <View
                                                style={{
                                                    flexDirection: "row",
                                                    alignItems: "center",
                                                    gap: 8,
                                                }}
                                            >
                                                <Text style={{ fontSize: 12 }}>
                                                    {typeLabel}
                                                </Text>
                                                <ChevronRight
                                                    size={16}
                                                    color={colors.muted}
                                                />
                                            </View>
                                        </Pressable>
                                    </View>
                                );
                            })}
                        </View>
                    )}
                </View>

                <Separator />
                <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ expanded: moreDetailsOpen }}
                    onPress={() => setMoreDetailsOpen((current) => !current)}
                    className="min-h-[54px] flex-row items-center"
                >
                    <Text className="flex-1 text-sm text-foreground">
                        {t`More details`}
                    </Text>
                    {moreDetailsOpen ? (
                        <ChevronDown size={18} color={colors.muted} />
                    ) : (
                        <ChevronRight size={18} color={colors.muted} />
                    )}
                </Pressable>
                {moreDetailsOpen ? (
                    <View className="gap-4">
                        <View>
                            <Label>{t`Tags`}</Label>
                            <Input
                                value={tagsText}
                                onChangeText={(value) => {
                                    markDirty();
                                    setTagsText(value);
                                }}
                                placeholder={t`work, personal`}
                                autoCapitalize="none"
                            />
                            <Text className="mt-1 text-xs text-muted-foreground">
                                {t({
                                    message:
                                        'Comma-separated. Search with tag:"work".',
                                    comment:
                                        "tag: is search syntax; keep it as typed",
                                })}
                            </Text>
                        </View>
                        <View>
                            <Label>{t`Notes`}</Label>
                            <Input
                                value={notes}
                                onChangeText={(value) => {
                                    markDirty();
                                    setNotes(value);
                                }}
                                multiline
                                className="min-h-24"
                                textAlignVertical="top"
                            />
                        </View>
                    </View>
                ) : null}

                {error ? (
                    <Text className="text-sm text-destructive">{error}</Text>
                ) : null}
            </View>

            <Dialog
                open={fieldTypeTarget !== null}
                onOpenChange={(open) => {
                    if (!open) setFieldTypeTarget(null);
                }}
                placement="bottom"
            >
                <DialogHeader>
                    <DialogTitle>{t`Field type`}</DialogTitle>
                </DialogHeader>
                {FIELD_TYPE_OPTIONS.map((option) => (
                    <Pressable
                        key={option.value}
                        accessibilityRole="button"
                        onPress={() => {
                            if (fieldTypeTarget !== null)
                                updateCustomField(fieldTypeTarget, {
                                    Type: option.value,
                                });
                            setFieldTypeTarget(null);
                        }}
                        style={{
                            minHeight: 54,
                            flexDirection: "row",
                            alignItems: "center",
                            justifyContent: "space-between",
                            borderBottomWidth: 1,
                            borderBottomColor: colors.border,
                        }}
                    >
                        <Text>{t(option.label)}</Text>
                        {fieldTypeTarget !== null &&
                        customFields[fieldTypeTarget]?.Type === option.value ? (
                            <Check size={20} color={colors.primary} />
                        ) : null}
                    </Pressable>
                ))}
            </Dialog>

            <Dialog
                open={directoryPickerOpen}
                onOpenChange={setDirectoryPickerOpen}
                placement="bottom"
            >
                <DialogHeader>
                    <DialogTitle>{t`Choose directory`}</DialogTitle>
                </DialogHeader>
                {[{ ID: "", Name: t`No directory` }, ...directories].map(
                    (directory) => (
                        <Pressable
                            key={directory.ID}
                            accessibilityRole="button"
                            accessibilityState={{
                                selected: directory.ID === directoryId,
                            }}
                            onPress={() => {
                                markDirty();
                                setDirectoryId(directory.ID);
                                setDirectoryPickerOpen(false);
                            }}
                            style={{
                                minHeight: 54,
                                flexDirection: "row",
                                alignItems: "center",
                                justifyContent: "space-between",
                                borderBottomWidth: 1,
                                borderBottomColor: colors.border,
                            }}
                        >
                            <Text>{directory.Name}</Text>
                            {directory.ID === directoryId ? (
                                <Check size={20} color={colors.primary} />
                            ) : null}
                        </Pressable>
                    ),
                )}
            </Dialog>

            <Dialog
                open={matchingTarget != null}
                onOpenChange={(open) => !open && setMatchingTarget(null)}
                placement="bottom"
            >
                <DialogHeader>
                    <DialogTitle>{t`Website matching`}</DialogTitle>
                    <DialogDescription>
                        {t`Choose when Cryptex Vault should offer this item.`}
                    </DialogDescription>
                </DialogHeader>
                <View className="rounded-md border border-border bg-background px-3 py-3">
                    <Text className="font-mono text-xs text-muted-foreground">
                        {matchingTarget === "primary"
                            ? url || t`This website`
                            : additionalURLs.find(
                                  (item) => item.ID === matchingTarget,
                              )?.URL || t`This website`}
                    </Text>
                </View>
                <View className="gap-2">
                    {URL_MATCH_MODES.map((option) => {
                        const currentMode =
                            matchingTarget === "primary"
                                ? urlMatchMode
                                : additionalURLs.find(
                                      (item) => item.ID === matchingTarget,
                                  )?.MatchMode;
                        const selected = currentMode === option.value;
                        const example = option.example;
                        return (
                            <Pressable
                                key={option.value}
                                accessibilityRole="button"
                                accessibilityState={{ selected }}
                                onPress={() =>
                                    setWebsiteMatchMode(option.value)
                                }
                                className={cn(
                                    "flex-row items-start gap-3 rounded-xl border bg-background px-3 py-4",
                                    selected
                                        ? "border-primary bg-primary/5"
                                        : "border-border",
                                )}
                            >
                                <View className="h-[30px] w-[30px] items-center justify-center">
                                    <Shield
                                        size={20}
                                        color={
                                            selected
                                                ? colors.primary
                                                : colors.muted
                                        }
                                    />
                                </View>
                                <View className="min-w-0 flex-1">
                                    <Text className="font-medium text-[15px] text-foreground">
                                        {t(option.label)}
                                    </Text>
                                    <Text className="mt-1.5 text-xs leading-5 text-muted-foreground">
                                        {t(option.description)}
                                    </Text>
                                    <Text className="mt-2 font-mono text-[11px] leading-4 text-muted-foreground">
                                        {t`Example: ${example}`}
                                    </Text>
                                </View>
                                <View
                                    className={cn(
                                        "mt-1 h-5 w-5 items-center justify-center rounded-full border",
                                        selected
                                            ? "border-primary bg-primary"
                                            : "border-border",
                                    )}
                                >
                                    {selected ? (
                                        <Check
                                            size={13}
                                            color={colors.navigation}
                                        />
                                    ) : null}
                                </View>
                            </Pressable>
                        );
                    })}
                </View>
            </Dialog>

            <Dialog
                open={totpEditorOpen}
                onOpenChange={(open) => !open && cancelTotpEditor()}
                placement="bottom"
                scroll
            >
                <DialogHeader>
                    <DialogTitle>
                        {totpSnapshot?.enabled
                            ? t`Edit authenticator`
                            : t`Set up authenticator`}
                    </DialogTitle>
                    <DialogDescription>
                        {t`Scan the account QR code or enter its setup key. Changes stay in this item draft until Save item.`}
                    </DialogDescription>
                </DialogHeader>
                <View className="flex-row gap-2">
                    <Button
                        className="flex-1"
                        variant="secondary"
                        onPress={() => {
                            if (!totpScanning && !cameraPermission?.granted)
                                void requestCameraPermission();
                            setTotpScanning((current) => !current);
                        }}
                    >
                        <ScanLine size={16} color={colors.foreground} />
                        <Text className="text-sm text-secondary-foreground">
                            {totpScanning ? t`Enter key` : t`Scan QR code`}
                        </Text>
                    </Button>
                    <Button
                        className="flex-1"
                        variant="secondary"
                        onPress={() => {
                            setTotpScanning(false);
                            void Clipboard.getStringAsync().then(importTOTP);
                        }}
                    >
                        {t`Paste URI`}
                    </Button>
                </View>
                {totpEditorOpen && totpScanning && cameraPermission?.granted ? (
                    <View
                        style={{
                            height: 256,
                            overflow: "hidden",
                            borderRadius: 12,
                        }}
                    >
                        <CameraView
                            style={{ flex: 1 }}
                            facing="back"
                            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                            onBarcodeScanned={({ data }) => importTOTP(data)}
                            onMountError={() =>
                                setTotpImportError(
                                    t`The camera could not start. Try again or enter the setup key.`,
                                )
                            }
                        />
                    </View>
                ) : null}
                {totpScanning &&
                cameraPermission &&
                !cameraPermission.granted ? (
                    <InlineNotice
                        tone="warning"
                        message={t`Camera permission is needed to scan. You can enter the setup key manually.`}
                    />
                ) : null}
                {!totpScanning ? (
                    <>
                        <View>
                            <Label>{t`Setup key`}</Label>
                            <Input
                                value={totpSecret}
                                onChangeText={(value) => {
                                    setTotpSecret(value);
                                    setTotpImportError("");
                                }}
                                secureTextEntry
                                revealButtonHeight={54}
                                className="h-[54px]"
                                autoCapitalize="characters"
                                autoCorrect={false}
                                placeholder={t`Enter the key from your account`}
                                accessibilityLabel={t`TOTP setup key`}
                                testID="credential-totp-secret"
                                importantForAutofill="no"
                            />
                        </View>
                        <View>
                            <Label>{t`Label (optional)`}</Label>
                            <Input
                                value={totpLabel}
                                onChangeText={setTotpLabel}
                                placeholder={t`e.g. Google personal`}
                            />
                        </View>
                        <Pressable
                            accessibilityRole="button"
                            accessibilityState={{ expanded: totpAdvanced }}
                            onPress={() =>
                                setTotpAdvanced((current) => !current)
                            }
                            className="min-h-[54px] flex-row items-center border-t border-border"
                        >
                            <Text className="flex-1 text-sm text-foreground">
                                {t`Advanced settings`}
                            </Text>
                            <ChevronRight
                                size={18}
                                color={colors.muted}
                                style={{
                                    transform: [
                                        {
                                            rotate: totpAdvanced
                                                ? "90deg"
                                                : "0deg",
                                        },
                                    ],
                                }}
                            />
                        </Pressable>
                        {totpAdvanced ? (
                            <View className="gap-3">
                                <View className="flex-row gap-3">
                                    <View className="flex-1">
                                        <Label>{t`Period (seconds)`}</Label>
                                        <Input
                                            value={totpPeriod}
                                            onChangeText={(value) =>
                                                setTotpPeriod(
                                                    value.replace(/\D/g, ""),
                                                )
                                            }
                                            keyboardType="number-pad"
                                        />
                                    </View>
                                    <View className="flex-1">
                                        <Label>{t`Digits`}</Label>
                                        <Input
                                            value={totpDigits}
                                            onChangeText={(value) =>
                                                setTotpDigits(
                                                    value.replace(/\D/g, ""),
                                                )
                                            }
                                            keyboardType="number-pad"
                                        />
                                    </View>
                                </View>
                                <View>
                                    <Label>{t`Algorithm`}</Label>
                                    <View className="flex-row gap-2">
                                        {TOTP_ALGO_OPTIONS.map((option) => (
                                            <Button
                                                key={option.value}
                                                size="sm"
                                                className="flex-1"
                                                variant={
                                                    totpAlgorithm ===
                                                    option.value
                                                        ? "default"
                                                        : "outline"
                                                }
                                                onPress={() =>
                                                    setTotpAlgorithm(
                                                        option.value,
                                                    )
                                                }
                                            >
                                                {option.label}
                                            </Button>
                                        ))}
                                    </View>
                                </View>
                            </View>
                        ) : null}
                    </>
                ) : null}
                {totpImportError ? (
                    <InlineNotice tone="error" message={totpImportError} />
                ) : null}
                <DialogFooter>
                    {!totpScanning ? (
                        <Button
                            textClassName="text-[#111520]"
                            onPress={applyTotpEditor}
                        >
                            {t`Apply setup`}
                        </Button>
                    ) : null}
                    <Button variant="ghost" onPress={cancelTotpEditor}>
                        {t`Cancel`}
                    </Button>
                </DialogFooter>
            </Dialog>

            <PasswordGeneratorDialog
                open={generatorOpen}
                onOpenChange={setGeneratorOpen}
                onPasswordSelect={(generated) => {
                    markDirty();
                    setPassword(generated);
                }}
                placement="bottom"
            />
        </UnlockedTaskScreen>
    );
}

export type { CredentialFormProps, VaultCredential };
