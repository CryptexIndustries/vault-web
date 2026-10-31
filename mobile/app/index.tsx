import { Redirect } from "expo-router";
import { useAtomValue } from "jotai";

import { hasSavedVaults } from "@/app_lib/vault-utils/storage";
import { isVaultUnlockedAtom } from "@/utils/atoms";

export default function IndexScreen() {
    const unlocked = useAtomValue(isVaultUnlockedAtom);

    if (unlocked) {
        return <Redirect href="/(app)/(tabs)/vault" />;
    }

    // Open the right tab directly. Opening Unlock and then replacing it with
    // Create flips the tab bar icons in the first frames, which on a slow
    // Android start corrupts React Native's native view tree (preallocation
    // race in RN 0.86) and blanks the screen at the next tab change.
    return (
        <Redirect
            href={
                (hasSavedVaults()
                    ? "/(locked)/unlock"
                    : "/(locked)/create") as never
            }
        />
    );
}
