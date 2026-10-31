import { View } from "react-native";
import { Check, Minus } from "lucide-react-native";
import { msg, plural } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";

import { UnlockedText as Text } from "@/components/unlocked/unlocked-ui";
import { colors } from "@/theme";

export type MembershipAccess = {
    canLink?: boolean;
    maxLinks?: number;
    canPromoteDevices?: boolean;
    managedEncryptedBackups?: boolean;
    passwordSharing?: boolean;
    sshAgentRelay?: boolean;
    maxSshAgents?: number;
};

const vaultBenefits = [
    msg`Local encrypted vault`,
    msg`Web app, Android app & Chromium extension`,
    msg`Autofill`,
    msg`Passkey support`,
    msg`Basic security reports`,
    msg`Imports & exports`,
    msg`Manual encrypted backups`,
    msg`Peer-to-peer synchronization`,
    msg`Self-hosted sync infrastructure`,
    msg`SSH keys and the SSH agent on your own relay`,
];

export function MembershipBenefits({
    access,
    upgrading = false,
}: {
    access?: MembershipAccess | null;
    upgrading?: boolean;
}) {
    const { t } = useLingui();
    const maxSshAgents = access?.maxSshAgents;
    const vaultBenefitTitles = vaultBenefits.map((benefit) => t(benefit));
    const managedBenefits = [
        {
            title: t`Managed P2P infrastructure`,
            description: t`Hosted signaling and relay services. Both devices must be online and unlocked to sync.`,
            included: upgrading || access?.canLink === true,
        },
        {
            title: t`Managed encrypted backups`,
            description: t`150 MB of encrypted backup storage, with version history and Recovery Kit access.`,
            included: upgrading || access?.managedEncryptedBackups === true,
        },
        {
            title: t`One-time share links`,
            description: t`Send a secret to anyone, even people without Cryptex Vault. It opens once, then it's deleted.`,
            included: upgrading || access?.passwordSharing === true,
        },
        {
            title: t`Hosted SSH agent relay`,
            description: maxSshAgents
                ? plural(maxSshAgents, {
                      one: "Approve SSH logins on up to # Linux machine without running your own relay.",
                      other: "Approve SSH logins on up to # Linux machines without running your own relay.",
                  })
                : t`Approve SSH logins on your Linux machines without running your own relay.`,
            included: upgrading || access?.sshAgentRelay === true,
        },
        {
            title: t`Online Services device management`,
            description: t`Manage registered devices and linking relationships, promote trusted devices, and revoke access.`,
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
                    {upgrading ? t`Your upgrade includes` : t`Managed services`}
                </Text>
                {managedBenefits.map(({ title, description, included }) => (
                    <View
                        key={title}
                        accessibilityLabel={
                            included
                                ? t`${title}, included`
                                : access
                                  ? t`${title}, Online Services tier only`
                                  : t`${title}, access unavailable`
                        }
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
                                            ? t`Online Services tier only`
                                            : t`Access unavailable`}
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
                    {t`Always included with your vault`}
                </Text>
                {vaultBenefitTitles.map((title) => (
                    <View
                        key={title}
                        accessibilityLabel={t`${title}, included`}
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
