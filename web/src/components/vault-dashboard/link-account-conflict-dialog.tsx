import {
    AlertDialog,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

export type AccountConflictChoice = "cancel" | "keep" | "delete";

/** Asks what happens to this vault's own account when an invitation comes from another account. */
export function LinkAccountConflictDialog({
    open,
    canDelete,
    onChoose,
}: {
    open: boolean;
    canDelete: boolean;
    onChoose: (choice: AccountConflictChoice) => void;
}) {
    return (
        <AlertDialog
            open={open}
            onOpenChange={(next) => {
                if (!next) onChoose("cancel");
            }}
        >
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>
                        This device has its own account
                    </AlertDialogTitle>
                    <AlertDialogDescription asChild>
                        <div className="space-y-2">
                            <p>
                                The invitation comes from a different Online
                                Services account. Linking moves this vault to
                                that account.
                            </p>
                            <p>
                                This device&apos;s current account stays active,
                                including any subscription on it.
                            </p>
                            <p>
                                {canDelete
                                    ? "Delete it now to cancel a subscription bought on the web. Cancel a Google Play subscription in the Play Store. Deleting cannot be undone."
                                    : "Only that account's root device can delete it."}
                            </p>
                        </div>
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <Button variant="outline" onClick={() => onChoose("keep")}>
                        {canDelete ? "Keep it and link" : "Link anyway"}
                    </Button>
                    {canDelete ? (
                        <Button
                            variant="destructive"
                            onClick={() => onChoose("delete")}
                        >
                            Delete it and link
                        </Button>
                    ) : null}
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
