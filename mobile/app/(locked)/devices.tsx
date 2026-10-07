import { Redirect } from "expo-router";

/**
 * The Link Vault tab opens the receiver intake directly.
 */
export default function LockedDevicesScreen() {
    return <Redirect href="/link-receive" />;
}
