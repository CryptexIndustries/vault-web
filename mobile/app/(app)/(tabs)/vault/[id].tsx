import { useUnlockedConfirmation } from "@/components/unlocked/confirmation-sheet";
import {
    UnlockedDialogTitle as DialogTitle,
    UnlockedButton as Button,
    UnlockedTaskScreen,
    UnlockedText as Text,
} from "@/components/unlocked/unlocked-ui";
import { useMemo, useState } from "react";
import { Alert, Pressable, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useAtomValue } from "jotai";
import { useLingui } from "@lingui/react/macro";

import {
    deleteCredential,
    moveCredentialsToDirectory,
    sortDirectories,
    Vault,
    VaultCredential,
} from "@cryptex-industries/vault-core/vault-utils/vault";
import { ItemType } from "@cryptex-industries/vault-core/proto";
import { unlockedVaultAtom, vaultCredentialsAtom } from "@/utils/atoms";
import { persistVaultMutation } from "@/utils/vault-mutations";
import { useBreakpoint } from "@/hooks/use-breakpoint";
import { CredentialDetailPanel } from "@/components/vault/credential-detail-panel";
import { VaultHomeScreen } from "@/components/vault/vault-home";
import {
    Dialog,
    DialogDescription,
    DialogHeader,
} from "@/components/ui/dialog";
import { Link2, MoreHorizontal } from "lucide-react-native";
import { isSSHKeyItem } from "@/utils/ssh-keys";
import { colors } from "@/theme";

export default function CredentialDetailScreen() {
    const { t } = useLingui();
    const confirm = useUnlockedConfirmation();
    const { id, returnTo } = useLocalSearchParams<{
        id: string;
        returnTo?: string;
    }>();
    const goBack = () => router.back();
    const { isTablet } = useBreakpoint();
    const credentials = useAtomValue(vaultCredentialsAtom);
    const vault = useAtomValue(unlockedVaultAtom);
    const [menuOpen, setMenuOpen] = useState(false);
    const [moveOpen, setMoveOpen] = useState(false);

    const credential = useMemo(
        () => credentials.find((c) => c.ID === id && !c.Deleted) ?? null,
        [credentials, id],
    );

    const directories = useMemo(
        () => sortDirectories(vault.Directories),
        [vault.Directories],
    );

    // Tablet: show master/detail with this id selected.
    if (isTablet && returnTo !== "security-report") {
        return <VaultHomeScreen selectedId={id} />;
    }

    const handleDelete = () => {
        if (!credential) return;
        const name = credential.Name;
        confirm({
            title: t`Delete credential`,
            description: t`You are about to remove the “${name}” credential.`,
            cancelLabel: t`Cancel`,
            confirmLabel: t`Delete`,
            onConfirm: () => {
                void (async () => {
                    const result = await persistVaultMutation(
                        "credential.delete",
                        async (current) => {
                            const updated = Object.assign(new Vault(), current);
                            const deleted = await deleteCredential(
                                [...current.Credentials],
                                credential.ID,
                            );
                            if (deleted.isErr()) {
                                throw new Error(deleted.error);
                            }
                            updated.Credentials = deleted.value;
                            return { vault: updated, result: true };
                        },
                    );
                    if (result.isOk()) {
                        goBack();
                    } else {
                        Alert.alert(t`Error`, t`Failed to delete credential.`);
                    }
                })();
            },
        });
    };

    const move = async (targetDirectoryId: string) => {
        if (!credential) return;
        const result = await persistVaultMutation(
            "credentials.move",
            async (currentVault) => {
                const updated = Object.assign(new Vault(), currentVault, {
                    Credentials: currentVault.Credentials.map((entry) =>
                        Object.assign(new VaultCredential(), entry),
                    ),
                });
                await moveCredentialsToDirectory(
                    updated.Credentials,
                    [credential.ID],
                    targetDirectoryId,
                    updated.Directories,
                );
                return { vault: updated, result: undefined };
            },
        );
        if (result.isErr()) {
            Alert.alert(t`Error`, t`Failed to move item.`);
            return;
        }
        setMoveOpen(false);
    };

    if (!credential) {
        return (
            <UnlockedTaskScreen title={t`Item details`} onBack={goBack}>
                <Text className="mb-4 text-foreground">
                    {t`Credential not found.`}
                </Text>
                <Button className="min-h-[44px]" onPress={goBack}>
                    {t`Back`}
                </Button>
            </UnlockedTaskScreen>
        );
    }

    return (
        <UnlockedTaskScreen
            title={t`Item details`}
            onBack={goBack}
            actions={
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={
                            isSSHKeyItem(credential)
                                ? t`Edit details`
                                : t`Edit item`
                        }
                        onPress={() =>
                            router.push({
                                pathname:
                                    returnTo === "security-report"
                                        ? "/(app)/settings/security-report/credential/edit"
                                        : "/(app)/(tabs)/vault/edit",
                                params: { id: credential.ID },
                            })
                        }
                        style={{
                            minHeight: 48,
                            paddingHorizontal: 12,
                            justifyContent: "center",
                        }}
                    >
                        <Text
                            style={{
                                color: colors.primary,
                                fontSize: 14,
                                fontWeight: "600",
                            }}
                        >
                            {isSSHKeyItem(credential)
                                ? t`Edit details`
                                : t`Edit`}
                        </Text>
                    </Pressable>
                    {credential.Type !== ItemType.Passkey ? (
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={t`Share once`}
                            onPress={() =>
                                router.push({
                                    pathname: "/(app)/share",
                                    params: { id: credential.ID },
                                })
                            }
                            style={{
                                width: 44,
                                height: 48,
                                alignItems: "center",
                                justifyContent: "center",
                            }}
                        >
                            <Link2 size={21} color={colors.foreground} />
                        </Pressable>
                    ) : null}
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t`More item actions`}
                        onPress={() => setMenuOpen(true)}
                        style={{
                            width: 48,
                            height: 48,
                            alignItems: "center",
                            justifyContent: "center",
                        }}
                    >
                        <MoreHorizontal size={22} color={colors.foreground} />
                    </Pressable>
                </View>
            }
        >
            <View className="w-full max-w-[720px] self-center">
                <CredentialDetailPanel
                    credential={credential}
                    directories={directories}
                    onEdit={(item) =>
                        router.push({
                            pathname:
                                returnTo === "security-report"
                                    ? "/(app)/settings/security-report/credential/edit"
                                    : "/(app)/(tabs)/vault/edit",
                            params: { id: item.ID },
                        })
                    }
                    onDelete={handleDelete}
                    primaryActions={false}
                />
            </View>

            <Dialog
                open={menuOpen}
                onOpenChange={setMenuOpen}
                placement="bottom"
            >
                <DialogHeader>
                    <DialogTitle>{credential.Name || t`Item`}</DialogTitle>
                    <DialogDescription>
                        {t`Choose an action for this item.`}
                    </DialogDescription>
                </DialogHeader>
                {credential.Type !== ItemType.Passkey ? (
                    <Button
                        variant="secondary"
                        onPress={() => {
                            setMenuOpen(false);
                            router.push({
                                pathname: "/(app)/share",
                                params: { id: credential.ID },
                            });
                        }}
                    >
                        {t`Share once`}
                    </Button>
                ) : null}
                <Button
                    variant="secondary"
                    onPress={() => {
                        setMenuOpen(false);
                        setMoveOpen(true);
                    }}
                >
                    {t`Move to directory`}
                </Button>
                <Button
                    variant="destructive"
                    onPress={() => {
                        setMenuOpen(false);
                        handleDelete();
                    }}
                >
                    {t`Delete item`}
                </Button>
            </Dialog>

            <Dialog
                open={moveOpen}
                onOpenChange={setMoveOpen}
                placement="bottom"
            >
                <DialogHeader>
                    <DialogTitle>{t`Move to directory`}</DialogTitle>
                    <DialogDescription>
                        {t`Select where this item belongs.`}
                    </DialogDescription>
                </DialogHeader>
                <Pressable
                    accessibilityRole="button"
                    onPress={() => void move("")}
                    style={{
                        minHeight: 58,
                        justifyContent: "center",
                        borderBottomWidth: 1,
                        borderBottomColor: colors.border,
                    }}
                >
                    <Text style={{ fontSize: 14 }}>{t`No directory`}</Text>
                </Pressable>
                {directories.map((directory) => (
                    <Pressable
                        key={directory.ID}
                        accessibilityRole="button"
                        onPress={() => void move(directory.ID)}
                        style={{
                            minHeight: 58,
                            justifyContent: "center",
                            borderBottomWidth: 1,
                            borderBottomColor: colors.border,
                        }}
                    >
                        <Text style={{ fontSize: 14 }}>{directory.Name}</Text>
                    </Pressable>
                ))}
            </Dialog>
        </UnlockedTaskScreen>
    );
}
