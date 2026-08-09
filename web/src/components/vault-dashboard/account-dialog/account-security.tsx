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
    rotateRecoveryPending: boolean;
    onGenerateRecovery: () => void;
    onRotateRecovery: () => void;
    onRemoveLocalBinding: () => void;
    onDeleteAccount: () => void;
};

export function AccountSecurity({
    isRoot,
    onlineServicesBound,
    busy,
    recoveryPhraseAlreadyOnServer,
    genRecoveryPending,
    rotateRecoveryPending,
    onGenerateRecovery,
    onRotateRecovery,
    onRemoveLocalBinding,
    onDeleteAccount,
}: AccountSecurityProps) {
    return (
        <div className="space-y-4">
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-sm">Recovery package</CardTitle>
                    <CardDescription>
                        Backs up Online Services account control. Recovery needs
                        both your User ID and the Recovery Kit phrase. You can
                        replace the current package, but you cannot clear it
                        without creating a new one.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                    {!recoveryPhraseAlreadyOnServer ? (
                        <>
                            <p className="text-xs text-muted-foreground">
                                No recovery package on file.
                            </p>
                            <Button
                                size="sm"
                                variant="outline"
                                disabled={!isRoot || genRecoveryPending}
                                onClick={onGenerateRecovery}
                            >
                                {genRecoveryPending ? (
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                ) : null}
                                Generate recovery package
                            </Button>
                        </>
                    ) : (
                        <div className="space-y-2">
                            <p className="text-xs text-muted-foreground">
                                A recovery package is on file. Rotating replaces
                                the current Recovery Kit and ends any active
                                backup recovery session.
                            </p>
                            <Button
                                size="sm"
                                variant="outline"
                                disabled={!isRoot || rotateRecoveryPending}
                                onClick={onRotateRecovery}
                            >
                                {rotateRecoveryPending ? (
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                ) : null}
                                Rotate recovery package
                            </Button>
                        </div>
                    )}
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
                        Danger
                    </CardTitle>
                    <CardDescription>
                        Permanently deletes your Online Services account and its
                        server-side data. This cannot be undone.
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
