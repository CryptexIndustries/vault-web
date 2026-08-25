import {
    PasswordGeneratorPanel,
    type PasswordGeneratorPanelProps,
} from "@/components/ui/password-generator";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogTitle,
} from "@/components/ui/dialog";

type PopupPasswordGeneratorDialogProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onPasswordSelect?: PasswordGeneratorPanelProps["onPasswordSelect"];
};

/** Password generator constrained to the browser-action popup viewport. */
export function PopupPasswordGeneratorDialog({
    open,
    onOpenChange,
    onPasswordSelect,
}: PopupPasswordGeneratorDialogProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="flex h-[calc(100vh-16px)] max-h-[420px] w-[calc(100vw-24px)] max-w-[500px] flex-col gap-0 overflow-hidden p-0 [&>button]:hidden">
                <DialogTitle className="sr-only">
                    Password Generator
                </DialogTitle>
                <DialogDescription className="sr-only">
                    Generate a secure password or memorable passphrase
                </DialogDescription>
                {open ? (
                    <PasswordGeneratorPanel
                        compact
                        showToasts
                        onPasswordSelect={onPasswordSelect}
                        onCancel={() => onOpenChange(false)}
                    />
                ) : null}
            </DialogContent>
        </Dialog>
    );
}
