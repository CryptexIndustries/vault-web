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
import { Platform, Pressable, View } from "react-native";
import { router } from "expo-router";
import { useAtomValue } from "jotai";
import { Check, ChevronDown, ChevronRight, FileKey, FileUp, X } from "lucide-react-native";

import {
    CredentialURLMatchMode,
    ItemType,
    type SSHKeyData,
} from "@cryptex-industries/vault-core/proto";
import {
    describeSSHKey,
    sshPublicKeyLine,
} from "@cryptex-industries/vault-core/vault-utils/ssh-key-info";
import {
    createCredential,
    CredentialFormSchema,
    sortDirectories,
    updateCredentialFromForm,
    Vault,
    type VaultCredential,
} from "@cryptex-industries/vault-core/vault-utils/vault";
import { unlockedVaultAtom } from "@/utils/atoms";
import { persistVaultMutation } from "@/utils/vault-mutations";
import { joinTags, tagsToDisplay } from "@/utils/credential-search";
import { loadSSHKeyModule } from "@/utils/ssh-keys";
import { createSSHKeyTaskRunner } from "@/utils/ssh-key-worker";
import { pickSSHKeyFile, SSHKeyFileError } from "@/utils/ssh-key-files";
import { useUnlockedSnackbar } from "@/components/unlocked/unlocked-snackbar";
import { Separator } from "@/components/ui/separator";
import { InlineNotice } from "@/components/inline-notice";
import { useScrollToNode } from "@/components/keyboard-scroll";
import { Dialog, DialogHeader } from "@/components/ui/dialog";
import { colors } from "@/theme";

type KeySource = "generate" | "import";
type CheckInput = { text: string; publicKey: string };

const MONOSPACE = Platform.select({ android: "monospace", ios: "Menlo" });
const IMPORT_DELAY_MS = 500;

type SSHKeyFormProps = {
    existing: VaultCredential | null;
    initialDirectoryId?: string;
};

function SourceRow({
    title,
    subtitle,
    selected,
    onPress,
    testID,
}: {
    title: string;
    subtitle: string;
    selected: boolean;
    onPress: () => void;
    testID: string;
}) {
    return (
        <Pressable
            testID={testID}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected }}
            accessibilityLabel={`${title}, ${subtitle}`}
            android_ripple={{ color: colors.border }}
            onPress={onPress}
            style={{
                minHeight: 68,
                flexDirection: "row",
                alignItems: "center",
                gap: 14,
                borderBottomWidth: 1,
                borderBottomColor: colors.border,
            }}
        >
            <View
                style={{
                    width: 20,
                    height: 20,
                    borderRadius: 10,
                    borderWidth: 2,
                    borderColor: selected ? colors.primary : colors.muted,
                    alignItems: "center",
                    justifyContent: "center",
                }}
            >
                {selected ? (
                    <View
                        style={{
                            width: 10,
                            height: 10,
                            borderRadius: 5,
                            backgroundColor: colors.primary,
                        }}
                    />
                ) : null}
            </View>
            <View style={{ flex: 1, minWidth: 0, paddingVertical: 12 }}>
                <Text style={{ fontSize: 15 }}>{title}</Text>
                <Text
                    style={{ color: colors.muted, fontSize: 12, marginTop: 4 }}
                >
                    {subtitle}
                </Text>
            </View>
        </Pressable>
    );
}

/** Read-only facts about a key: type, fingerprint and optionally the public key. */
function KeyFacts({
    data,
    comment,
    showPublicKey = false,
    testID,
}: {
    data: Pick<SSHKeyData, "PublicKey">;
    comment: string;
    showPublicKey?: boolean;
    testID?: string;
}) {
    const info = describeSSHKey(data);
    const rows = [
        { label: "Type", value: info?.label ?? "Unknown" },
        { label: "Fingerprint", value: info?.fingerprint ?? "Unknown" },
        ...(showPublicKey
            ? [
                  {
                      label: "Public key",
                      value: sshPublicKeyLine({
                          PublicKey: data.PublicKey,
                          Comment: comment,
                      }),
                  },
              ]
            : []),
    ];
    return (
        <View
            testID={testID}
            style={{
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 6,
                backgroundColor: colors.navigation,
                paddingHorizontal: 14,
                paddingVertical: 4,
            }}
        >
            {rows.map((row, index) => (
                <View
                    key={row.label}
                    style={{
                        paddingVertical: 10,
                        borderTopWidth: index ? 1 : 0,
                        borderTopColor: colors.border,
                    }}
                >
                    <Text style={{ color: colors.muted, fontSize: 12 }}>
                        {row.label}
                    </Text>
                    <Text
                        selectable
                        numberOfLines={row.label === "Public key" ? 4 : 2}
                        style={{
                            marginTop: 4,
                            fontSize: 12,
                            lineHeight: 18,
                            fontFamily:
                                row.label === "Type" ? undefined : MONOSPACE,
                        }}
                    >
                        {row.value}
                    </Text>
                </View>
            ))}
        </View>
    );
}

/** Editor for SSH key items: generate or import when creating, details when editing. */
export function SSHKeyForm({
    existing,
    initialDirectoryId = "",
}: SSHKeyFormProps) {
    const confirm = useUnlockedConfirmation();
    const showSnackbar = useUnlockedSnackbar();
    const vault = useAtomValue(unlockedVaultAtom);
    const [openedRevision] = useState(() =>
        existing ? { version: existing.Version, hash: existing.Hash } : null,
    );
    const directories = useMemo(
        () => sortDirectories(vault.Directories),
        [vault.Directories],
    );

    const [source, setSource] = useState<KeySource>("generate");
    const [generated, setGenerated] = useState<SSHKeyData | null>(null);
    const [generateError, setGenerateError] = useState("");

    const [keyText, setKeyText] = useState("");
    const [publicKeyFile, setPublicKeyFile] = useState<{
        name: string;
        text: string;
    } | null>(null);
    const [imported, setImported] = useState<SSHKeyData | null>(null);
    const [importError, setImportError] = useState("");
    const [needsPassphrase, setNeedsPassphrase] = useState(false);
    const [passphrase, setPassphrase] = useState("");
    const [passphraseError, setPassphraseError] = useState("");
    // Import runs on a worker; "unlocking" when it derives a key from a passphrase.
    const [importBusy, setImportBusyState] = useState<
        "checking" | "unlocking" | null
    >(null);
    const importBusyRef = useRef(importBusy);
    const setImportBusy = useCallback(
        (value: "checking" | "unlocking" | null) => {
            importBusyRef.current = value;
            setImportBusyState(value);
        },
        [],
    );
    const unlocking = importBusy === "unlocking";
    const [importer] = useState(createSSHKeyTaskRunner);
    // Latest key text and .pub, for picks that finish after a render.
    const input = useRef<CheckInput>({ text: "", publicKey: "" });
    // Input of the scheduled or running check, and of the shown result.
    const pending = useRef<CheckInput | null>(null);
    const settled = useRef<CheckInput | null>(null);
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    // The passphrase that opened (or is opening) this key text, reused when
    // only the .pub file changes.
    const remembered = useRef<{ text: string; passphrase: string } | null>(
        null,
    );
    const scrollToNode = useScrollToNode();
    // The key field is tall, so bring the prompt and the result into view.
    const passphraseBlock = useRef<View>(null);
    const importedBlock = useRef<View>(null);

    const [name, setName] = useState(existing?.Name ?? "");
    // Generated keys use the item name until the comment is edited.
    const [generatedComment, setGeneratedComment] = useState<string | null>(
        null,
    );
    const [importedComment, setImportedComment] = useState("");
    const [existingComment, setExistingComment] = useState(
        existing?.SSHKey?.Comment ?? "",
    );
    const [directoryId, setDirectoryId] = useState(
        existing?.DirectoryID ?? initialDirectoryId,
    );
    const [notes, setNotes] = useState(existing?.Notes ?? "");
    const [tagsText, setTagsText] = useState(tagsToDisplay(existing?.Tags));
    // An SSH key has few fields, so Tags and Notes start open.
    const [moreDetailsOpen, setMoreDetailsOpen] = useState(true);
    const [directoryPickerOpen, setDirectoryPickerOpen] = useState(false);
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
    const markDirty = () => setDirty(true);

    const comment = existing
        ? existingComment
        : source === "generate"
          ? (generatedComment ?? name.trim())
          : importedComment;
    const setComment = (value: string) => {
        markDirty();
        if (existing) setExistingComment(value);
        else if (source === "generate") setGeneratedComment(value);
        else setImportedComment(value);
    };

    useEffect(() => {
        if (existing) return;
        let active = true;
        loadSSHKeyModule()
            .then((sshKeys) => {
                if (active) setGenerated(sshKeys.generateSSHKey(""));
            })
            .catch(() => {
                if (active)
                    setGenerateError("A new key could not be generated.");
            });
        return () => {
            active = false;
        };
    }, [existing]);

    const runImport = useCallback(
        async (text: string, publicKey: string, keyPassphrase?: string) => {
            // Superseded runs never resolve, so this result is current.
            const result = await importer.run({
                kind: "import",
                text,
                passphrase: keyPassphrase,
                publicKey: publicKey || undefined,
            });
            pending.current = null;
            setImportBusy(null);
            if (result.ok) {
                if (result.kind !== "import") return;
                settled.current = { text, publicKey };
                remembered.current = keyPassphrase
                    ? { text, passphrase: keyPassphrase }
                    : null;
                setImported(result.data);
                setImportedComment(result.data.Comment);
                setImportError("");
                setPassphrase("");
                setPassphraseError("");
                return;
            }
            setImported(null);
            const { code, message } = result;
            if (code === "passphrase-required") {
                settled.current = { text, publicKey };
                setNeedsPassphrase(true);
                setImportError("");
            } else if (code === "wrong-passphrase") {
                settled.current = { text, publicKey };
                remembered.current = null;
                setNeedsPassphrase(true);
                setPassphraseError(message);
            } else {
                settled.current = null;
                setImportError(message);
            }
        },
        [importer, setImportBusy],
    );

    const cancelCheck = useCallback(() => {
        clearTimeout(timer.current);
        timer.current = undefined;
        pending.current = null;
        importer.cancel();
    }, [importer]);
    useEffect(() => cancelCheck, [cancelCheck]);

    /**
     * The only way a key check starts. It sets the busy state and schedules
     * the run in one step, so the form is never busy without a run behind it.
     * Input that matches the shown result, or the run already on its way, is
     * left alone, so an unlocked key stays unlocked.
     */
    const requestCheck = useCallback(
        ({
            text,
            publicKey,
            passphrase: keyPassphrase,
            delayMs = 0,
        }: {
            text: string;
            publicKey: string;
            passphrase?: string;
            delayMs?: number;
        }) => {
            const same = (other: CheckInput | null) =>
                !!other &&
                other.text === text &&
                other.publicKey === publicKey;
            if (!keyPassphrase && same(pending.current)) return;
            cancelCheck();
            if (!text.trim()) {
                settled.current = null;
                remembered.current = null;
                setImportBusy(null);
                setImported(null);
                setImportError("");
                setNeedsPassphrase(false);
                return;
            }
            if (!keyPassphrase && same(settled.current)) {
                setImportBusy(null);
                setImportError("");
                return;
            }
            if (keyPassphrase)
                remembered.current = { text, passphrase: keyPassphrase };
            // Reuse the passphrase that opened (or is opening) this key text.
            const usePassphrase =
                keyPassphrase ??
                (remembered.current?.text === text
                    ? remembered.current.passphrase
                    : undefined);
            pending.current = { text, publicKey };
            setImportBusy(usePassphrase ? "unlocking" : "checking");
            const start = () => {
                timer.current = undefined;
                void runImport(text, publicKey, usePassphrase);
            };
            if (delayMs > 0) timer.current = setTimeout(start, delayMs);
            else start();
        },
        [cancelCheck, runImport, setImportBusy],
    );

    const showPassphrase = needsPassphrase && !imported;
    useEffect(() => {
        if (!showPassphrase) return;
        requestAnimationFrame(() => scrollToNode(passphraseBlock.current, 48));
    }, [scrollToNode, showPassphrase]);
    useEffect(() => {
        if (!imported) return;
        requestAnimationFrame(() => scrollToNode(importedBlock.current, 48));
    }, [imported, scrollToNode]);

    const changeKeyText = (value: string, delayMs: number) => {
        if (value !== input.current.text) {
            markDirty();
            input.current = { ...input.current, text: value };
            settled.current = null;
            remembered.current = null;
            setKeyText(value);
            setImported(null);
            setNeedsPassphrase(false);
            setPassphrase("");
            setPassphraseError("");
        }
        requestCheck({ ...input.current, delayMs });
    };

    const changePublicKeyFile = (file: typeof publicKeyFile) => {
        if ((file?.text ?? "") !== input.current.publicKey) markDirty();
        input.current = { ...input.current, publicKey: file?.text ?? "" };
        setPublicKeyFile(file);
        requestCheck(input.current);
    };

    const changeSource = (value: KeySource) => {
        if (value === source) return;
        setSource(value);
        if (value === "import") {
            requestCheck(input.current);
        } else {
            cancelCheck();
            setImportBusy(null);
        }
    };

    const chooseFile = async (kind: "private" | "public") => {
        try {
            const file = await pickSSHKeyFile();
            if (!file) return;
            if (kind === "private") changeKeyText(file.text, 0);
            else changePublicKeyFile(file);
        } catch (pickError) {
            const message =
                pickError instanceof SSHKeyFileError
                    ? pickError.message
                    : "The file could not be opened.";
            if (kind === "private") setImportError(message);
            else showSnackbar(message);
        }
    };

    const unlock = () => {
        if (importBusyRef.current === "unlocking") return;
        if (!passphrase) {
            setPassphraseError("Enter the passphrase for this key.");
            return;
        }
        setPassphraseError("");
        requestCheck({ ...input.current, passphrase });
    };

    const handleSave = async () => {
        if (saving.current) return;
        if (importBusyRef.current) return;
        if (!name.trim()) {
            setError("Name is required.");
            return;
        }
        const key = existing
            ? existing.SSHKey
            : source === "generate"
              ? generated
              : imported;
        if (!key) {
            setError(
                source === "generate"
                    ? "The new key isn't ready yet."
                    : needsPassphrase
                      ? "Unlock the key with its passphrase first."
                      : "Paste a private key or choose a key file.",
            );
            return;
        }
        saving.current = true;
        setLoading(true);
        setError("");
        const formResult = CredentialFormSchema.safeParse({
            ID: existing?.ID ?? null,
            Type: ItemType.SSHKey,
            DirectoryID: directoryId,
            Name: name.trim(),
            Username: "",
            Password: "",
            URL: "",
            URLMatchMode: CredentialURLMatchMode.ExactHost,
            AdditionalURLs: [],
            Passkey: null,
            SSHKey: { ...key, Comment: comment.trim() },
            Notes: notes,
            Tags: joinTags(
                tagsText
                    .split(",")
                    .map((tag) => tag.trim())
                    .filter(Boolean),
            ),
            TOTP: null,
            CustomFields: existing?.CustomFields ?? [],
        });
        if (!formResult.success) {
            saving.current = false;
            setLoading(false);
            setError(formResult.error.issues[0]?.message ?? "Invalid SSH key.");
            return;
        }
        const form = formResult.data;
        let conflict = false;
        const result = await persistVaultMutation(
            "credential.upsert",
            async (currentVault) => {
                const updatedVault = Object.assign(new Vault(), currentVault);
                updatedVault.Credentials = [...currentVault.Credentials];
                const existingIndex = form.ID
                    ? updatedVault.Credentials.findIndex(
                          (item) => item.ID === form.ID && !item.Deleted,
                      )
                    : -1;
                const current =
                    existingIndex >= 0
                        ? updatedVault.Credentials[existingIndex]
                        : undefined;
                if (form.ID && !current)
                    throw new Error("CREDENTIAL_NOT_FOUND");
                if (
                    current &&
                    openedRevision &&
                    (current.Version !== openedRevision.version ||
                        current.Hash !== openedRevision.hash)
                ) {
                    conflict = true;
                    throw new Error("CREDENTIAL_EDIT_CONFLICT");
                }
                const saved = current
                    ? await updateCredentialFromForm(current, form)
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
            setError(
                conflict
                    ? "This item changed while you were editing. Your edits are still here. Cancel editing and reopen the item before saving."
                    : "Failed to save SSH key.",
            );
            return;
        }
        setDirty(false);
        // The item is saved either way; only move on if the user is still here.
        if (left.current) return;
        if (existing) router.back();
        else router.replace(`/(app)/(tabs)/vault/${result.value.ID}`);
    };

    const requestCancel = useCallback(() => {
        // Leaving now would let the finished save navigate from another screen.
        if (saving.current) return;
        if (!dirty) {
            router.back();
            return;
        }
        confirm({
            title: "Discard changes?",
            description: "Your unsaved changes will be lost.",
            cancelLabel: "Keep editing",
            confirmLabel: "Discard",
            onConfirm: () => {
                if (!saving.current) router.back();
            },
        });
    }, [confirm, dirty]);

    return (
        <UnlockedTaskScreen
            title={existing ? "Edit SSH key" : "Add SSH key"}
            backLabel="Cancel editing"
            onBack={requestCancel}
            footer={
                <Button
                    className="h-[54px] min-h-[54px]"
                    textClassName="text-[#111520]"
                    loading={loading}
                    loadingLabel="Saving…"
                    disabled={!!importBusy}
                    onPress={() => void handleSave()}
                    testID="ssh-key-submit"
                >
                    Save item
                </Button>
            }
        >
            <View className="gap-4">
                {existing?.SSHKey ? (
                    <View className="gap-2">
                        <KeyFacts
                            data={existing.SSHKey}
                            comment={comment}
                            showPublicKey
                        />
                        <Text className="text-xs text-muted-foreground">
                            The key itself can't be changed. To use a different
                            key, add a new SSH key item.
                        </Text>
                    </View>
                ) : (
                    <View>
                        <View
                            accessibilityRole="radiogroup"
                            style={{
                                borderTopWidth: 1,
                                borderTopColor: colors.border,
                            }}
                        >
                            <SourceRow
                                testID="ssh-key-source-generate"
                                title="Generate a new key"
                                subtitle="Ed25519, the recommended type"
                                selected={source === "generate"}
                                onPress={() => changeSource("generate")}
                            />
                            <SourceRow
                                testID="ssh-key-source-import"
                                title="Use an existing key"
                                subtitle="Paste it or choose the key file"
                                selected={source === "import"}
                                onPress={() => changeSource("import")}
                            />
                        </View>
                        <View className="mt-4 gap-3">
                            {source === "generate" ? (
                                generated ? (
                                    <KeyFacts
                                        testID="ssh-key-generated"
                                        data={generated}
                                        comment={comment}
                                        showPublicKey
                                    />
                                ) : generateError ? (
                                    <InlineNotice
                                        tone="error"
                                        message={generateError}
                                    />
                                ) : (
                                    <InlineNotice
                                        tone="loading"
                                        message="Generating a key…"
                                    />
                                )
                            ) : (
                                <>
                                    <View>
                                        <Label>Private key</Label>
                                        <Input
                                            value={keyText}
                                            onChangeText={(value) =>
                                                changeKeyText(
                                                    value,
                                                    IMPORT_DELAY_MS,
                                                )
                                            }
                                            multiline
                                            textAlignVertical="top"
                                            autoCapitalize="none"
                                            autoCorrect={false}
                                            spellCheck={false}
                                            importantForAutofill="no"
                                            placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                                            accessibilityLabel="Private key"
                                            testID="ssh-key-private-key"
                                            style={{
                                                minHeight: 150,
                                                maxHeight: 200,
                                                fontFamily: MONOSPACE,
                                                fontSize: 12,
                                                lineHeight: 17,
                                            }}
                                        />
                                    </View>
                                    {importBusy && !showPassphrase ? (
                                        <InlineNotice
                                            tone="loading"
                                            message={
                                                unlocking
                                                    ? "Unlocking…"
                                                    : "Checking key…"
                                            }
                                            testID="ssh-key-import-busy"
                                        />
                                    ) : importError ? (
                                        <InlineNotice
                                            tone="error"
                                            message={importError}
                                            autoScroll
                                            testID="ssh-key-import-error"
                                        />
                                    ) : null}
                                    <View className="flex-row gap-2">
                                        <Button
                                            className="flex-1"
                                            variant="secondary"
                                            accessibilityLabel="Choose key file"
                                            onPress={() =>
                                                void chooseFile("private")
                                            }
                                        >
                                            <FileKey
                                                size={16}
                                                color={colors.foreground}
                                            />
                                            <Text className="text-sm text-secondary-foreground">
                                                Choose file
                                            </Text>
                                        </Button>
                                        <Button
                                            className="flex-1"
                                            variant="secondary"
                                            accessibilityLabel="Add .pub file"
                                            // Changing it would restart the unlock.
                                            disabled={unlocking}
                                            onPress={() =>
                                                void chooseFile("public")
                                            }
                                        >
                                            <FileUp
                                                size={16}
                                                color={colors.foreground}
                                            />
                                            <Text className="text-sm text-secondary-foreground">
                                                Add .pub file
                                            </Text>
                                        </Button>
                                    </View>
                                    {publicKeyFile ? (
                                        <View className="min-h-[48px] flex-row items-center gap-2">
                                            <Text
                                                numberOfLines={1}
                                                className="flex-1 text-xs text-muted-foreground"
                                            >
                                                Public key from{" "}
                                                {publicKeyFile.name}
                                            </Text>
                                            <Pressable
                                                accessibilityRole="button"
                                                accessibilityLabel="Remove .pub file"
                                                disabled={unlocking}
                                                onPress={() =>
                                                    changePublicKeyFile(null)
                                                }
                                                style={{
                                                    width: 48,
                                                    height: 48,
                                                    alignItems: "center",
                                                    justifyContent: "center",
                                                }}
                                            >
                                                <X
                                                    size={18}
                                                    color={colors.muted}
                                                />
                                            </Pressable>
                                        </View>
                                    ) : null}
                                    {showPassphrase ? (
                                        <View
                                            ref={passphraseBlock}
                                            collapsable={false}
                                            className="gap-3"
                                        >
                                            <View>
                                                <Label>Passphrase</Label>
                                                <Input
                                                    value={passphrase}
                                                    onChangeText={(value) => {
                                                        setPassphrase(value);
                                                        setPassphraseError("");
                                                    }}
                                                    secureTextEntry
                                                    revealButtonHeight={54}
                                                    className="h-[54px]"
                                                    autoCapitalize="none"
                                                    autoCorrect={false}
                                                    importantForAutofill="no"
                                                    editable={!unlocking}
                                                    returnKeyType="go"
                                                    onSubmitEditing={unlock}
                                                    accessibilityLabel="Key passphrase"
                                                    testID="ssh-key-passphrase"
                                                />
                                                <Text className="mt-1 text-xs text-muted-foreground">
                                                    Only used to open the key.
                                                    It isn't saved.
                                                </Text>
                                            </View>
                                            {passphraseError ? (
                                                <InlineNotice
                                                    tone="error"
                                                    message={passphraseError}
                                                    autoScroll
                                                />
                                            ) : null}
                                            <Button
                                                variant="secondary"
                                                loading={unlocking}
                                                loadingLabel="Unlocking…"
                                                onPress={unlock}
                                            >
                                                Unlock
                                            </Button>
                                        </View>
                                    ) : null}
                                    {imported ? (
                                        <View
                                            ref={importedBlock}
                                            collapsable={false}
                                        >
                                            <KeyFacts
                                                testID="ssh-key-imported"
                                                data={imported}
                                                comment={comment}
                                            />
                                        </View>
                                    ) : null}
                                </>
                            )}
                        </View>
                    </View>
                )}

                <View>
                    <Label>
                        Name <Text className="text-destructive">*</Text>
                    </Label>
                    <Input
                        value={name}
                        onChangeText={(value) => {
                            markDirty();
                            setName(value);
                        }}
                        placeholder="e.g., Work laptop"
                        accessibilityLabel="SSH key name"
                        autoCapitalize="sentences"
                    />
                </View>

                <View>
                    <Label>Comment</Label>
                    <Input
                        value={comment}
                        onChangeText={setComment}
                        placeholder="e.g., you@laptop"
                        accessibilityLabel="SSH key comment"
                        autoCapitalize="none"
                        autoCorrect={false}
                    />
                    <Text className="mt-1 text-xs text-muted-foreground">
                        Added to the end of the public key.
                    </Text>
                </View>

                <View>
                    <Label>Directory</Label>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Choose directory"
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
                                ?.Name || "No directory"}
                        </Text>
                        <ChevronRight size={18} color={colors.muted} />
                    </Pressable>
                </View>

                <Separator />
                <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ expanded: moreDetailsOpen }}
                    onPress={() => setMoreDetailsOpen((current) => !current)}
                    className="min-h-[54px] flex-row items-center"
                >
                    <Text className="flex-1 text-sm text-foreground">
                        More details
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
                            <Label>Tags</Label>
                            <Input
                                value={tagsText}
                                onChangeText={(value) => {
                                    markDirty();
                                    setTagsText(value);
                                }}
                                placeholder="work, personal"
                                autoCapitalize="none"
                            />
                            <Text className="mt-1 text-xs text-muted-foreground">
                                Comma-separated. Search with
                                tag:&quot;work&quot;.
                            </Text>
                        </View>
                        <View>
                            <Label>Notes</Label>
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
                open={directoryPickerOpen}
                onOpenChange={setDirectoryPickerOpen}
                placement="bottom"
            >
                <DialogHeader>
                    <DialogTitle>Choose directory</DialogTitle>
                </DialogHeader>
                {[{ ID: "", Name: "No directory" }, ...directories].map(
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
        </UnlockedTaskScreen>
    );
}
