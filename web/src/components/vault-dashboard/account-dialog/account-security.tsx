"use client";

import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardFooter,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";

type AccountSecurityProps = {
    isRoot: boolean;
    onlineServicesBound: boolean;
    busy: boolean;
    recoveryPhraseAlreadyOnServer: boolean;
    genRecoveryPending: boolean;
    clearRecoveryPending: boolean;
    onGenerateRecovery: () => void;
    onClearRecovery: () => void;
    onRemoveLocalBinding: () => void;
    onDeleteAccount: () => void;
};

export function AccountSecurity({
    isRoot,
    onlineServicesBound,
    busy,
    recoveryPhraseAlreadyOnServer,
    genRecoveryPending,
    clearRecoveryPending,
    onGenerateRecovery,
    onClearRecovery,
    onRemoveLocalBinding,
    onDeleteAccount,
}: AccountSecurityProps) {
    return (
        <div className="space-y-4">
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-sm">Recovery phrase</CardTitle>
                    <CardDescription>
                        Backs up your Online Services account. Recovery requires
                        both your User ID and the phrase. To rotate, clear the
                        old phrase first — that invalidates any previous backup.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                    {recoveryPhraseAlreadyOnServer ? (
                        <p className="text-xs text-muted-foreground">
                            A recovery phrase is on file. Clear it before
                            generating a new one.
                        </p>
                    ) : (
                        <p className="text-xs text-muted-foreground">
                            No recovery phrase on file.
                        </p>
                    )}
                    <div className="flex flex-wrap gap-2">
                        <Button
                            size="sm"
                            variant="outline"
                            disabled={
                                !isRoot ||
                                genRecoveryPending ||
                                recoveryPhraseAlreadyOnServer
                            }
                            onClick={() => void onGenerateRecovery()}
                        >
                            {genRecoveryPending ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : null}
                            {recoveryPhraseAlreadyOnServer
                                ? "Generate new"
                                : "Generate"}
                        </Button>
                        <Button
                            size="sm"
                            variant="outline"
                            disabled={
                                !isRoot ||
                                clearRecoveryPending ||
                                !recoveryPhraseAlreadyOnServer
                            }
                            onClick={onClearRecovery}
                        >
                            {clearRecoveryPending ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : null}
                            Clear phrase
                        </Button>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-sm">This device</CardTitle>
                    <CardDescription>
                        Clears device signing key credentials stored in this
                        vault and signs out locally. Does not delete the server
                        account.
                    </CardDescription>
                </CardHeader>
                <CardFooter className="border-t pt-4">
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={!onlineServicesBound || busy}
                        onClick={onRemoveLocalBinding}
                    >
                        Remove local binding…
                    </Button>
                </CardFooter>
            </Card>

            <Card className="border-destructive/30">
                <CardHeader className="pb-3">
                    <CardTitle className="text-sm text-destructive">
                        Delete account
                    </CardTitle>
                    <CardDescription>
                        Permanently removes the server account. Root device
                        only. This cannot be undone.
                    </CardDescription>
                </CardHeader>
                <CardFooter className="border-t pt-4">
                    <Button
                        variant="destructive"
                        size="sm"
                        disabled={!isRoot || busy}
                        onClick={onDeleteAccount}
                    >
                        Delete account
                    </Button>
                </CardFooter>
            </Card>
        </div>
    );
}
