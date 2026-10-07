import { Redirect } from "expo-router";

/** Legacy unlock route → Vault Manager Unlock tab. */
export default function UnlockRedirect() {
    return <Redirect href={"/(locked)/unlock" as never} />;
}
