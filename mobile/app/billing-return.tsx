import { Redirect, useLocalSearchParams } from "expo-router";
import { useAtomValue } from "jotai";
import { useIsFocused } from "expo-router/react-navigation";

import { isVaultUnlockedAtom } from "@/utils/atoms";
import { getVaultDEKFromSession } from "@/utils/vault-session";
import { useAutoLock } from "@/hooks/use-auto-lock";
import { VaultLockScreen } from "@/components/unlocked/unlocked-ui";
import { vaultLockStateAtom } from "@/utils/vault-lock";

/** Browser returns never unlock a vault or establish proof of payment. */
export default function BillingReturnScreen() {
    const { outcome } = useLocalSearchParams<{ outcome?: string }>();
    const unlocked = useAtomValue(isVaultUnlockedAtom);
    const lockState = useAtomValue(vaultLockStateAtom);
    const focused = useIsFocused();
    const billingOutcome =
        outcome === "success" || outcome === "cancel" ? outcome : "resume";
    const returnTo = `/billing-return?outcome=${billingOutcome}`;
    const { resumeAfterFailedLock } = useAutoLock(
        unlocked && focused,
        returnTo,
    );
    if (
        unlocked &&
        (getVaultDEKFromSession().isErr() || lockState !== "idle")
    ) {
        return <VaultLockScreen onContinueEditing={resumeAfterFailedLock} />;
    }
    if (!unlocked) {
        return (
            <Redirect
                href={{
                    pathname: "/(locked)/unlock",
                    params: { returnTo },
                }}
            />
        );
    }
    return (
        <Redirect
            href={{
                pathname: "/(app)/(tabs)/account",
                params: { billingOutcome, billingReturn: String(Date.now()) },
            }}
        />
    );
}
