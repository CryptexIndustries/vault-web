import { AppWindow, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Shown instead of the unlock screen while another tab in this browser has
 * the vault open. "Use here" locks that tab (it saves first); the user then
 * unlocks here.
 */
export function VaultOpenElsewhere({
    releasing,
    failed,
    onUseHere,
}: {
    releasing: boolean;
    failed: boolean;
    onUseHere: () => void;
}) {
    return (
        <div
            className="flex grow flex-col items-center justify-center px-4"
            data-testid="vault-open-elsewhere"
        >
            <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 text-center shadow-sm">
                <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                    <AppWindow
                        className="h-6 w-6 text-muted-foreground"
                        aria-hidden="true"
                    />
                </span>
                <h1 className="text-lg font-semibold text-foreground">
                    Your vault is open in another tab
                </h1>
                <p className="mt-2 text-sm text-muted-foreground">
                    It stays unlocked in one tab at a time. Use it here to lock
                    the other tab, then unlock it here.
                </p>
                {failed ? (
                    <p className="mt-3 text-sm text-destructive" role="alert">
                        The other tab didn&apos;t lock. Switch to it and lock
                        the vault there.
                    </p>
                ) : null}
                <Button
                    className="mt-5 w-full"
                    data-testid="vault-use-here"
                    disabled={releasing}
                    onClick={onUseHere}
                >
                    {releasing ? (
                        <>
                            <Loader2
                                className="h-4 w-4 animate-spin"
                                aria-hidden="true"
                            />
                            Locking the other tab…
                        </>
                    ) : (
                        "Use here"
                    )}
                </Button>
            </div>
        </div>
    );
}
