import { colors } from "@/theme";

export type DeviceSheetVariant = "devices" | "device-detail";

export const deviceSheetPresentation = {
    heightRatio: 0.95,
    backdropColor: "#050810",
    backdropOpacity: 2 / 3,
    backdropDuration: 180,
    openAnimation: {
        duration: 200,
        dampingRatio: 1,
        overshootClamping: true,
    },
    containerStyle: {
        backgroundColor: colors.background,
        borderColor: colors.border,
        borderTopWidth: 1,
        borderLeftWidth: 0,
        borderRightWidth: 0,
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
    },
    indicatorStyle: {
        width: 34,
        height: 3,
        marginTop: 10,
        backgroundColor: "#596176",
    },
    variants: {
        devices: {
            indicatorMarginBottom: 13,
            contentClassName: "gap-3 px-[21px] pb-6",
        },
        "device-detail": {
            indicatorMarginBottom: 8,
            contentClassName: "gap-3",
        },
    },
} as const;

export function deviceSheetBodyHeight(
    availableHeight: number,
    variant: DeviceSheetVariant,
) {
    const { heightRatio, containerStyle, indicatorStyle, variants } =
        deviceSheetPresentation;
    const headerHeight =
        containerStyle.borderTopWidth +
        indicatorStyle.height +
        indicatorStyle.marginTop +
        variants[variant].indicatorMarginBottom;
    return Math.max(0, availableHeight * heightRatio - headerHeight);
}
