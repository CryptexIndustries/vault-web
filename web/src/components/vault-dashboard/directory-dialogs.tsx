import { useEffect, useState } from "react";
import {
    Check,
    ChevronDown,
    Folder,
    FolderRoot,
    Pencil,
    Plus,
    Trash2,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
    Directory,
    sortDirectories,
} from "@cryptex-industries/vault-core/vault-utils/vault";
import { cn } from "@/lib/utils";

export function DirectoryEditorDialog({
    open,
    onOpenChange,
    directory,
    onCreate,
    onRename,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    directory: Directory | null;
    onCreate: (name: string) => Promise<string | void> | string | void;
    onRename?: (directoryID: string, name: string) => Promise<void> | void;
}) {
    const [name, setName] = useState("");
    const [error, setError] = useState("");
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!open) return;
        setName(directory?.Name ?? "");
        setError("");
    }, [directory, open]);

    const save = async () => {
        setError("");
        setSaving(true);
        try {
            if (directory) {
                if (!onRename)
                    throw new Error("Directory rename is unavailable");
                await onRename(directory.ID, name);
            } else {
                await onCreate(name);
            }
            onOpenChange(false);
        } catch (err: unknown) {
            setError(
                err instanceof Error ? err.message : "Failed to save directory",
            );
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>
                        {directory ? "Rename directory" : "Create directory"}
                    </DialogTitle>
                    <DialogDescription>
                        Directory names must be unique and 1–100 characters.
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-2">
                    <Label htmlFor="directory-dialog-name">Name</Label>
                    <Input
                        id="directory-dialog-name"
                        value={name}
                        maxLength={100}
                        autoFocus
                        disabled={saving}
                        onChange={(event) => {
                            setName(event.target.value);
                            setError("");
                        }}
                        onKeyDown={(event) => {
                            if (event.key === "Enter") {
                                event.preventDefault();
                                void save();
                            }
                        }}
                    />
                    {error ? (
                        <p className="text-sm text-destructive" role="alert">
                            {error}
                        </p>
                    ) : null}
                </div>
                <DialogFooter>
                    <Button
                        variant="outline"
                        disabled={saving}
                        onClick={() => onOpenChange(false)}
                    >
                        Cancel
                    </Button>
                    <Button disabled={saving} onClick={() => void save()}>
                        {saving ? "Saving..." : "Save"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

export function DirectoryManagerDialog({
    open,
    onOpenChange,
    directories,
    credentialCounts,
    onDelete,
    onEditDirectory,
    onCreateDirectory,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    directories: Directory[];
    credentialCounts: Record<string, number>;
    onDelete: (directoryID: string) => Promise<void> | void;
    onEditDirectory: (directory: Directory) => void;
    onCreateDirectory: () => void;
}) {
    const [error, setError] = useState("");
    const sortedDirectories = sortDirectories(directories);

    return (
        <Dialog
            open={open}
            onOpenChange={(nextOpen) => {
                if (!nextOpen) setError("");
                onOpenChange(nextOpen);
            }}
        >
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Manage directories</DialogTitle>
                    <DialogDescription>
                        Rename or delete directories. Root is always available
                        and cannot be changed.
                    </DialogDescription>
                </DialogHeader>
                <div className="flex items-center justify-between rounded-md border p-3">
                    <div className="flex min-w-0 items-center gap-3">
                        <FolderRoot className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="truncate text-sm font-medium">
                            Root
                        </span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                        {credentialCounts.root ?? 0}
                    </span>
                </div>
                <div className="max-h-72 space-y-2 overflow-y-auto">
                    {sortedDirectories.length === 0 ? (
                        <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                            No directories yet.
                        </div>
                    ) : (
                        sortedDirectories.map((directory) => (
                            <div
                                key={directory.ID}
                                className="flex items-center gap-3 rounded-md border p-3"
                            >
                                <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
                                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                                    {directory.Name}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                    {credentialCounts[directory.ID] ?? 0}
                                </span>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8"
                                    aria-label={`Rename ${directory.Name}`}
                                    onClick={() => onEditDirectory(directory)}
                                >
                                    <Pencil className="h-4 w-4" />
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-destructive hover:text-destructive"
                                    aria-label={`Delete ${directory.Name}`}
                                    onClick={() => {
                                        setError("");
                                        void Promise.resolve(
                                            onDelete(directory.ID),
                                        ).catch((err: unknown) =>
                                            setError(
                                                err instanceof Error
                                                    ? err.message
                                                    : "Failed to delete directory",
                                            ),
                                        );
                                    }}
                                >
                                    <Trash2 className="h-4 w-4" />
                                </Button>
                            </div>
                        ))
                    )}
                </div>
                {error ? (
                    <p className="text-sm text-destructive" role="alert">
                        {error}
                    </p>
                ) : null}
                <DialogFooter>
                    <Button
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                    >
                        Close
                    </Button>
                    <Button
                        onClick={() => {
                            onOpenChange(false);
                            onCreateDirectory();
                        }}
                    >
                        <Plus className="mr-2 h-4 w-4" />
                        New directory
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

export function DirectoryPicker({
    directories,
    value,
    onChange,
}: {
    directories: Directory[];
    value: string;
    onChange: (directoryID: string) => void;
}) {
    const options = [
        { id: "", name: "Root", icon: FolderRoot },
        ...sortDirectories(directories).map((directory) => ({
            id: directory.ID,
            name: directory.Name,
            icon: Folder,
        })),
    ];
    const selectedLabel =
        options.find((option) => option.id === value)?.name ?? "Root";
    const SelectedIcon = value ? Folder : FolderRoot;

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <button
                    type="button"
                    aria-label="Directory"
                    title={selectedLabel}
                    className={cn(
                        buttonVariants({ variant: "outline" }),
                        "relative h-9 w-full justify-end px-3 font-normal",
                    )}
                >
                    <span className="absolute inset-y-0 left-3 right-9 flex items-center gap-2 overflow-hidden">
                        <SelectedIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="truncate">{selectedLabel}</span>
                    </span>
                    <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
                align="start"
                className="w-[var(--radix-dropdown-menu-trigger-width)]"
                onCloseAutoFocus={(event) => event.preventDefault()}
            >
                {options.map((option) => {
                    const selected = option.id === value;
                    const Icon = option.icon;
                    return (
                        <DropdownMenuItem
                            key={option.id || "root"}
                            className={cn(selected && "bg-accent")}
                            title={option.name}
                            onSelect={() => onChange(option.id)}
                        >
                            <Icon className="h-4 w-4 shrink-0" />
                            <span className="min-w-0 flex-1 truncate">
                                {option.name}
                            </span>
                            {selected ? (
                                <Check className="h-4 w-4 shrink-0" />
                            ) : null}
                        </DropdownMenuItem>
                    );
                })}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
