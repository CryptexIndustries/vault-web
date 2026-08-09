import { useAtomValue } from "jotai/react";

import { onlineServicesDataAtom, onlineServicesStore } from "@/utils/atoms";

export function useOnlineServicesData() {
    return useAtomValue(onlineServicesDataAtom, {
        store: onlineServicesStore,
    });
}
