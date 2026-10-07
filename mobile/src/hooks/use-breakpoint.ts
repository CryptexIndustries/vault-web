import { useWindowDimensions } from "react-native";

import { isTabletViewport, layout } from "@/theme";

export function useBreakpoint() {
    const { width, height } = useWindowDimensions();
    const isTablet = isTabletViewport(width, height);
    return {
        width,
        height,
        isTablet,
        tabletMinWidth: layout.tabletMinWidth,
    };
}
