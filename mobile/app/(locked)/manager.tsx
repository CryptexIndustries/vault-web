import { Redirect, useLocalSearchParams } from "expo-router";

import type { VaultManagerTab } from "@/components/vault-manager";

function parseTab(raw: string | string[] | undefined): VaultManagerTab | undefined {
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (value === "unlock" || value === "create" || value === "restore") {
        return value;
    }
    return undefined;
}

export default function LockedVaultManagerScreen() {
    const params = useLocalSearchParams<{ tab?: string; returnTo?: string }>();
    const tab = parseTab(params.tab) ?? "unlock";
    const returnTo = Array.isArray(params.returnTo)
        ? params.returnTo[0]
        : params.returnTo;
    return (
        <Redirect
            href={
                {
                    pathname: `/(locked)/${tab}`,
                    params: returnTo ? { returnTo } : undefined,
                } as never
            }
        />
    );
}
