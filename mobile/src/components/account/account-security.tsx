import { View } from "react-native";
import { KeyRound, LogOut, Trash2 } from "lucide-react-native";

import {
    UnlockedMenuRow,
    UnlockedText,
} from "@/components/unlocked/unlocked-ui";
import { colors } from "@/theme";

type AccountSecurityProps = {
    isRoot: boolean;
    onlineServicesBound: boolean;
    busy: boolean;
    recoveryPhraseAlreadyOnServer: boolean;
    genRecoveryPending: boolean;
    rotateRecoveryPending: boolean;
    onGenerateRecovery: () => void;
    onRotateRecovery: () => void;
    onRemoveLocalBinding: () => void;
    onDeleteAccount: () => void;
};

export function AccountSecurity({
    isRoot,
    onlineServicesBound,
    busy,
    recoveryPhraseAlreadyOnServer,
    genRecoveryPending,
    rotateRecoveryPending,
    onGenerateRecovery,
    onRotateRecovery,
    onRemoveLocalBinding,
    onDeleteAccount,
}: AccountSecurityProps) {
    return (
        <View>
            <View
                style={{
                    paddingBottom: 22,
                    marginBottom: 6,
                    borderBottomWidth: 1,
                    borderBottomColor: colors.border,
                }}
            >
                <View
                    style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 7,
                    }}
                >
                    <View
                        style={{
                            width: 6,
                            height: 6,
                            borderRadius: 3,
                            backgroundColor: recoveryPhraseAlreadyOnServer
                                ? colors.success
                                : colors.muted,
                        }}
                    />
                    <UnlockedText style={{ color: colors.muted, fontSize: 11 }}>
                        {recoveryPhraseAlreadyOnServer
                            ? "Recovery Kit saved"
                            : "Setup needed"}
                    </UnlockedText>
                </View>
                <UnlockedText
                    style={{
                        marginTop: 10,
                        fontSize: 22,
                        fontWeight: "500",
                        letterSpacing: -0.5,
                    }}
                >
                    Account recovery
                </UnlockedText>
                <UnlockedText
                    style={{
                        color: colors.muted,
                        fontSize: 13,
                        lineHeight: 20,
                        marginTop: 6,
                    }}
                >
                    {recoveryPhraseAlreadyOnServer
                        ? "A Recovery Kit is set up for this account."
                        : "Create a Recovery Kit to restore access if you lose your devices."}
                </UnlockedText>
            </View>
            <UnlockedMenuRow
                icon={KeyRound}
                title={
                    recoveryPhraseAlreadyOnServer
                        ? "Replace Recovery Kit"
                        : "Create Recovery Kit"
                }
                subtitle={
                    recoveryPhraseAlreadyOnServer
                        ? "Invalidate the old kit and save a new one"
                        : "Save your User ID and recovery phrase"
                }
                onPress={() => {
                    if (
                        !isRoot ||
                        busy ||
                        genRecoveryPending ||
                        rotateRecoveryPending
                    )
                        return;
                    if (recoveryPhraseAlreadyOnServer) onRotateRecovery();
                    else onGenerateRecovery();
                }}
            />
            <UnlockedText
                style={{
                    color: colors.muted,
                    fontSize: 11,
                    letterSpacing: 1,
                    marginTop: 26,
                    marginBottom: 6,
                    textTransform: "uppercase",
                }}
            >
                Access on this device
            </UnlockedText>
            <UnlockedMenuRow
                icon={LogOut}
                title="Disconnect this device"
                subtitle="Forget this vault’s saved Online Services access"
                onPress={() => {
                    if (onlineServicesBound && !busy) onRemoveLocalBinding();
                }}
            />
            <UnlockedText
                style={{
                    color: colors.muted,
                    fontSize: 11,
                    letterSpacing: 1,
                    marginTop: 26,
                    marginBottom: 6,
                    textTransform: "uppercase",
                }}
            >
                Account management
            </UnlockedText>
            <UnlockedMenuRow
                destructive
                icon={Trash2}
                title="Delete online account"
                subtitle="Permanently remove the server account"
                onPress={() => {
                    if (isRoot && !busy) onDeleteAccount();
                }}
            />
            {!isRoot ? (
                <UnlockedText
                    style={{
                        color: colors.muted,
                        fontSize: 12,
                        lineHeight: 18,
                        marginTop: 16,
                    }}
                >
                    Recovery Kit changes and account deletion require an
                    administrator device.
                </UnlockedText>
            ) : null}
        </View>
    );
}
