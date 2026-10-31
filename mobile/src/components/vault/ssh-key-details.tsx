import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { Download } from "lucide-react-native";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";

import {
    isWeakSSHKey,
    sshKeyFileName,
    sshPublicKeyLine,
} from "@cryptex-industries/vault-core/vault-utils/ssh-key-info";
import type { VaultCredential } from "@cryptex-industries/vault-core/vault-utils/vault";
import {
    UnlockedButton as Button,
    UnlockedDialogTitle as DialogTitle,
    UnlockedInput as Input,
    UnlockedLabel as Label,
    UnlockedText as Text,
} from "@/components/unlocked/unlocked-ui";
import { useUnlockedSnackbar } from "@/components/unlocked/unlocked-snackbar";
import {
    Dialog,
    DialogDescription,
    DialogHeader,
} from "@/components/ui/dialog";
import { IconButton } from "@/components/icon-button";
import { InlineNotice } from "@/components/inline-notice";
import { CopyableField } from "@/components/vault/copyable-field";
import { sshKeyInfo } from "@/utils/ssh-keys";
import { createSSHKeyTaskRunner } from "@/utils/ssh-key-worker";
import { shareSSHKeyFile } from "@/utils/ssh-key-files";
import { useSecretRelease } from "@/utils/secret-release";
import { colors } from "@/theme";

const SHARE_UNAVAILABLE = msg`Sharing isn't available on this device.`;
const SAVE_FAILED = msg`The key file could not be saved.`;
const LOAD_FAILED = msg`The private key could not be loaded.`;

/** Public key, fingerprint, type, comment and private key of an SSH key item. */
export function SSHKeyDetails({ credential }: { credential: VaultCredential }) {
    const { t } = useLingui();
    const showSnackbar = useUnlockedSnackbar();
    const data = credential.SSHKey;
    const info = sshKeyInfo(credential);
    // The stored key with its current comment, read on the key worker.
    const [privateKey, setPrivateKey] = useState<
        { text: string } | "loading" | "error"
    >("loading");
    const [saveOpen, setSaveOpen] = useState(false);
    const [loader] = useState(createSSHKeyTaskRunner);
    useEffect(() => () => loader.cancel(), [loader]);

    const loadPrivateKey = useCallback(async () => {
        if (!data) return;
        setPrivateKey("loading");
        const result = await loader.run({ kind: "export", data });
        setPrivateKey(
            result.ok && result.kind === "export"
                ? { text: result.text }
                : "error",
        );
    }, [data, loader]);
    useEffect(() => {
        void loadPrivateKey();
    }, [loadPrivateKey]);

    if (!data) {
        return (
            <InlineNotice
                tone="error"
                className="mb-3"
                message={t`This SSH key's data is missing.`}
            />
        );
    }

    const fileName = sshKeyFileName(credential.Name);
    const publicLine = sshPublicKeyLine(data);
    const copyFailed = () => showSnackbar(t`Couldn't copy to the clipboard.`);

    const savePublicKey = async () => {
        try {
            const shared = await shareSSHKeyFile(
                `${fileName}.pub`,
                `${publicLine}\n`,
                { mimeType: "text/plain", dialogTitle: t`Save public key` },
            );
            if (shared === "unavailable") showSnackbar(t(SHARE_UNAVAILABLE));
        } catch {
            showSnackbar(t(SAVE_FAILED));
        }
    };

    return (
        <View>
            <CopyableField
                label={t`Private key`}
                value={typeof privateKey === "object" ? privateKey.text : ""}
                secret
                onCopyFailed={copyFailed}
                status={
                    privateKey === "error"
                        ? {
                              error: t(LOAD_FAILED),
                              onRetry: () => void loadPrivateKey(),
                          }
                        : privateKey === "loading"
                          ? "loading"
                          : undefined
                }
                actions={
                    <IconButton
                        icon={Download}
                        label={t`Save private key`}
                        color={colors.muted}
                        onPress={() => setSaveOpen(true)}
                    />
                }
            />
            <CopyableField
                label={t`Public key`}
                value={publicLine}
                publicValue
                monospace
                numberOfLines={4}
                onCopyFailed={copyFailed}
                actions={
                    <IconButton
                        icon={Download}
                        label={t`Save public key`}
                        color={colors.muted}
                        onPress={() => void savePublicKey()}
                    />
                }
            />
            <CopyableField
                label={t`Fingerprint`}
                value={info?.fingerprint ?? ""}
                publicValue
                monospace
                onCopyFailed={copyFailed}
            />
            <View className="mb-3 rounded-lg border border-border bg-secondary px-4 py-3">
                <Text className="mb-2 text-xs text-muted-foreground">
                    {t({
                        message: "Type",
                        comment: "SSH key algorithm, such as Ed25519",
                    })}
                </Text>
                <Text className="text-sm leading-5 text-foreground">
                    {info?.label ?? t`Unknown`}
                </Text>
                {info && isWeakSSHKey(info) ? (
                    <InlineNotice
                        tone="warning"
                        className="mt-3"
                        message={t`RSA keys under 3072 bits are weak. Replace this key with a new Ed25519 key.`}
                    />
                ) : null}
            </View>
            <CopyableField
                label={t({
                    message: "Comment",
                    comment: "SSH key comment field",
                })}
                value={data.Comment}
                publicValue
                onCopyFailed={copyFailed}
            />
            <SavePrivateKeyDialog
                open={saveOpen}
                onOpenChange={setSaveOpen}
                credential={credential}
                fileName={fileName}
            />
        </View>
    );
}

function SavePrivateKeyDialog({
    open,
    onOpenChange,
    credential,
    fileName,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    credential: VaultCredential;
    fileName: string;
}) {
    const { t } = useLingui();
    const showSnackbar = useUnlockedSnackbar();
    const [passphrase, setPassphrase] = useState("");
    const [confirmation, setConfirmation] = useState("");
    const [mismatch, setMismatch] = useState(false);
    const [busy, setBusy] = useState(false);
    const [exporter] = useState(createSSHKeyTaskRunner);
    useEffect(() => () => exporter.cancel(), [exporter]);
    // Leaving the screen also stops a key on its way to the share sheet.
    const startRelease = useSecretRelease();

    // Closing also drops an export that is still running.
    const close = () => {
        exporter.cancel();
        setBusy(false);
        setPassphrase("");
        setConfirmation("");
        setMismatch(false);
        onOpenChange(false);
    };

    const save = async () => {
        const data = credential.SSHKey;
        if (!data) return;
        if (passphrase !== confirmation) {
            setMismatch(true);
            return;
        }
        if (busy) return;
        // A lock that starts from here on stops the export, including while
        // the file is being written or the share sheet is being prepared.
        const isCurrent = startRelease().current;
        setBusy(true);
        // Superseded or cancelled exports never resolve.
        const result = await exporter.run({
            kind: "export",
            data,
            passphrase: passphrase || undefined,
        });
        close();
        if (!result.ok || result.kind !== "export") {
            showSnackbar(t(SAVE_FAILED));
            return;
        }
        if (!isCurrent()) return;
        try {
            const shared = await shareSSHKeyFile(fileName, result.text, {
                mimeType: "application/octet-stream",
                dialogTitle: t`Save private key`,
                isCurrent,
            });
            if (shared === "unavailable") showSnackbar(t(SHARE_UNAVAILABLE));
        } catch {
            if (isCurrent()) showSnackbar(t(SAVE_FAILED));
        }
    };

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => (next ? onOpenChange(true) : close())}
            placement="bottom"
            scroll
        >
            <DialogHeader>
                <DialogTitle>{t`Save private key`}</DialogTitle>
                <DialogDescription>
                    {t`Add a passphrase to encrypt the file. If you leave it blank, the file is not encrypted.`}
                </DialogDescription>
            </DialogHeader>
            <View>
                <Label>{t`Passphrase (optional)`}</Label>
                <Input
                    value={passphrase}
                    onChangeText={(value) => {
                        setPassphrase(value);
                        setMismatch(false);
                    }}
                    secureTextEntry
                    revealButtonHeight={54}
                    className="h-[54px]"
                    autoCapitalize="none"
                    autoCorrect={false}
                    importantForAutofill="no"
                    editable={!busy}
                    accessibilityLabel={t`File passphrase`}
                    testID="ssh-key-file-passphrase"
                />
            </View>
            <View>
                <Label>{t`Confirm passphrase`}</Label>
                <Input
                    value={confirmation}
                    onChangeText={(value) => {
                        setConfirmation(value);
                        setMismatch(false);
                    }}
                    secureTextEntry
                    revealButtonHeight={54}
                    className="h-[54px]"
                    autoCapitalize="none"
                    autoCorrect={false}
                    importantForAutofill="no"
                    editable={!busy}
                    accessibilityLabel={t`Confirm file passphrase`}
                    testID="ssh-key-file-passphrase-confirm"
                />
            </View>
            {mismatch ? (
                <InlineNotice
                    tone="error"
                    message={t`The passphrases don't match.`}
                />
            ) : null}
            {!passphrase ? (
                <InlineNotice
                    tone="warning"
                    message={t`Without a passphrase, anyone who gets the file can use the key.`}
                />
            ) : null}
            <Text className="text-xs leading-5 text-muted-foreground">
                <Trans>
                    The file is saved as{" "}
                    <Text className="font-mono text-xs text-foreground">
                        {fileName}
                    </Text>
                    . Before using it with ssh, run{" "}
                    <Text className="font-mono text-xs text-foreground">
                        chmod 600 {fileName}
                    </Text>
                    .
                </Trans>
            </Text>
            <Button variant="secondary" onPress={close}>
                {t`Cancel`}
            </Button>
            <Button
                loading={busy}
                loadingLabel={passphrase ? t`Encrypting…` : t`Saving…`}
                onPress={() => void save()}
                testID="ssh-key-file-save"
            >
                {passphrase ? t`Save encrypted file` : t`Save unencrypted file`}
            </Button>
        </Dialog>
    );
}
