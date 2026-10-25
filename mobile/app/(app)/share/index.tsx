import { useCallback, useMemo, useState } from "react";
import { Share, View } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useAtomValue } from "jotai";
import { ShareClient } from "@cryptex-industries/vault-core/vault-utils/share-client";
import {
    SHARE_EXPIRY_OPTIONS,
    defaultShareExpiry,
    shareExpiryOptions,
    type ShareExpiryOption,
    type SharePayload,
} from "@cryptex-industries/vault-core/vault-utils/share-link";
import { describeShareError } from "@cryptex-industries/vault-core/vault-utils/share-messages";
import {
    buildCredentialSharePayload,
    buildTextSharePayload,
    defaultCredentialShareSelection,
    type CredentialShareSelection,
} from "@cryptex-industries/vault-core/vault-utils/share-payload";
import {
    createShareLink,
    resolveShareServer,
} from "@cryptex-industries/vault-core/vault-utils/share-service";

import { Snackbar, useSnackbar } from "@/components/snackbar";
import { InlineNotice } from "@/components/inline-notice";
import { SegmentedControl } from "@/components/segmented-control";
import { Switch } from "@/components/ui/switch";
import {
    UnlockedButton as Button,
    UnlockedInput as Input,
    UnlockedLabel as Label,
    UnlockedTaskScreen,
    UnlockedText as Text,
} from "@/components/unlocked/unlocked-ui";
import {
    hasOnlineServicesSharing,
    mobileShareDeps,
} from "@/app_lib/share-links";
import { unlockedVaultAtom } from "@/utils/atoms";
import { copySecretToClipboard } from "@/utils/clipboard";
import { runSSHKeyTaskOnWorker } from "@/utils/ssh-key-worker";
import { colors } from "@/theme";

type ServerState =
    | "checking"
    | "ready"
    | "needs-account"
    | "needs-token"
    | "unreachable";

const toSegments = (options: ShareExpiryOption[]) =>
    options.map((option) => ({
        value: String(option.seconds),
        label: option.label
            .replace(/ hours?/, "h")
            .replace(/ days?/, "d")
            .replace(/ minutes?/, "m"),
        accessibilityLabel: option.label,
    }));

function SwitchRow({
    label,
    hint,
    value,
    onValueChange,
}: {
    label: string;
    hint?: string;
    value: boolean;
    onValueChange: (value: boolean) => void;
}) {
    return (
        <View
            style={{
                minHeight: hint ? 70 : 56,
                paddingVertical: 12,
                flexDirection: "row",
                alignItems: "center",
                borderBottomWidth: 1,
                borderBottomColor: colors.border,
            }}
        >
            <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={{ fontSize: 14 }}>{label}</Text>
                {hint ? (
                    <Text
                        style={{
                            color: colors.muted,
                            fontSize: 12,
                            lineHeight: 18,
                            marginTop: 5,
                        }}
                    >
                        {hint}
                    </Text>
                ) : null}
            </View>
            <Switch
                value={value}
                onValueChange={onValueChange}
                accessibilityLabel={label}
            />
        </View>
    );
}

export default function ShareScreen() {
    const { id } = useLocalSearchParams<{ id?: string }>();
    const vault = useAtomValue(unlockedVaultAtom);
    const credential = useMemo(
        () =>
            id
                ? vault.Credentials.find(
                      (item) => item.ID === id && !item.Deleted,
                  )
                : undefined,
        [id, vault.Credentials],
    );
    const [selection, setSelection] = useState<CredentialShareSelection>(
        defaultCredentialShareSelection,
    );
    const [text, setText] = useState("");
    const [label, setLabel] = useState("");
    const [expiry, setExpiry] = useState(
        String(SHARE_EXPIRY_OPTIONS[1].seconds),
    );
    const [expirySegments, setExpirySegments] = useState(() =>
        toSegments(SHARE_EXPIRY_OPTIONS.map((option) => ({ ...option }))),
    );
    const [usePassphrase, setUsePassphrase] = useState(false);
    const [passphrase, setPassphrase] = useState("");
    const [server, setServer] = useState<ServerState>("checking");
    const [error, setError] = useState("");
    const [creating, setCreating] = useState(false);
    const [link, setLink] = useState("");
    // Whether the created link needs a passphrase, whatever the form shows now.
    const [linkPassphrase, setLinkPassphrase] = useState(false);
    const [copied, setCopied] = useState(false);
    const { feedback, show, dismiss } = useSnackbar("share");

    // Re-check when returning from the share server screen.
    useFocusEffect(
        useCallback(() => {
            let cancelled = false;
            setServer("checking");
            void (async () => {
                const deps = mobileShareDeps();
                try {
                    const { origin, creationToken } = resolveShareServer(
                        await deps.store.getShareSettings(),
                        deps.defaultOrigin,
                    );
                    const info = await new ShareClient(origin).info();
                    if (cancelled) return;
                    // Offer only what this server keeps.
                    const options = shareExpiryOptions(info.maxTtl);
                    setExpirySegments(toSegments(options));
                    setExpiry((value) =>
                        options.some(
                            (option) => String(option.seconds) === value,
                        )
                            ? value
                            : String(defaultShareExpiry(options)),
                    );
                    if (info.auth === "ticket") {
                        setServer(
                            deps.getTicket &&
                                hasOnlineServicesSharing() !== false
                                ? "ready"
                                : "needs-account",
                        );
                    } else {
                        setServer(creationToken ? "ready" : "needs-token");
                    }
                } catch {
                    if (!cancelled) setServer("unreachable");
                }
            })();
            return () => {
                cancelled = true;
            };
        }, []),
    );

    const payload = useMemo((): SharePayload | null => {
        try {
            if (credential) {
                return buildCredentialSharePayload(credential, selection);
            }
            return text.trim() ? buildTextSharePayload(text) : null;
        } catch {
            return null;
        }
    }, [credential, selection, text]);

    // Copy and reveal in the app give the OpenSSH file with the current
    // comment, so the link carries the same text.
    const withExportedSSHKey = async (
        built: SharePayload,
    ): Promise<SharePayload> => {
        const sshKey = credential?.SSHKey;
        if (!credential || !sshKey || !selection.sshPrivateKey) return built;
        const result = await runSSHKeyTaskOnWorker({
            kind: "export",
            data: sshKey,
        });
        if (!result.ok || result.kind !== "export") {
            throw new Error("SSH_KEY_EXPORT_FAILED");
        }
        return buildCredentialSharePayload(
            { ...credential, SSHKey: { ...sshKey, PrivateKey: result.text } },
            selection,
        );
    };

    const create = async () => {
        if (!payload) return;
        if (usePassphrase && !passphrase) {
            setError("Enter a passphrase or turn it off.");
            return;
        }
        setError("");
        setCreating(true);
        try {
            const created = await createShareLink(mobileShareDeps(), {
                payload: await withExportedSSHKey(payload),
                label: (credential ? credential.Name : label).trim(),
                credentialId: credential?.ID ?? "",
                ttlSeconds: Number(expiry),
                passphrase: usePassphrase ? passphrase : undefined,
            });
            setLinkPassphrase(created.record.Passphrase);
            setLink(created.link);
            setText("");
            setPassphrase("");
        } catch (err) {
            show(describeShareError(err));
        } finally {
            setCreating(false);
        }
    };

    const toggle = (
        key: Exclude<keyof CredentialShareSelection, "customFieldIds">,
    ) => setSelection((current) => ({ ...current, [key]: !current[key] }));

    const title = credential ? "Share once" : "Share a secret";

    if (link) {
        return (
            <UnlockedTaskScreen
                title={title}
                footer={
                    <View style={{ gap: 10 }}>
                        <Snackbar
                            feedback={feedback}
                            onDismiss={dismiss}
                            floating={false}
                        />
                        <Button
                            onPress={() =>
                                void Share.share({ message: link }).catch(() =>
                                    show("Couldn't open the share sheet."),
                                )
                            }
                        >
                            Send link
                        </Button>
                        <Button variant="outline" onPress={() => router.back()}>
                            Done
                        </Button>
                    </View>
                }
            >
                <View style={{ gap: 16 }}>
                    <Text style={{ fontSize: 20, fontWeight: "600" }}>
                        Link created
                    </Text>
                    <View
                        style={{
                            borderWidth: 1,
                            borderColor: colors.border,
                            borderRadius: 10,
                            padding: 14,
                        }}
                    >
                        <Text
                            selectable
                            style={{ fontFamily: "monospace", fontSize: 13 }}
                        >
                            {link}
                        </Text>
                    </View>
                    <Button
                        variant="outline"
                        onPress={() =>
                            void copySecretToClipboard(link).then((ok) => {
                                setCopied(ok);
                                if (!ok) show("Couldn't copy the link.");
                            })
                        }
                    >
                        {copied ? "Copied" : "Copy link"}
                    </Button>
                    <Text style={{ color: colors.muted, lineHeight: 21 }}>
                        Send it now. Cryptex Vault can&apos;t show this link
                        again. It works once and expires if nobody opens it in
                        time.
                        {linkPassphrase
                            ? " Send the passphrase separately from the link."
                            : ""}
                    </Text>
                </View>
            </UnlockedTaskScreen>
        );
    }

    return (
        <UnlockedTaskScreen
            title={title}
            footer={
                server === "ready" ? (
                    <View style={{ gap: 10 }}>
                        <Snackbar
                            feedback={feedback}
                            onDismiss={dismiss}
                            floating={false}
                        />
                        <Button
                            disabled={creating || !payload}
                            onPress={() => void create()}
                        >
                            {creating ? "Creating…" : "Create link"}
                        </Button>
                    </View>
                ) : null
            }
        >
            {/* Nothing can change while the link is being created. */}
            <View
                style={{ gap: 18 }}
                pointerEvents={creating ? "none" : "auto"}
            >
                <Text style={{ color: colors.muted, lineHeight: 21 }}>
                    The link opens once, then it&apos;s gone. It&apos;s
                    encrypted on this phone and the key stays in the link, so
                    the server can&apos;t read it.
                </Text>

                {server === "checking" ? (
                    <InlineNotice
                        tone="loading"
                        message="Checking the share server…"
                    />
                ) : server === "needs-account" ? (
                    <View style={{ gap: 12 }}>
                        <InlineNotice
                            tone="info"
                            message={
                                mobileShareDeps().getTicket
                                    ? "Share links on the Cryptex Vault server are part of Online Services. You can also use your own share server."
                                    : "Sign in to Online Services to share links from the Cryptex Vault server, or use your own share server."
                            }
                        />
                        <Button
                            variant="outline"
                            onPress={() => router.push("/(app)/share/server")}
                        >
                            Use a self-hosted server
                        </Button>
                    </View>
                ) : server === "needs-token" || server === "unreachable" ? (
                    <View style={{ gap: 12 }}>
                        <InlineNotice
                            tone={server === "unreachable" ? "error" : "info"}
                            message={
                                server === "unreachable"
                                    ? "Can't reach the share server. Check the address or your connection."
                                    : "This share server needs a creation token from its operator."
                            }
                        />
                        <Button
                            variant="outline"
                            onPress={() => router.push("/(app)/share/server")}
                        >
                            Share server settings
                        </Button>
                    </View>
                ) : (
                    <>
                        {credential ? (
                            <View>
                                <Label>Include</Label>
                                <SwitchRow
                                    label="Name"
                                    hint={credential.Name || "Untitled"}
                                    value={selection.name}
                                    onValueChange={() => toggle("name")}
                                />
                                {credential.SSHKey ? (
                                    <>
                                        <SwitchRow
                                            label="Private key"
                                            hint="Anyone who opens the link can use this key on every server that accepts it."
                                            value={selection.sshPrivateKey}
                                            onValueChange={() =>
                                                toggle("sshPrivateKey")
                                            }
                                        />
                                        <SwitchRow
                                            label="Public key"
                                            value={selection.sshPublicKey}
                                            onValueChange={() =>
                                                toggle("sshPublicKey")
                                            }
                                        />
                                    </>
                                ) : null}
                                {credential.Username ? (
                                    <SwitchRow
                                        label="Username"
                                        value={selection.username}
                                        onValueChange={() => toggle("username")}
                                    />
                                ) : null}
                                {credential.Password ? (
                                    <SwitchRow
                                        label="Password"
                                        value={selection.password}
                                        onValueChange={() => toggle("password")}
                                    />
                                ) : null}
                                {credential.URL ||
                                credential.AdditionalURLs.length > 0 ? (
                                    <SwitchRow
                                        label="Website"
                                        value={selection.url}
                                        onValueChange={() => toggle("url")}
                                    />
                                ) : null}
                                {credential.TOTP?.Secret ? (
                                    <SwitchRow
                                        label="One-time code setup"
                                        hint="Gives them the TOTP secret, so they can keep generating codes."
                                        value={selection.totp}
                                        onValueChange={() => toggle("totp")}
                                    />
                                ) : null}
                                {credential.CustomFields.map((field) => (
                                    <SwitchRow
                                        key={field.ID}
                                        label={field.Name || "Custom field"}
                                        value={selection.customFieldIds.includes(
                                            field.ID,
                                        )}
                                        onValueChange={(on) =>
                                            setSelection((current) => ({
                                                ...current,
                                                customFieldIds: on
                                                    ? [
                                                          ...current.customFieldIds,
                                                          field.ID,
                                                      ]
                                                    : current.customFieldIds.filter(
                                                          (entry) =>
                                                              entry !==
                                                              field.ID,
                                                      ),
                                            }))
                                        }
                                    />
                                ))}
                                {credential.Notes ? (
                                    <SwitchRow
                                        label="Notes"
                                        value={selection.notes}
                                        onValueChange={() => toggle("notes")}
                                    />
                                ) : null}
                                {credential.Passkey ? (
                                    <Text
                                        style={{
                                            color: colors.muted,
                                            fontSize: 12,
                                            lineHeight: 18,
                                            marginTop: 10,
                                        }}
                                    >
                                        The passkey stays in your vault.
                                    </Text>
                                ) : null}
                            </View>
                        ) : (
                            <>
                                <View style={{ gap: 8 }}>
                                    <Label>Secret</Label>
                                    <Input
                                        value={text}
                                        onChangeText={setText}
                                        multiline
                                        numberOfLines={5}
                                        autoCapitalize="none"
                                        autoCorrect={false}
                                        placeholder="Paste a password, API key or note"
                                        style={{
                                            minHeight: 120,
                                            textAlignVertical: "top",
                                        }}
                                    />
                                </View>
                                <View style={{ gap: 8 }}>
                                    <Label>Label (only you see this)</Label>
                                    <Input
                                        value={label}
                                        onChangeText={setLabel}
                                        maxLength={100}
                                        placeholder="Wi-Fi for Sam"
                                    />
                                </View>
                            </>
                        )}

                        <View style={{ gap: 8 }}>
                            <Label>Expires if not opened within</Label>
                            <SegmentedControl
                                segments={expirySegments}
                                value={expiry}
                                onChange={setExpiry}
                            />
                        </View>

                        <View style={{ gap: 8 }}>
                            <SwitchRow
                                label="Require a passphrase"
                                hint="Send it another way, for example by phone. Five wrong tries destroy the link."
                                value={usePassphrase}
                                onValueChange={setUsePassphrase}
                            />
                            {usePassphrase ? (
                                <>
                                    <Input
                                        value={passphrase}
                                        onChangeText={setPassphrase}
                                        secureTextEntry
                                        autoCapitalize="none"
                                        autoCorrect={false}
                                        placeholder="Passphrase"
                                    />
                                </>
                            ) : null}
                        </View>

                        {error ? (
                            <InlineNotice tone="error" message={error} />
                        ) : null}
                    </>
                )}
            </View>
        </UnlockedTaskScreen>
    );
}
