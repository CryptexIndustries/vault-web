import { Redirect } from "expo-router";

/** Legacy welcome → Vault Manager (create default when empty). */
export default function WelcomeRedirect() {
    return <Redirect href="/(locked)/manager?tab=create" />;
}
