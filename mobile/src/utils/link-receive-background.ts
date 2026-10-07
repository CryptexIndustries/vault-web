import type { AppStateStatus } from "react-native";

/** A live receive connection cannot keep running after the app backgrounds. */
export function shouldCancelReceiveLinkOnBackground(
    state: AppStateStatus,
    validatingInvitation: boolean,
    hasController: boolean,
): boolean {
    return state !== "active" && (validatingInvitation || hasController);
}
