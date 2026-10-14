import { Redirect } from "expo-router";

/** Legacy restore route → Vault Manager Restore tab. */
export default function RestoreRedirect() {
    return <Redirect href={"/(locked)/restore" as never} />;
}
