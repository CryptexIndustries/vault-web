import { Redirect } from "expo-router";
import { useAtomValue } from "jotai";

import { isVaultUnlockedAtom } from "@/utils/atoms";

export default function IndexScreen() {
    const unlocked = useAtomValue(isVaultUnlockedAtom);

    if (unlocked) {
        return <Redirect href="/(app)/(tabs)/vault" />;
    }

    return <Redirect href={"/(locked)/unlock" as never} />;
}
