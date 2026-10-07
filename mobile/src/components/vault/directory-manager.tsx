import {
    UnlockedDialogTitle as DialogTitle,
    UnlockedScreen,
    UnlockedPageTitle,
    UnlockedText,
    UnlockedButton as Button,
    UnlockedInput as Input,
    UnlockedLabel as Label,
} from "@/components/unlocked/unlocked-ui";
import { useUnlockedConfirmation } from "@/components/unlocked/confirmation-sheet";
import { useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { useAtomValue } from "jotai";
import {
    ChevronRight,
    Folder,
} from "lucide-react-native";

import {
    createDirectory,
    deleteDirectory,
    Directory,
    moveCredentialsToDirectory,
    sortDirectories,
    updateDirectory,
    Vault,
    VaultCredential,
} from "@cryptex-industries/vault-core/vault-utils/vault";
import { unlockedVaultAtom, vaultCredentialsAtom } from "@/utils/atoms";
import { persistVaultMutation } from "@/utils/vault-mutations";
import { Switch } from "@/components/ui/switch";
import {
    Dialog,
    DialogFooter,
    DialogHeader,
} from "@/components/ui/dialog";
import { colors } from "@/theme";

type EditorMode = "create" | "rename" | null;

export function DirectoryManagerScreen() {
    const confirm = useUnlockedConfirmation();
    const vault = useAtomValue(unlockedVaultAtom);
    const credentials = useAtomValue(vaultCredentialsAtom);
    const directories = useMemo(
        () =>
            sortDirectories(vault.Directories).filter(
                (entry) => !entry.Deleted,
            ),
        [vault.Directories],
    );
    const activeCredentials = useMemo(
        () => credentials.filter((entry) => !entry.Deleted),
        [credentials],
    );
    const [editorMode, setEditorMode] = useState<EditorMode>(null);
    const [editorDirectory, setEditorDirectory] = useState<Directory | null>(
        null,
    );
    const [deleteTarget, setDeleteTarget] = useState<Directory | null>(null);
    const [deleteContents, setDeleteContents] = useState(false);
    const [name, setName] = useState("");
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);

    const countFor = (directoryId: string) =>
        activeCredentials.filter((item) => item.DirectoryID === directoryId)
            .length;

    const openEditor = (
        mode: Exclude<EditorMode, null>,
        directory?: Directory,
    ) => {
        setEditorMode(mode);
        setEditorDirectory(directory ?? null);
        setName(directory?.Name ?? "");
        setError("");
    };

    const closeEditor = () => {
        if (busy) return;
        if (name === (editorDirectory?.Name ?? "")) {
            setEditorMode(null);
            return;
        }
        const mode = editorMode;
        setEditorMode(null);
        confirm({
            title: "Discard directory changes?",
            description: "Your directory name has not been saved.",
            confirmLabel: "Discard changes",
            cancelLabel: "Keep editing",
            onConfirm: () => {},
            onCancel: () => setEditorMode(mode),
        });
    };

    const saveDirectory = async () => {
        const normalized = name.trim();
        const duplicate = directories.some(
            (entry) =>
                entry.ID !== editorDirectory?.ID &&
                entry.Name.trim().toLocaleLowerCase() ===
                    normalized.toLocaleLowerCase(),
        );
        if (!normalized) {
            setError("Enter a directory name.");
            return;
        }
        if (normalized.toLocaleLowerCase() === "no directory") {
            setError("“No directory” is reserved for unfiled credentials.");
            return;
        }
        if (duplicate) {
            setError("A directory with this name already exists.");
            return;
        }

        setBusy(true);
        const result = await persistVaultMutation(
            editorMode === "create" ? "directory.create" : "directory.rename",
            async (currentVault) => {
                const updated = Object.assign(new Vault(), currentVault, {
                    Directories: currentVault.Directories.map((entry) =>
                        Object.assign(new Directory(), entry),
                    ),
                });
                if (editorMode === "create") {
                    await createDirectory(updated.Directories, {
                        ID: null,
                        Name: normalized,
                    });
                } else if (editorDirectory) {
                    await updateDirectory(
                        updated.Directories,
                        editorDirectory.ID,
                        {
                            Name: normalized,
                        },
                    );
                }
                return { vault: updated, result: undefined };
            },
        );
        setBusy(false);
        if (result.isErr()) {
            setError("Directory update failed.");
            return;
        }
        setEditorMode(null);
    };

    const removeDirectory = async () => {
        if (!deleteTarget) return;
        const id = deleteTarget.ID;
        setBusy(true);
        const result = await persistVaultMutation(
            "directory.delete",
            async (currentVault) => {
                const updated = Object.assign(new Vault(), currentVault, {
                    Directories: currentVault.Directories.map((entry) =>
                        Object.assign(new Directory(), entry),
                    ),
                    Credentials: currentVault.Credentials.map((entry) =>
                        Object.assign(new VaultCredential(), entry),
                    ),
                });
                if (!deleteContents) {
                    const ids = updated.Credentials.filter(
                        (entry) => !entry.Deleted && entry.DirectoryID === id,
                    ).map((entry) => entry.ID);
                    if (ids.length) {
                        await moveCredentialsToDirectory(
                            updated.Credentials,
                            ids,
                            "",
                            updated.Directories,
                        );
                    }
                }
                await deleteDirectory(
                    updated.Directories,
                    updated.Credentials,
                    id,
                );
                return { vault: updated, result: undefined };
            },
        );
        setBusy(false);
        if (result.isErr()) {
            setError("Failed to remove directory.");
            return;
        }
        setDeleteTarget(null);
        setDeleteContents(false);
    };

    const row = (
        id: string,
        title: string,
        subtitle: string,
        directory?: Directory,
    ) => (
        <View
            key={id || "root"}
            style={{
                minHeight: 70,
                flexDirection: "row",
                alignItems: "center",
                borderBottomWidth: 1,
                borderBottomColor: colors.border,
            }}
        >
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${title}, ${subtitle}`}
                onPress={() => directory && openEditor("rename", directory)}
                style={{
                    minHeight: 70,
                    flex: 1,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 13,
                }}
            >
                <Folder size={22} color={colors.muted} strokeWidth={1.7} />
                <View style={{ flex: 1 }}>
                    <UnlockedText style={{ fontSize: 14 }}>
                        {title}
                    </UnlockedText>
                    <UnlockedText
                        style={{
                            color: colors.muted,
                            fontSize: 12,
                            marginTop: 5,
                        }}
                    >
                        {subtitle}
                    </UnlockedText>
                </View>
                <ChevronRight size={17} color={colors.muted} />
            </Pressable>
        </View>
    );

    const deleteCount = deleteTarget ? countFor(deleteTarget.ID) : 0;

    return (
        <UnlockedScreen scroll>
            <UnlockedPageTitle title="Directories" />
            <View style={{ paddingBottom: 22, marginBottom: 6, borderBottomWidth: 1, borderBottomColor: colors.border }}>
            <UnlockedText style={{ fontSize: 22, fontWeight: "500", marginTop: 10 }}>
                Your directories
            </UnlockedText>
            <UnlockedText
                style={{
                    color: colors.muted,
                    fontSize: 13,
                    lineHeight: 20,
                    marginTop: 6,
                }}
            >
                Keep related items together.
            </UnlockedText>
            </View>
            <View>
                {directories.map((directory) =>
                    row(
                        directory.ID,
                        directory.Name,
                        `${countFor(directory.ID)} items`,
                        directory,
                    ),
                )}
            </View>
            {!directories.length ? (
                <UnlockedText
                    style={{
                        color: colors.muted,
                        fontSize: 12,
                        lineHeight: 19,
                        marginTop: 16,
                    }}
                >
                    No directories yet. Create one to start organizing your
                    credentials.
                </UnlockedText>
            ) : null}
            <Button
                className="mt-6 h-[54px] min-h-[54px] flex-row gap-2"
                onPress={() => openEditor("create")}
            >
                <UnlockedText
                    style={{
                        color: colors.navigation,
                        fontWeight: "600",
                        fontSize: 14,
                    }}
                >
                    Create directory
                </UnlockedText>
            </Button>

            <Dialog
                open={editorMode != null}
                onOpenChange={(open) => !open && closeEditor()}
                dismissible={!busy}
                scroll
                placement="bottom"
            >
                <DialogHeader>
                    <DialogTitle>
                        {editorMode === "rename"
                            ? editorDirectory?.Name ?? "Directory"
                            : "Create directory"}
                    </DialogTitle>
                </DialogHeader>
                <View>
                    <Label>Directory name</Label>
                    <Input
                        value={name}
                        onChangeText={(value) => {
                            setName(value.slice(0, 40));
                            setError("");
                        }}
                        placeholder="e.g. Finance"
                        maxLength={40}
                        autoFocus
                        accessibilityLabel="Directory name"
                    />
                </View>
                {error ? (
                    <UnlockedText
                        style={{ color: colors.primary, fontSize: 13 }}
                    >
                        {error}
                    </UnlockedText>
                ) : null}
                <DialogFooter>
                    <Button
                        textClassName="text-[#111520]"
                        loading={busy}
                        onPress={() => void saveDirectory()}
                    >
                        {editorMode === "rename"
                            ? "Rename directory"
                            : "Create directory"}
                    </Button>
                    {editorMode === "rename" ? <Button variant="destructive" onPress={() => {
                        setDeleteTarget(editorDirectory);
                        setEditorMode(null);
                        setDeleteContents(false);
                        setError("");
                    }}>Delete directory</Button> : null}
                </DialogFooter>
            </Dialog>

            <Dialog
                open={!!deleteTarget}
                onOpenChange={(open) => !open && setDeleteTarget(null)}
                placement="bottom"
            >
                <DialogHeader>
                    <DialogTitle>Remove directory?</DialogTitle>
                    <UnlockedText style={{ color: colors.muted, fontSize: 13, lineHeight: 20 }}>
                        {deleteCount
                            ? `Remove “${deleteTarget?.Name}”? Its ${deleteCount} credential${deleteCount === 1 ? "" : "s"} will move to No directory by default.`
                            : `Remove “${deleteTarget?.Name}”? This directory is empty.`}
                    </UnlockedText>
                </DialogHeader>
                {deleteCount ? (
                    <View
                        style={{
                            minHeight: 64,
                            padding: 14,
                            borderWidth: 1,
                            borderColor: colors.border,
                            borderRadius: 8,
                            flexDirection: "row",
                            alignItems: "center",
                            gap: 13,
                        }}
                    >
                        <View style={{ flex: 1 }}>
                            <UnlockedText style={{ fontSize: 14 }}>
                                Also delete its credentials
                            </UnlockedText>
                            <UnlockedText
                                style={{
                                    color: colors.muted,
                                    fontSize: 12,
                                    marginTop: 6,
                                }}
                            >
                                Leave this off to keep your credentials.
                            </UnlockedText>
                        </View>
                        <Switch
                            value={deleteContents}
                            onValueChange={setDeleteContents}
                            accessibilityLabel="Also delete directory credentials"
                        />
                    </View>
                ) : null}
                {error ? (
                    <UnlockedText
                        style={{ color: colors.primary, fontSize: 13 }}
                    >
                        {error}
                    </UnlockedText>
                ) : null}
                <DialogFooter>
                    <Button
                        variant="destructive"
                        loading={busy}
                        onPress={() => void removeDirectory()}
                    >
                        Remove directory
                    </Button>
                    <Button
                        variant="ghost"
                        onPress={() => setDeleteTarget(null)}
                    >
                        Keep directory
                    </Button>
                </DialogFooter>
            </Dialog>
        </UnlockedScreen>
    );
}
