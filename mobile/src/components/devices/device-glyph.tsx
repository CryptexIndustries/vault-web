import { View } from "react-native";
import Svg, { Path } from "react-native-svg";
import {
    HardDrive,
    Laptop,
    Link2,
    Monitor,
    Smartphone,
} from "lucide-react-native";
import type { DeviceNode } from "@/components/account/device-topology";
import { colors } from "@/theme";

export function deviceGlyphIcon(node: DeviceNode) {
    if (node.current) return Smartphone;
    if (!node.localDevices.length) return HardDrive;
    const name = node.displayName.toLowerCase();
    if (/phone|tablet|ipad|iphone|pixel|android/.test(name)) return Smartphone;
    if (/desktop|\bpc\b|studio/.test(name)) return Monitor;
    return Laptop;
}

export function DeviceGlyph({
    node,
    connected = false,
    relationship = false,
    variant = "identity",
}: {
    node: DeviceNode;
    connected?: boolean;
    relationship?: boolean;
    variant?: "identity" | "list" | "summary" | "connection" | "connection-row";
}) {
    const Icon = relationship ? Link2 : deviceGlyphIcon(node);
    const path = relationship
        ? "M10 13a5 5 0 0 0 7 0l4-4a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7 0l-4 4a5 5 0 0 0 7 7l2-2"
        : Icon === Smartphone
          ? "M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2ZM10 18h4"
          : Icon === Laptop
            ? "M4 4h16v12H4ZM2 20h20l-2-4H4Z"
            : Icon === Monitor
              ? "M3 3h18v14H3ZM12 17v4M8 21h8"
              : "M5 4h14v16H5ZM9 8h6M9 12h6M9 16h3";
    const current = node.current && !relationship;
    const compact = variant === "list" || variant === "connection-row";
    const endpoint = variant === "connection" || variant === "connection-row";
    const size = compact ? 36 : variant === "summary" ? 42 : 40;
    return (
        <View
            style={{
                width: size,
                height: size,
                borderRadius: compact ? 8 : variant === "identity" ? 11 : 9,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor:
                    endpoint || variant === "identity" || current
                        ? colors.secondary
                        : connected
                          ? "#25c47218"
                          : "#8a93a812",
                ...(variant === "summary"
                    ? { borderWidth: 1, borderColor: colors.border }
                    : {}),
            }}
        >
            <Svg
                width={compact ? 18 : 21}
                height={compact ? 18 : 21}
                viewBox="0 0 24 24"
                fill="none"
                stroke={
                    endpoint
                        ? colors.foreground
                        : current
                          ? colors.primary
                          : connected
                            ? colors.success
                            : colors.muted
                }
                strokeWidth={1.6}
                strokeLinecap="round"
                strokeLinejoin="round"
            >
                <Path d={path} />
            </Svg>
        </View>
    );
}
