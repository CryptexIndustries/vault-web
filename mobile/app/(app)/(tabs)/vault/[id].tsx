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

import {
    deleteCredential,
    moveCredentialsToDirectory,
    sortDirectories,
    Vault,
    VaultCredential,
} from "@cryptex-industries/vault-core/vault-utils/vault";
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
import { MoreHorizontal } from "lucide-react-native";
import { colors } from "@/theme";

export default function CredentialDetailScreen() {
    const confirm = useUnlockedConfirmation();
    const { id, returnTo } = useLocalSearchParams<{ id: string; returnTo?: string }>();
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
        confirm({
            title: "Delete credential",
            description: `You are about to remove the “${credential.Name}” credential.`,
            cancelLabel: "Cancel",
            confirmLabel: "Delete",
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
                        Alert.alert("Error", "Failed to delete credential.");
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
            Alert.alert("Error", "Failed to move item.");
            return;
        }
        setMoveOpen(false);
    };

    if (!credential) {
        return (
            <UnlockedTaskScreen title="Item details" onBack={goBack}>
                <Text className="mb-4 text-foreground">
                    Credential not found.
                </Text>
                <Button className="min-h-[44px]" onPress={goBack}>
                    Back
                </Button>
            </UnlockedTaskScreen>
        );
    }

    return (
        <UnlockedTaskScreen
            title="Item details"
            onBack={goBack}
            actions={
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Edit item"
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
                            Edit
                        </Text>
                    </Pressable>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="More item actions"
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
                    <DialogTitle>{credential.Name || "Item"}</DialogTitle>
                    <DialogDescription>
                        Choose an action for this item.
                    </DialogDescription>
                </DialogHeader>
                <Button
                    variant="secondary"
                    onPress={() => {
                        setMenuOpen(false);
                        setMoveOpen(true);
                    }}
                >
                    Move to directory
                </Button>
                <Button
                    variant="destructive"
                    onPress={() => {
                        setMenuOpen(false);
                        handleDelete();
                    }}
                >
                    Delete item
                </Button>
            </Dialog>

            <Dialog
                open={moveOpen}
                onOpenChange={setMoveOpen}
                placement="bottom"
            >
                <DialogHeader>
                    <DialogTitle>Move to directory</DialogTitle>
                    <DialogDescription>
                        Select where this item belongs.
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
                    <Text style={{ fontSize: 14 }}>No directory</Text>
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
