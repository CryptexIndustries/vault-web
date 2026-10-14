import { View } from "react-native";
import { Check, Minus } from "lucide-react-native";

import { UnlockedText as Text } from "@/components/unlocked/unlocked-ui";
import { colors } from "@/theme";

export type MembershipAccess = {
    canLink?: boolean;
    maxLinks?: number;
    canPromoteDevices?: boolean;
    managedEncryptedBackups?: boolean;
};

const vaultBenefits = [
    "Local encrypted vault",
    "Web app, Android app & Chromium extension",
    "Autofill",
    "Passkey support",
    "Basic security reports",
    "Imports & exports",
    "Manual encrypted backups",
    "Peer-to-peer synchronization",
    "Self-hosted sync infrastructure",
];

export function MembershipBenefits({
    access,
    upgrading = false,
}: {
    access?: MembershipAccess | null;
    upgrading?: boolean;
}) {
    const managedBenefits = [
        {
            title: "Managed P2P infrastructure",
            description:
                "Hosted signaling and relay services. Both devices must be online and unlocked to sync.",
            included: upgrading || access?.canLink === true,
        },
        {
            title: "Managed encrypted backups",
            description:
                "150 MB of encrypted backup storage, with version history and Recovery Kit access.",
            included: upgrading || access?.managedEncryptedBackups === true,
        },
        {
            title: "Online Services device management",
            description:
                "Manage registered devices and linking relationships, promote trusted devices, and revoke access.",
            included: upgrading || access?.canPromoteDevices === true,
        },
    ];

    return (
        <View style={{ gap: 20 }}>
            <View>
                <Text
                    style={{
                        color: colors.muted,
                        fontSize: 10,
                        letterSpacing: 1.1,
                        textTransform: "uppercase",
                        marginBottom: 10,
                    }}
                >
                    {upgrading ? "Your upgrade includes" : "Managed services"}
                </Text>
                {managedBenefits.map(({ title, description, included }) => (
                    <View
                        key={title}
                        accessibilityLabel={`${title}, ${included ? "included" : access ? "Online Services tier only" : "access unavailable"}`}
                        style={{
                            flexDirection: "row",
                            gap: 12,
                            paddingVertical: 13,
                            borderBottomWidth: 1,
                            borderBottomColor: colors.border,
                        }}
                    >
                        {included ? (
                            <Check
                                size={18}
                                color={colors.primary}
                                style={{ marginTop: 2 }}
                            />
                        ) : (
                            <Minus
                                size={18}
                                color={colors.muted}
                                style={{ marginTop: 2 }}
                            />
                        )}
                        <View style={{ flex: 1, gap: 6 }}>
                            <Text
                                style={{
                                    fontSize: 14,
                                    lineHeight: 20,
                                    color: included
                                        ? colors.foreground
                                        : colors.muted,
                                }}
                            >
                                {title}
                            </Text>
                            <Text
                                style={{
                                    fontSize: 12,
                                    lineHeight: 18,
                                    color: colors.muted,
                                }}
                            >
                                {description}
                            </Text>
                            {!included ? (
                                <View
                                    style={{
                                        alignSelf: "flex-start",
                                        borderRadius: 12,
                                        paddingHorizontal: 9,
                                        paddingVertical: 4,
                                        backgroundColor: colors.secondary,
                                    }}
                                >
                                    <Text
                                        style={{
                                            color: colors.muted,
                                            fontSize: 10,
                                        }}
                                    >
                                        {access
                                            ? "Online Services tier only"
                                            : "Access unavailable"}
                                    </Text>
                                </View>
                            ) : null}
                        </View>
                    </View>
                ))}
            </View>
            <View>
                <Text
                    style={{
                        color: colors.muted,
                        fontSize: 10,
                        letterSpacing: 1.1,
                        textTransform: "uppercase",
                        marginBottom: 10,
                    }}
                >
                    Always included with your vault
                </Text>
                {vaultBenefits.map((title) => (
                    <View
                        key={title}
                        accessibilityLabel={`${title}, included`}
                        style={{
                            flexDirection: "row",
                            alignItems: "center",
                            gap: 12,
                            paddingVertical: 11,
                        }}
                    >
                        <Check size={18} color={colors.primary} />
                        <Text style={{ flex: 1, fontSize: 13, lineHeight: 20 }}>
                            {title}
                        </Text>
                    </View>
                ))}
            </View>
        </View>
    );
}
