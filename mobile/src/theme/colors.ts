/**
 * Colors for React Native components and navigation.
 * NativeWind colors are defined separately in global.css.
 */
export const colors = {
    background: "#181d2b",
    navigation: "#111520",
    foreground: "#fcf8ec",
    primary: "#ff5668",
    success: "#25c472",
    muted: "#8a93a8",
    border: "#2a3348",
    secondary: "#22293a",
    trackOff: "#3d4559",
    destructive: "#ef4444",
    overlay: "rgba(0,0,0,0.6)",
} as const;

export type ThemeColor = keyof typeof colors;
