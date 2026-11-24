import {
    AlertCircle,
    Check,
    Clock,
    Hourglass,
    KeyRound,
    ShieldQuestion,
    TriangleAlert,
} from "lucide-react-native";
import { useLingui } from "@lingui/react/macro";

import { StatusPanel, type StatusContent } from "./status-panel";
import type { RecoveryOutcome } from "./types";

export type RecoveryStatusState =
    | "confirm"
    | "recovering"
    | "connecting"
    | Exclude<RecoveryOutcome["state"], "invalid">;

export function RecoveryStatus({
    state,
    message = "",
    onPrimary,
    onSecondary,
}: {
    state: RecoveryStatusState;
    /** Failed: what stopped the recovery. */
    message?: string;
    onPrimary?: () => void;
    onSecondary?: () => void;
}) {
    const { t } = useLingui();
    const humanCheck = t`Human check`;
    const account = t({ message: "Account", comment: "Recovery step" });
    const vault = t`This vault`;
    const working = (connecting: boolean) => ({
        tone: "progress" as const,
        icon: KeyRound,
        title: t`Recovering your account`,
        body: t`Keep the app open. This takes a few seconds.`,
        lines: [
            { label: humanCheck, value: t`Passed`, state: "done" as const },
            connecting
                ? {
                      label: account,
                      value: t`Recovered`,
                      state: "done" as const,
                  }
                : {
                      label: account,
                      value: t`Recovering…`,
                      state: "active" as const,
                  },
            connecting
                ? {
                      label: vault,
                      value: t`Connecting…`,
                      state: "active" as const,
                  }
                : {
                      label: vault,
                      value: t`Not started`,
                      state: "idle" as const,
                  },
        ],
    });
    const retry = { primary: t`Try again`, secondary: t`Edit Kit` };

    const contents: Record<RecoveryStatusState, StatusContent> = {
        confirm: {
            tone: "waiting",
            icon: TriangleAlert,
            title: t`Recover this account?`,
            body: t`This vault becomes the only device on the account.`,
            lines: [
                { label: t`Other devices`, value: t`Signed out and removed` },
                { label: t`This Recovery Kit`, value: t`Stops working` },
                { label: vault, value: t`Becomes the account device` },
            ],
            primary: t`Recover account`,
            secondary: t`Back`,
        },
        recovering: working(false),
        connecting: working(true),
        recovered: {
            tone: "success",
            icon: Check,
            title: t`Account recovered`,
            body: t`This vault is connected to your Online Services account. Other devices were signed out.`,
            primary: t`Done`,
        },
        kitMissing: {
            tone: "success",
            icon: Check,
            title: t`Account recovered`,
            body: t`The Recovery Kit you used no longer works. Create a new one so you can recover this account again.`,
            lines: [
                {
                    label: t`Recovery Kit`,
                    value: t`None yet`,
                    state: "waiting",
                },
            ],
            primary: t`Create Recovery Kit`,
            secondary: t({
                message: "Later",
                comment: "Button: skip creating a Recovery Kit for now",
            }),
        },
        notConnected: {
            tone: "waiting",
            icon: Clock,
            title: t`Recovered, not signed in yet`,
            body: t`This vault now holds the account but couldn't sign in. Open the Account tab to reconnect.`,
            primary: t`Go to Account`,
        },
        saveFailed: {
            tone: "error",
            icon: AlertCircle,
            title: t`Not saved to this vault`,
            body: t`Online Services accepted your Recovery Kit, but this vault couldn't save the account yet. Stay on this screen and tap Save again. Locking the vault or closing the app now loses this recovery.`,
            primary: t`Save again`,
        },
        checkIncomplete: {
            tone: "neutral",
            icon: ShieldQuestion,
            title: t`Human check not completed`,
            body: t`Recovery needs a quick human check. Nothing has changed.`,
            ...retry,
        },
        rejected: {
            tone: "error",
            icon: AlertCircle,
            title: t`Kit not accepted`,
            body: t`Check the User ID and all 24 words, then try again. Nothing has changed.`,
            primary: t`Edit Kit`,
        },
        rateLimited: {
            tone: "waiting",
            icon: Hourglass,
            title: t`Too many attempts`,
            body: t`Wait a few minutes, then try again. Nothing has changed.`,
            ...retry,
        },
        unreachable: {
            tone: "error",
            icon: AlertCircle,
            title: t`Couldn't reach Online Services`,
            body: t`Check your connection and try again.`,
            ...retry,
        },
        failed: {
            tone: "error",
            icon: AlertCircle,
            title: t`Recovery didn't finish`,
            body: message,
            ...retry,
        },
    };
    return (
        <StatusPanel
            content={contents[state]}
            onPrimary={onPrimary}
            onSecondary={onSecondary}
        />
    );
}
