import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";

interface KeyboardShortcutsDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

const shortcuts = [
    { key: "j", description: "Move selection down" },
    { key: "k", description: "Move selection up" },
    { key: "gg", description: "Jump to first credential" },
    { key: "G", description: "Jump to last credential" },
    { key: "/", description: "Focus credential search" },
    { key: "Space", description: "Toggle checkbox on selected credential" },
    { key: "?", description: "Open this shortcuts dialog" },
];

export function KeyboardShortcutsDialog({
    open,
    onOpenChange,
}: KeyboardShortcutsDialogProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Keyboard Shortcuts</DialogTitle>
                    <DialogDescription>
                        Vim-style shortcuts for faster credential navigation.
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-2">
                    {shortcuts.map((shortcut) => (
                        <div
                            key={shortcut.key}
                            className="flex items-center justify-between rounded-md border px-3 py-2"
                        >
                            <span className="text-sm">
                                {shortcut.description}
                            </span>
                            <kbd className="rounded bg-muted px-2 py-1 font-mono text-xs text-foreground">
                                {shortcut.key}
                            </kbd>
                        </div>
                    ))}
                </div>
            </DialogContent>
        </Dialog>
    );
}
