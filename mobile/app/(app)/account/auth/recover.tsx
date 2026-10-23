import { useEffect, useState } from "react";
import { Alert, View } from "react-native";
import { router } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";

import { AccountAuth } from "@/components/account/account-auth";
import { useAccountController } from "@/components/account/account-controller";
import { InlineNotice } from "@/components/inline-notice";
import {
    Dialog,
    DialogDescription,
    DialogFooter,
    DialogHeader,
} from "@/components/ui/dialog";
import {
    UnlockedButton as Button,
    UnlockedDialogTitle as DialogTitle,
    UnlockedScreen,
} from "@/components/unlocked/unlocked-ui";

export default function AccountRecoverScreen() {
    const account = useAccountController();
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [next, setNext] = useState<"account" | "offer" | "kit" | null>(null);
    usePreventRemove(account.mutationBusy, () => {
        Alert.alert(
            "Account recovery in progress",
            "Wait for account recovery to finish before leaving this screen.",
        );
    });
    useEffect(() => {
        if (account.mutationBusy) return;
        if (next === "account") router.dismissTo("/(app)/(tabs)/account");
        if (next === "kit") {
            router.replace({
                pathname: "/(app)/account/recovery-kit",
                params: { auto: "1" },
            });
        }
    }, [account.mutationBusy, next]);

    return (
        <UnlockedScreen scroll taskTitle="Recover account">
            <AccountAuth
                authMode="recover"
                recoverUserId={account.recoverUserId}
                onRecoverUserIdChange={account.setRecoverUserId}
                recoverPhrase={account.recoverPhrase}
                onRecoverPhraseChange={account.setRecoverPhrase}
                onRegister={() => undefined}
                onRecover={() => {
                    if (account.checkRecoverForm()) setConfirmOpen(true);
                }}
                registerPending={account.registerPending}
                recoverPending={account.recoverPending}
                busy={account.mutationBusy}
            />
            {account.message ? (
                <View className="mt-4">
                    <InlineNotice
                        tone={account.message.tone}
                        message={account.message.text}
                    />
                </View>
            ) : null}
            <Dialog
                open={confirmOpen}
                placement="bottom"
                onOpenChange={setConfirmOpen}
            >
                <DialogHeader>
                    <DialogTitle>Recover this account?</DialogTitle>
                    <DialogDescription>
                        Recovering removes every other device from this account
                        and signs them out. It also uses up this Recovery Kit;
                        you can save a new one next.
                    </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                    <Button
                        variant="secondary"
                        onPress={() => setConfirmOpen(false)}
                    >
                        Cancel
                    </Button>
                    <Button
                        variant="destructive"
                        onPress={() => {
                            setConfirmOpen(false);
                            void account.handleRecover().then((result) => {
                                if (result === "kit-missing") setNext("offer");
                                else if (result) setNext("account");
                            });
                        }}
                    >
                        Recover account
                    </Button>
                </DialogFooter>
            </Dialog>
            <Dialog
                open={next === "offer"}
                placement="bottom"
                onOpenChange={(open) => {
                    if (!open) setNext("account");
                }}
            >
                <DialogHeader>
                    <DialogTitle>Create a new Recovery Kit?</DialogTitle>
                    <DialogDescription>
                        The Kit you used no longer works, so this account has
                        none. Create one now, or later from Account &gt;
                        Recovery &amp; access.
                    </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                    <Button
                        variant="secondary"
                        onPress={() => setNext("account")}
                    >
                        Later
                    </Button>
                    <Button onPress={() => setNext("kit")}>
                        Create Recovery Kit
                    </Button>
                </DialogFooter>
            </Dialog>
        </UnlockedScreen>
    );
}
