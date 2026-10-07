import { createContext, useContext, useState, type ReactNode } from "react";
import {
    Dialog,
    DialogHeader,
    DialogDescription,
} from "@/components/ui/dialog";
import { UnlockedButton, UnlockedDialogTitle } from "./unlocked-ui";

type Confirmation = {
    title: string;
    description?: string;
    confirmLabel: string;
    cancelLabel: string;
    destructive?: boolean;
    onConfirm: () => void;
    onCancel?: () => void;
};

const ConfirmationContext = createContext<
    ((confirmation: Confirmation) => void) | null
>(null);

export function useUnlockedConfirmation() {
    const confirm = useContext(ConfirmationContext);
    if (!confirm) throw new Error("Confirmation requires the unlocked shell");
    return confirm;
}

export function UnlockedConfirmationProvider({
    children,
}: {
    children: ReactNode;
}) {
    const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
    const cancel = () => {
        const action = confirmation?.onCancel;
        setConfirmation(null);
        action?.();
    };
    return (
        <ConfirmationContext.Provider value={setConfirmation}>
            {children}
            <Dialog
                open={!!confirmation}
                onOpenChange={(open) => !open && cancel()}
                placement="bottom"
            >
                <DialogHeader>
                    <UnlockedDialogTitle>
                        {confirmation?.title}
                    </UnlockedDialogTitle>
                    {confirmation?.description ? (
                        <DialogDescription>
                            {confirmation.description}
                        </DialogDescription>
                    ) : null}
                </DialogHeader>
                <UnlockedButton
                    variant="secondary"
                    onPress={cancel}
                >
                    {confirmation?.cancelLabel}
                </UnlockedButton>
                <UnlockedButton
                    variant={
                        confirmation?.destructive === false
                            ? "default"
                            : "destructive"
                    }
                    onPress={() => {
                        const action = confirmation?.onConfirm;
                        setConfirmation(null);
                        action?.();
                    }}
                >
                    {confirmation?.confirmLabel}
                </UnlockedButton>
            </Dialog>
        </ConfirmationContext.Provider>
    );
}
