import { Redirect } from "expo-router";

/** Legacy create route → Vault Manager Create tab. */
export default function CreateRedirect() {
    return <Redirect href={"/(locked)/create" as never} />;
}
